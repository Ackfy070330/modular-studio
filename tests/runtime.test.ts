import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
process.env.MODULAR_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), 'modular-runtime-'));
const { startRun, debugState, controlRun, stopAll } = await import('../server/runtime.js');
const { createProject, getRun, db } = await import('../server/store.js');
const { exampleGraph } = await import('../shared/model.js');
async function until<T>(read: () => T, ready: (value: T) => boolean, timeout = 10000): Promise<T> { const start = Date.now(); while (Date.now() - start < timeout) { const value = read(); if (ready(value)) return value; await new Promise(r => setTimeout(r, 60)); } throw new Error('等待运行状态超时'); }
test('separate Node process really pauses, exposes input variables, steps and resumes', { timeout: 20000 }, async () => {
  const project = createProject('Debug test', exampleGraph());
  const run = await startRun(project, { sku: 'TEST', quantity: 2, unitPrice: 100 }, { debug: true, breakpoints: ['calculate_total'] });
  const paused = await until(() => debugState(run.id), s => s.state === 'paused' && s.frames.length > 0);
  assert.equal(paused.variables.data.quantity, 2); assert.equal(paused.variables.data.unitPrice, 100); assert.ok(paused.frames[0].name.startsWith('step_'));
  assert.equal(getRun(run.id).status, 'paused'); const firstGeneration = paused.generation;
  await controlRun(run.id, 'next');
  const next = await until(() => debugState(run.id), s => s.state === 'paused' && s.generation > firstGeneration && s.frames.length > 0);
  assert.ok(next.frames[0].line > paused.frames[0].line);
  await controlRun(run.id, 'continue');
  const completed = await until(() => getRun(run.id), s => !['running', 'paused'].includes(s.status));
  assert.equal(completed.status, 'ok', completed.error); assert.equal(completed.output.total, 200); assert.equal(completed.steps.length, 7); assert.equal(debugState(run.id).state, 'ended');
});
test('failed validation retains failed node and never marks downstream steps successful', { timeout: 10000 }, async () => {
  const project = createProject('Failure test', exampleGraph());
  for (let attempt = 0; attempt < 8; attempt++) {
    const run = await startRun(project, { sku: 'TEST', quantity: 0, unitPrice: 100 });
    const failed = await until(() => getRun(run.id), s => s.status === 'error'); assert.equal(failed.steps.at(-1)?.nodeId, 'validate_order'); assert.equal(failed.steps.at(-1)?.status, 'error'); assert.equal(failed.steps.length, 3);
  }
});
test.after(() => { stopAll(); db.close(); });
