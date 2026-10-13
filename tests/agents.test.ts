import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
process.env.MODULAR_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), 'modular-agents-'));
const { saveAgentSettings, agentSettings, proposeChanges, applyProposal } = await import('../server/agents.js');
const { createProject, getProject, putProject, readSetting, db } = await import('../server/store.js');
let received: any;
const mock = createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  received = { body: JSON.parse(raw), url: req.url, authorization: req.headers.authorization };
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: '将最小数量改为 2。此为测试响应。', changes: [{ nodeId: 'validate_order', config: { field: 'quantity', minimum: 2 } }] }) } }] }));
});
await new Promise<void>(resolve => mock.listen(0, '127.0.0.1', resolve));
const address = mock.address() as { port: number };
test('generic API adapter passes context, validates changes, protects key and applies only to unchanged revision', async () => {
  saveAgentSettings({ baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'mock-for-contract-test', apiKey: 'test-secret-only' });
  assert.equal(agentSettings().hasKey, true); assert.equal(agentSettings().apiKey, undefined); assert.equal(readSetting('agent').apiKey, undefined);
  const project = createProject('Adapter test'); const task = await proposeChanges(project.id, '最小数量改为 2', 'validate_order');
  assert.equal(received.url, '/v1/chat/completions'); assert.equal(received.authorization, 'Bearer test-secret-only'); assert.equal(received.body.model, 'mock-for-contract-test');
  assert.equal(getProject(project.id).revision, 1); assert.equal(getProject(project.id).graph.nodes.find(n => n.id === 'validate_order')!.data.config.minimum, 1);
  const applied = applyProposal(task.id); assert.equal(applied.revision, 2); assert.equal(applied.graph.nodes.find(n => n.id === 'validate_order')!.data.config.minimum, 2);
  const conflicting = await proposeChanges(project.id, '再次修改'); putProject({ ...applied, revision: 3 }); assert.throws(() => applyProposal(conflicting.id), /已经变化/);
});
test.after(async () => { await new Promise<void>(resolve => mock.close(() => resolve())); db.close(); });
