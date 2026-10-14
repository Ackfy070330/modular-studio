import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';

const resources = path.resolve(process.argv[2] || 'desktop-runtime');
const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'modular-desktop-smoke-'));
const token = randomBytes(32).toString('hex');
let child, origin, errors = '';
async function start() {
  child = fork(path.join(resources, 'backend', 'server.cjs'), [], {
    execPath: path.join(resources, 'node', 'node.exe'), execArgv: [], cwd: dataDirectory,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true,
    env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, TEMP: process.env.TEMP, PORT: '0', MODULAR_DATA_DIR: dataDirectory, MODULAR_STATIC_DIR: path.join(resources, 'ui'), MODULAR_SESSION_TOKEN: token },
  });
  child.stderr.on('data', b => { errors += String(b); });
  origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Backend startup timeout: ' + errors)), 15000);
    child.once('error', e => { clearTimeout(timer); reject(e); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Backend exited ${code}: ${errors}`)); });
    child.on('message', message => { if (message.type === 'ready') { clearTimeout(timer); resolve(message.url); } });
  });
}
function request(route, init = {}) { return fetch(origin + route, { ...init, headers: { 'content-type': 'application/json', 'x-modular-desktop': token, origin, ...init.headers } }); }
async function json(route, method = 'GET', body) { const r = await request(route, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); const result = await r.json(); assert.ok(r.ok, JSON.stringify(result)); return result; }
async function until(route, predicate) { for (let i = 0; i < 100; i++) { const result = await json(route); if (predicate(result)) return result; await new Promise(r => setTimeout(r, 70)); } throw new Error('Timeout ' + route); }
async function stop() {
  if (!child || child.exitCode !== null) return;
  const current = child;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { current.kill(); reject(new Error('Graceful shutdown timeout')); }, 6000);
    current.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('Exit ' + code)); });
    current.send({ type: 'shutdown' });
  });
}
try {
  await start();
  assert.notEqual(new URL(origin).port, '4310');
  assert.equal((await fetch(origin + '/api/health')).status, 403);
  assert.equal((await request('/api/health', { headers: { origin: 'https://untrusted.example' } })).status, 403);
  const page = await request('/'); assert.equal(page.status, 200); assert.ok(page.headers.get('content-security-policy').includes("script-src 'self'")); assert.ok((await page.text()).includes('id="root"'));
  const health = await json('/api/health'); assert.ok(health.runtime.startsWith('v24.'));
  const project = await json('/api/projects', 'POST', { name: 'Desktop smoke test' });
  const completed = await json(`/api/projects/${project.id}/execute`, 'POST', { input: { sku: 'SMOKE', quantity: 2, unitPrice: 100 } });
  assert.equal(completed.output.total, 200); assert.ok(completed.output.recordId);
  const run = await json(`/api/projects/${project.id}/runs`, 'POST', { input: { sku: 'DEBUG', quantity: 3, unitPrice: 100 }, debug: true, breakpoints: ['calculate_total'] });
  const paused = await until(`/api/runs/${run.id}/debug`, s => s.state === 'paused' && s.frames.length);
  assert.equal(paused.variables.data.quantity, 3);
  await json(`/api/runs/${run.id}/control`, 'POST', { command: 'continue' });
  const done = await until(`/api/runs/${run.id}`, s => s.status === 'ok'); assert.equal(done.output.total, 300);
  const imported = await json('/api/projects/import', 'POST', { directory: path.resolve('examples/order-app') }); assert.equal(imported.fileCount, 2); assert.equal(imported.project.graph.edges.length, 1);
  assert.equal((await request('/api/custom/generate', { method: 'POST', body: JSON.stringify({}) })).status, 428);
  const loopProject = await json('/api/projects', 'POST', { name: 'Loop integration', template: 'loop' });
  const loopRun = await json(`/api/projects/${loopProject.id}/execute`, 'POST', { input: { sku: 'LOOP', quantity: 1, unitPrice: 100, total: 0 } });
  assert.equal(loopRun.output.total, 300);
  const loopHistory = await json(`/api/runs/${loopRun.runId}`); assert.equal(loopHistory.steps.filter(s => s.nodeId === 'calculate_total').length, 3);
  const plan = await json(`/api/projects/${loopProject.id}/plan`, 'POST', { graph: { nodes: loopProject.graph.nodes, edges: [] } });
  assert.equal(plan.errors.length, 0); assert.equal(plan.graph.nodes.length, 7);
  await stop(); await start();
  assert.equal((await json(`/api/projects/${project.id}`)).name, 'Desktop smoke test');
  assert.equal((await json(`/api/projects/${project.id}/runs`)).length, 2);
  assert.equal((await json(`/api/runs/${loopRun.runId}`)).steps.length, 9);
  await stop();
  console.log('Desktop backend passed: bundled Node, auth, UI, execution, SQLite, debugger, import, key gate, loops, planner, persistence and shutdown.');
} finally { if (child && child.exitCode === null) child.kill(); }
