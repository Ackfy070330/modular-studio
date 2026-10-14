const { mkdir, open, rename, rm } = require('node:fs/promises');
const { createHash, randomUUID } = require('node:crypto');
const path = require('node:path');
const REPOSITORY = 'https://github.com/Ackfy070330/modular-studio';
const API = 'https://api.github.com/repos/Ackfy070330/modular-studio/releases?per_page=20';
const MANIFEST = 'https://raw.githubusercontent.com/Ackfy070330/modular-studio/main/updates/windows-x64.json';
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
async function readMetadata(response) {
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > 1048576) throw new Error('版本信息过大'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString());
}
function selectManifest(manifest, currentVersion) {
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.releases) || !manifest.releases.length) throw new Error('备用更新清单格式无效');
  // Validate every entry even when the installed version is newer.
  for (const release of manifest.releases) if (!selectRelease([release], '0.0.0')) throw new Error('备用更新清单缺少可信安装包信息');
  return selectRelease(manifest.releases, currentVersion);
}
function createUpdater({ version, directory, fetcher = fetch, changed = () => {}, now = Date.now }) {
  let state = { status: 'idle', currentVersion: version }, controller, selected, downloadedPath, downloading = false;
  let cachedUntil = 0, apiRetryAt = 0, apiError = '';
  const update = patch => { state = { ...state, ...patch }; changed({ ...state }); return { ...state }; };
  return {
    state: () => ({ ...state }),
    path: () => downloadedPath,
    async check() {
      if (downloading || state.status === 'checking') return { ...state };
      if (now() < cachedUntil && state.status !== 'error') return { ...state };
      selected = null; downloadedPath = undefined;
      update({ status: 'checking', release: undefined, error: undefined, notice: undefined, received: 0 });
      try {
        let notice;
        try {
          if (now() < apiRetryAt) throw new Error(apiError);
          const response = await fetcher(API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Modular-Studio/' + version }, signal: AbortSignal.timeout(20000), redirect: 'error' });
          if (!response.ok) {
            const limited = response.status === 429 || (response.status === 403 && (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')));
            if (limited) {
              const retry = response.headers.get('retry-after');
              const retryAt = retry && /^\d+$/.test(retry) ? now() + Number(retry) * 1000 : Date.parse(retry || '');
              const resetAt = Number(response.headers.get('x-ratelimit-reset')) * 1000;
              apiRetryAt = Math.max(now() + 60000, Number.isFinite(retryAt) ? retryAt : 0, Number.isFinite(resetAt) ? resetAt : 0);
              apiError = `GitHub 匿名接口已限流，${new Date(apiRetryAt).toLocaleTimeString()} 后可重试。共享网络或代理也可能消耗额度，无需填写模型 API Key。`;
            } else { apiRetryAt = now() + 60000; apiError = `GitHub 更新接口访问失败（HTTP ${response.status}）`; }
            await response.body?.cancel(); throw new Error(apiError);
          }
          selected = selectRelease(await readMetadata(response), version);
        } catch (primaryError) {
          try {
            const response = await fetcher(MANIFEST, { signal: AbortSignal.timeout(20000), redirect: 'error', cache: 'no-store' });
            if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}`); }
            selected = selectManifest(await readMetadata(response), version);
            notice = '已通过本项目的备用发布清单完成检查；安装包仍需通过大小与 SHA-256 校验。';
          } catch { throw new Error(`${primaryError.message}；备用更新清单也暂不可用，请打开发布页手动查看。`); }
        }
        cachedUntil = now() + 60000;
        return update({ status: selected ? 'available' : 'current', release: selected || undefined, notice });
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
module.exports = { createUpdater, selectRelease, compareVersions, selectManifest };
