import { build } from 'esbuild';
import sharp from 'sharp';
import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, cp, readdir } from 'node:fs/promises';
import path from 'node:path';
import { setDefaultResultOrder } from 'node:dns';
setDefaultResultOrder('ipv4first');
async function download(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { const response = await fetch(url, { signal: AbortSignal.timeout(120000) }); if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`); return Buffer.from(await response.arrayBuffer()); }
    catch (error) { if (attempt === 2) throw error; console.log('Download interrupted, retrying…'); }
  }
}

const runtime = JSON.parse(await readFile('desktop/runtime.json', 'utf8'));
await mkdir('desktop-runtime/backend', { recursive: true });
await mkdir('desktop-runtime/node', { recursive: true });
await mkdir('desktop/assets', { recursive: true });
await build({ entryPoints: ['server/index.ts'], outfile: 'desktop-runtime/backend/server.cjs', bundle: true, platform: 'node', target: 'node24', format: 'cjs', sourcemap: false, logLevel: 'info' });
await cp('dist', 'desktop-runtime/ui', { recursive: true });
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const notices = ['Third-party packages used by Modular Studio. Electron and Node.js carry their own license files.'];
for (const [directory, metadata] of Object.entries(lock.packages)) {
  if (!directory.startsWith('node_modules/') || metadata.dev) continue;
  try {
    const pkg = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
    const names = (await readdir(directory)).filter(name => /^(licen[cs]e|copying|notice)(\.|$|-)/i.test(name));
    const texts = [];
    for (const name of names) { try { texts.push(await readFile(path.join(directory, name), 'utf8')); } catch {} }
    notices.push(`\n${pkg.name} ${pkg.version}\nLicense: ${JSON.stringify(pkg.license || metadata.license || 'See upstream package')}\n${texts.join('\n')}`);
  } catch { /* Optional packages absent on this platform. */ }
}
await writeFile('desktop-runtime/backend/THIRD_PARTY_NOTICES.txt', notices.join('\n\n---\n'));
const png = await sharp('public/favicon.svg').resize(256, 256).png().toBuffer();
await writeFile('desktop/assets/icon.png', png);
const ico = Buffer.alloc(22); ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4); ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12); ico.writeUInt32LE(png.length, 14); ico.writeUInt32LE(22, 18);
await writeFile('desktop/assets/icon.ico', Buffer.concat([ico, png]));
const filename = `node-v${runtime.nodeVersion}-${runtime.platform}-${runtime.arch}.zip`;
const base = `https://nodejs.org/dist/v${runtime.nodeVersion}/`;
const sums = (await download(base + 'SHASUMS256.txt')).toString('utf8');
const expected = sums.split('\n').find(line => line.trim().endsWith(' ' + filename))?.trim().split(/\s+/)[0];
if (!expected) throw new Error('Node.js 官方校验文件缺少 ' + filename);
await mkdir('.cache', { recursive: true });
const cache = path.join('.cache', filename);
let archive;
try { archive = await readFile(cache); } catch { /* First build downloads the pinned runtime. */ }
if (!archive || createHash('sha256').update(archive).digest('hex') !== expected) {
  console.log('Downloading pinned Node.js runtime ' + runtime.nodeVersion);
  archive = await download(base + filename);
  if (createHash('sha256').update(archive).digest('hex') !== expected) throw new Error('Node.js 下载校验失败');
  await writeFile(cache, archive);
}
const zip = await JSZip.loadAsync(archive);
const prefix = filename.slice(0, -4) + '/';
for (const file of ['node.exe', 'LICENSE']) {
  const entry = zip.file(prefix + file); if (!entry) throw new Error('Node.js 包缺少 ' + file);
  await writeFile(path.join('desktop-runtime/node', file), await entry.async('nodebuffer'));
}
console.log('Desktop resources ready: bundled backend, UI, Node.js and icons.');
