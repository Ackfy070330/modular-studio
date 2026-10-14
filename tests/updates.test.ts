import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const { createUpdater, compareVersions, selectRelease } = createRequire(import.meta.url)('../desktop/updates.cjs');
const manifest = () => ({ schemaVersion: 1, releases: [release()] });
const content = Buffer.from('test installer bytes');
function release(version = '0.3.0') {
  const name = `Modular-Studio-Setup-${version}-x64.exe`;
  return { tag_name: 'v' + version, draft: false, prerelease: true, body: 'Preview', assets: [{ name, state: 'uploaded', size: content.length, digest: 'sha256:' + createHash('sha256').update(content).digest('hex'), browser_download_url: `https://github.com/Ackfy070330/modular-studio/releases/download/v${version}/${name}` }] };
}
test('updates compare numeric versions, accept only newer uploaded verified assets from this repository', () => {
  assert.ok(compareVersions('0.10.0', '0.2.0') > 0);
  assert.equal(selectRelease([release('0.1.0'), release('0.2.0')], '0.2.0'), null);
  assert.equal(selectRelease([release('0.3.0'), release('0.10.0')], '0.2.0').version, '0.10.0');
  const wrong = release(); wrong.assets[0].browser_download_url = 'https://untrusted.example/payload.exe'; assert.equal(selectRelease([wrong], '0.2.0'), null);
  const unchecked = release(); unchecked.assets[0].digest = ''; assert.equal(selectRelease([unchecked], '0.2.0'), null);
  const draft = release(); draft.draft = true; assert.equal(selectRelease([draft], '0.2.0'), null);
});
test('update download verifies exact content, cleans partials and supports network retry', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'modular-updates-')); let broken = true;
  const fetcher = async (url: string) => url.includes('api.github.com') ? Response.json([release()]) : new Response(broken ? Buffer.from('x'.repeat(content.length)) : content);
  const updater = createUpdater({ version: '0.2.0', directory, fetcher });
  assert.equal((await updater.check()).status, 'available');
  const bad = await updater.download(); assert.equal(bad.status, 'error'); assert.match(bad.error, /SHA-256/); assert.deepEqual(await readdir(directory), []); assert.equal(updater.path(), undefined);
  broken = false; const good = await updater.download(); assert.equal(good.status, 'downloaded'); assert.equal(good.received, content.length);
  assert.deepEqual(await readFile(updater.path()), content); assert.equal((await readdir(directory)).length, 1);
});
test('redirects to untrusted origins are refused and no update installer is exposed', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'modular-update-redirect-')); const requested: string[] = [];
  const updater = createUpdater({ version: '0.2.0', directory, fetcher: async (url: string) => { requested.push(url); return url.includes('api.github.com') ? Response.json([release()]) : new Response(null, { status: 302, headers: { location: 'https://untrusted.example/payload.exe' } }); } });
  await updater.check(); assert.equal((await updater.download()).status, 'error'); assert.ok(requested.every(url => !url.includes('untrusted'))); assert.equal(updater.path(), undefined); assert.deepEqual(await readdir(directory), []);
});
test('cancelled downloads can retry and failed checks do not erase local workspace files', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'modular-update-cancel-')); let downloading = false;
  const updater = createUpdater({ version: '0.2.0', directory, fetcher: async (url: string, options: any) => {
    if (url.includes('api.github.com')) return Response.json([release()]);
    downloading = true; return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
  } });
  await updater.check(); const pending = updater.download(); while (!downloading) await new Promise(r => setTimeout(r, 1));
  updater.cancel(); assert.equal((await pending).status, 'available'); assert.deepEqual(await readdir(directory), []);
  const offline = createUpdater({ version: '0.2.0', directory, fetcher: async () => { throw new Error('offline'); } });
  assert.equal((await offline.check()).status, 'error'); await assert.rejects(offline.download(), /检查/);
});

test('rate-limited checks use the public manifest, cache results and respect API reset', async () => {
  let clock = 1000000; const calls: string[] = [];
  const directory = await mkdtemp(path.join(os.tmpdir(), 'modular-rate-limit-'));
  const updater = createUpdater({ version: '0.2.0', directory, now: () => clock, fetcher: async (url: string) => {
    calls.push(url);
    if (url.includes('api.github.com')) return new Response(null, { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '2000' } });
    if (url.includes('raw.githubusercontent.com')) return Response.json(manifest());
    return new Response(content);
  } });
  const state = await updater.check(); assert.equal(state.status, 'available'); assert.match(state.notice, /备用/);
  await updater.check(); assert.equal(calls.length, 2);
  clock += 61000; await updater.check(); assert.equal(calls.filter(x => x.includes('api.github.com')).length, 1);
  assert.equal((await updater.download()).status, 'downloaded'); assert.deepEqual(await readFile(updater.path()), content);
  clock = 2000001; await updater.check(); assert.equal(calls.filter(x => x.includes('api.github.com')).length, 2);
});

test('fallback can confirm current version but rejects malformed and untrusted manifests', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'modular-manifest-'));
  for (const invalid of [null, {}, { schemaVersion: 1, releases: [] }, { schemaVersion: 1, releases: [{ ...release(), assets: [] }] }]) {
    const updater = createUpdater({ version: '0.4.0', directory, fetcher: async (url: string) => url.includes('api.github.com') ? new Response(null, { status: 403 }) : Response.json(invalid) });
    assert.equal((await updater.check()).status, 'error'); await assert.rejects(updater.download(), /检查/);
  }
  const current = createUpdater({ version: '0.3.0', directory, fetcher: async (url: string) => url.includes('api.github.com') ? new Response(null, { status: 503 }) : Response.json(manifest()) });
  assert.equal((await current.check()).status, 'current');
});

test('failed fallback reports rate limiting and avoids repeating API calls before retry-after', async () => {
  let clock = 1000000, calls = 0;
  const updater = createUpdater({ version: '0.2.0', directory: os.tmpdir(), now: () => clock, fetcher: async (url: string) => {
    if (url.includes('api.github.com')) { calls++; return new Response(null, { status: 429, headers: { 'retry-after': '120' } }); }
    throw new Error('offline');
  } });
  const state = await updater.check(); assert.equal(state.status, 'error'); assert.match(state.error, /限流/); assert.match(state.error, /发布页/);
  clock += 61000; await updater.check(); assert.equal(calls, 1);
  clock += 61000; await updater.check(); assert.equal(calls, 2);
});
