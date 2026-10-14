const { mkdir, open, rename, rm } = require('node:fs/promises');
const { createHash, randomUUID } = require('node:crypto');
const path = require('node:path');
const REPOSITORY = 'https://github.com/Ackfy070330/modular-studio';
const API = 'https://api.github.com/repos/Ackfy070330/modular-studio/releases?per_page=20';
const MAX_BYTES = 350 * 1024 * 1024;
function versionParts(version) { return /^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(version) ? version.split('.').map(Number) : null; }
function compareVersions(a, b) {
  const left = versionParts(a), right = versionParts(b);
  if (!left || !right) throw new Error('版本号格式错误');
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
}
function selectRelease(releases, currentVersion) {
  if (!Array.isArray(releases)) throw new Error('版本服务返回了无效内容');
  const candidates = [];
  for (const release of releases) {
    const version = String(release.tag_name || '').replace(/^v/, '');
    if (release.draft || !versionParts(version) || compareVersions(version, currentVersion) <= 0) continue;
    const name = `Modular-Studio-Setup-${version}-x64.exe`;
    const asset = release.assets?.find(a => a.name === name && a.state === 'uploaded');
    const url = `${REPOSITORY}/releases/download/v${version}/${name}`;
    if (!asset || asset.browser_download_url !== url || !/^sha256:[a-f0-9]{64}$/.test(asset.digest || '') || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_BYTES) continue;
    candidates.push({ version, name, url, size: asset.size, sha256: asset.digest.slice(7), preview: !!release.prerelease, notes: String(release.body || '').slice(0, 6000) });
  }
  return candidates.sort((a, b) => compareVersions(b.version, a.version))[0] || null;
}
function allowedDownload(url) {
  const parsed = new URL(url);
  return parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.port && ['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(parsed.hostname);
}
async function fetchDownload(fetcher, url, signal) {
  for (let redirects = 0; redirects < 6; redirects++) {
    if (!allowedDownload(url)) throw new Error('安装包下载地址不受信任');
    const response = await fetcher(url, { signal, redirect: 'manual' });
    if ([301, 302, 303, 307, 308].includes(response.status)) { const location = response.headers.get('location'); await response.body?.cancel(); if (!location) throw new Error('下载重定向缺少地址'); url = new URL(location, url).href; continue; }
    if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}）`);
    return response;
  }
  throw new Error('下载重定向次数过多');
}
function createUpdater({ version, directory, fetcher = fetch, changed = () => {} }) {
  let state = { status: 'idle', currentVersion: version }, controller, selected, downloadedPath, downloading = false;
  const update = patch => { state = { ...state, ...patch }; changed({ ...state }); return { ...state }; };
  return {
    state: () => ({ ...state }),
    path: () => downloadedPath,
    async check() {
      if (downloading || state.status === 'checking') return { ...state };
      selected = null; downloadedPath = undefined;
      update({ status: 'checking', release: undefined, error: undefined, received: 0 });
      try {
        const response = await fetcher(API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Modular-Studio/' + version }, signal: AbortSignal.timeout(20000), redirect: 'error' });
        if (!response.ok) throw new Error(`检查更新失败（HTTP ${response.status}），请稍后重试`);
        const chunks = []; let size = 0;
        for await (const chunk of response.body) { size += chunk.length; if (size > 1048576) throw new Error('版本信息过大'); chunks.push(chunk); }
        selected = selectRelease(JSON.parse(Buffer.concat(chunks).toString()), version);
        return update({ status: selected ? 'available' : 'current', release: selected || undefined });
      } catch (error) { return update({ status: 'error', error: error.message }); }
    },
    async download() {
      if (downloading) return { ...state };
      if (!selected) throw new Error('请先检查并选择可用更新');
      downloading = true; controller = new AbortController(); const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(1800000)]);
      const target = path.join(directory, selected.name), temporary = target + '.' + randomUUID() + '.partial';
      let file; downloadedPath = undefined;
      update({ status: 'downloading', received: 0, error: undefined });
      try {
        await mkdir(directory, { recursive: true });
        const response = await fetchDownload(fetcher, selected.url, signal);
        file = await open(temporary, 'wx'); const hash = createHash('sha256'); let received = 0, notified = 0;
        for await (const chunk of response.body) {
          signal.throwIfAborted(); received += chunk.length;
          if (received > selected.size) throw new Error('安装包大小不符');
          hash.update(chunk); await file.writeFile(chunk);
          if (Date.now() - notified > 200) { update({ received }); notified = Date.now(); }
        }
        if (received !== selected.size || hash.digest('hex') !== selected.sha256) throw new Error('安装包 SHA-256 校验失败，请重试');
        signal.throwIfAborted(); await file.close(); file = undefined;
        await rename(temporary, target); downloadedPath = target;
        return update({ status: 'downloaded', received, error: undefined });
      } catch (error) {
        return update({ status: controller.signal.aborted ? 'available' : 'error', error: controller.signal.aborted ? '下载已取消，可重新下载' : error.message });
      } finally { try { await file?.close(); await rm(temporary, { force: true }); } finally { controller = undefined; downloading = false; } }
    },
    cancel() { controller?.abort(); },
  };
}
module.exports = { createUpdater, selectRelease, compareVersions };
