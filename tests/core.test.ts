import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { exampleGraph } from '../shared/model.js';
import { parseGraph, executionOrder, safeSnapshot } from '../server/domain.js';
import { compileGraph, standaloneFiles, previewHtml } from '../server/compiler.js';
import { analyzeProject, readProjectSource } from '../server/importer.js';

test('blueprint rejects missing nodes, cycles and forks instead of inventing execution order', () => {
  const graph = exampleGraph(); assert.equal(executionOrder(parseGraph(graph)).length, 7);
  const broken = structuredClone(graph); broken.edges[0].target = 'absent'; assert.throws(() => parseGraph(broken), /不存在/);
  const cycle = structuredClone(graph); cycle.edges.push({ id: 'cycle', source: 'show_receipt', target: 'order_form' }); assert.throws(() => executionOrder(cycle), /入口/);
  const forked = structuredClone(graph); forked.edges.push({ id: 'fork', source: 'create_order', target: 'calculate_total' }); assert.throws(() => executionOrder(forked), /分叉/);
  const detached = structuredClone(graph); detached.edges.pop(); assert.throws(() => executionOrder(detached), /入口/);
});
test('generator executes edited logic, persists real data, reports failures without inserting records', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'modular-core-'));
  const compiled = compileGraph(exampleGraph()); const file = path.join(folder, 'pipeline.mjs'); await writeFile(file, compiled.code);
  const { runPipeline } = await import(pathToFileURL(file).href);
  const steps: any[] = []; const databasePath = path.join(folder, 'records.sqlite');
  const result = await runPipeline({ sku: 'TEST', quantity: 2, unitPrice: 100 }, { databasePath, onStep: (s: any) => steps.push(s) });
  assert.equal(result.total, 200); assert.equal(steps.length, 14); assert.equal(steps.filter(s => s.status === 'ok').length, 7);
  const db = new DatabaseSync(databasePath); assert.equal((db.prepare('SELECT count(*) AS count FROM records').get() as any).count, 1);
  await assert.rejects(runPipeline({ sku: 'TEST', quantity: 0, unitPrice: 100 }, { databasePath }), /quantity/);
  assert.equal((db.prepare('SELECT count(*) AS count FROM records').get() as any).count, 1); db.close();
  const edited = exampleGraph(); edited.nodes.find(n => n.id === 'calculate_total')!.data.config.expression = { kind: 'math', op: '*', left: { kind: 'field', name: 'unitPrice' }, right: { kind: 'number', value: 0.9 } };
  const editedFile = path.join(folder, 'edited.mjs'); await writeFile(editedFile, compileGraph(parseGraph(edited)).code);
  const changed = await import(pathToFileURL(editedFile).href); assert.equal((await changed.runPipeline({ sku: 'TEST', quantity: 2, unitPrice: 100 }, { databasePath })).total, 90);
});
test('untrusted node config cannot inject generated code; previews escape HTML', () => {
  const graph = exampleGraph(); graph.nodes.find(n => n.id === 'calculate_total')!.data.config.outputField = '__proto__'; assert.throws(() => parseGraph(graph));
  const safe = exampleGraph(); safe.nodes[0].data.label = '\u2028globalThis.injected=true'; assert.doesNotThrow(() => compileGraph(parseGraph(safe)));
  const html = previewHtml('example', '<img src=x onerror=alert(1)>', exampleGraph()); assert.ok(html.includes('&lt;img')); assert.ok(!html.includes('<img src=x'));
  const files = standaloneFiles('example', 'Orders', exampleGraph()); assert.ok(files['app.mjs'].includes('/api/orders')); assert.ok(files['pipeline.mjs'].includes('runPipeline'));
});
test('capture redacts credentials and limits nested values', () => {
  const value = safeSnapshot({ password: 'secret', payload: { Authorization: 'Bearer abc', value: 200 }, long: 'a'.repeat(4000) });
  assert.equal(value.password, '[已脱敏]'); assert.equal(value.payload.Authorization, '[已脱敏]'); assert.equal(value.payload.value, 200); assert.equal(value.long.length, 2000);
});
test('importer reports actual dependencies and blocks source traversal', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'modular-import-'));
  await writeFile(path.join(root, 'a.ts'), "import { price } from './b.js'; export function order() { return price(2); }");
  await writeFile(path.join(root, 'b.ts'), 'export const price = (quantity: number) => quantity * 100;');
  const result = await analyzeProject(root); assert.equal(result.fileCount, 2); assert.equal(result.graph.edges.length, 1); assert.equal(result.graph.nodes[0].data.kind, 'source');
  assert.ok((await readProjectSource(root, 'b.ts')).includes('price'));
  const outside = path.join(root, '..', 'outside-modular.ts'); await writeFile(outside, 'const secret = true;'); await assert.rejects(readProjectSource(root, '../outside-modular.ts'), /范围/);
});
