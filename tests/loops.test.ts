import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { exampleGraph, loopExampleGraph, makeNode, type Graph } from '../shared/model.js';
import { parseGraph, executionOrder } from '../server/domain.js';
import { compileGraph, standaloneFiles } from '../server/compiler.js';
import { planGraph } from '../server/planner.js';
async function runner(graph: Graph) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'modular-loop-'));
  const file = path.join(root, 'pipeline.mjs'); await writeFile(file, compileGraph(parseGraph(graph)).code);
  const { runPipeline } = await import(pathToFileURL(file).href);
  return { runPipeline, databasePath: path.join(root, 'records.sqlite') };
}
const input = { sku: 'LOOP', quantity: 2, unitPrice: 100, total: 0 };
test('fixed loop records distinct visits and exports the same bounded executable', async () => {
  const graph = loopExampleGraph(); const { runPipeline, databasePath } = await runner(graph); const steps: any[] = [];
  const output = await runPipeline(input, { databasePath, onStep: (s: any) => steps.push(s) });
  assert.equal(output.total, 300);
  const visits = steps.filter(s => s.nodeId === 'calculate_total' && s.status === 'ok');
  assert.deepEqual(visits.map(s => s.visit), [1, 2, 3]);
  assert.deepEqual(visits.map(s => s.input.total), [0, 100, 200]);
  assert.deepEqual(visits.map(s => s.output.total), [100, 200, 300]);
  assert.equal(visits[1].viaEdgeId, 'repeat_total');
  assert.equal(new Set(steps.filter(s => s.status === 'ok').map(s => s.sequence)).size, 9);
  const db = new DatabaseSync(databasePath); assert.equal((db.prepare('SELECT count(*) AS n FROM records').get() as any).n, 1); db.close();
  assert.match(standaloneFiles('loop', 'Loop', graph)['pipeline.mjs'], /repeat_total/);
});
test('conditional loop exits on post-body condition, but fails on exhausted bound or missing field', async () => {
  const graph = loopExampleGraph(); graph.edges.at(-1)!.data!.loop = { maxIterations: 5, condition: { field: 'total', op: '<', value: 250 } };
  let run = await runner(graph); assert.equal((await run.runPipeline(input, run)).total, 300);
  graph.edges.at(-1)!.data!.loop!.maxIterations = 2; run = await runner(graph); const steps: any[] = [];
  await assert.rejects(run.runPipeline(input, { ...run, onStep: (s: any) => steps.push(s) }), /退出条件仍未满足/);
  assert.equal(steps.at(-1).status, 'error'); assert.ok(!steps.some(s => s.nodeId === 'save_order'));
  graph.edges.at(-1)!.data!.loop!.condition!.field = 'missing'; run = await runner(graph);
  await assert.rejects(run.runPipeline(input, run), /循环条件字段 missing/);
});
test('return edge mappings run only when that edge is traversed; forward mapping is not repeated', async () => {
  const graph = loopExampleGraph();
  graph.edges.find(e => e.target === 'calculate_total' && !e.data?.loop)!.data = { custom: { instructions: 'init', generatedFor: 'init', operations: [{ field: 'total', value: { kind: 'number', value: 0 } }] } };
  graph.edges.at(-1)!.data!.custom = { instructions: 'add bonus', generatedFor: 'add bonus', operations: [{ field: 'total', value: { kind: 'math', op: '+', left: { kind: 'field', name: 'total' }, right: { kind: 'number', value: 1 } } }] };
  const run = await runner(graph); assert.equal((await run.runPipeline(input, run)).total, 302);
});
test('nested loops reset inner counters; crossing loops and unsafe limits are rejected', async () => {
  const graph = loopExampleGraph();
  graph.nodes.push({ ...makeNode('transform', 'outer'), data: { kind: 'transform', label: 'outer', description: '', config: { outputField: 'outer', expression: { kind: 'number', value: 1 } } } });
  graph.edges.find(e => e.source === 'calculate_total' && !e.data?.loop)!.source = 'outer';
  graph.edges.push({ id: 'to_outer', source: 'calculate_total', target: 'outer' }, { id: 'outer_loop', source: 'outer', target: 'calculate_total', data: { loop: { maxIterations: 2 } } });
  const run = await runner(graph); assert.equal((await run.runPipeline(input, run)).total, 600);
  graph.edges.push({ id: 'crossing', source: 'save_order', target: 'outer', data: { loop: { maxIterations: 2 } } });
  assert.throws(() => executionOrder(graph), /交叉/);
  graph.edges.at(-1)!.data!.loop!.maxIterations = 0; assert.throws(() => parseGraph(graph));
  graph.edges.at(-1)!.data!.loop!.maxIterations = 101; assert.throws(() => parseGraph(graph));
});
test('global step budget stops excessive nested loops without running remaining storage', async () => {
  const graph = loopExampleGraph(); graph.edges.at(-1)!.data!.loop!.maxIterations = 100;
  const outer = makeNode('transform', 'outer'); outer.data.config = { outputField: 'outer', expression: { kind: 'number', value: 1 } }; graph.nodes.push(outer);
  graph.edges.find(e => e.source === 'calculate_total' && !e.data?.loop)!.source = 'outer';
  graph.edges.push({ id: 'to_outer', source: 'calculate_total', target: 'outer' }, { id: 'outer_loop', source: 'outer', target: 'calculate_total', data: { loop: { maxIterations: 100 } } });
  const run = await runner(graph); const steps: any[] = [];
  await assert.rejects(run.runPipeline(input, { ...run, onStep: (s: any) => steps.push(s) }), /2000 步/);
  assert.equal(steps.at(-1).sequence, 2001); assert.ok(!steps.some(s => s.nodeId === 'save_order'));
});
test('planner handles shuffled disconnected modules, infers dependencies, preserves IDs and does not mutate input', () => {
  const graph = exampleGraph(); graph.nodes.reverse(); graph.edges = []; const original = JSON.stringify(graph);
  const planned = planGraph(graph); assert.deepEqual(planned.errors, []); assert.equal(executionOrder(planned.graph!).length, 7);
  assert.equal(JSON.stringify(graph), original); assert.deepEqual(new Set(planned.graph!.nodes.map(n => n.id)), new Set(graph.nodes.map(n => n.id)));
  assert.equal(planned.graph!.nodes[3].id, 'calculate_total');
  const minimal = { nodes: [makeNode('transform', 'calc')], edges: [] }; assert.equal(planGraph(minimal).graph!.nodes.length, 5);
});
test('planner proposes explicit bounded back edges, refuses missing fields and custom mapping loss', () => {
  const cycle = loopExampleGraph(); delete cycle.edges.at(-1)!.data;
  assert.equal(planGraph(cycle).graph!.edges.find(e => e.id === 'repeat_total')?.data?.loop?.maxIterations, 3);
  const missing = exampleGraph(); missing.edges = []; missing.nodes[3].data.config.expression = { kind: 'field', name: 'absent' };
  assert.match(planGraph(missing).errors[0], /absent/);
  missing.edges = exampleGraph().edges; assert.match(planGraph(missing).errors[0], /首次执行.*absent/);
  const ambiguous = exampleGraph(); ambiguous.edges.push({ id: 'mapping', source: 'order_form', target: 'show_receipt', data: { custom: { instructions: 'copy', generatedFor: 'copy', operations: [] } } });
  assert.equal(planGraph(ambiguous).graph, null); assert.match(planGraph(ambiguous).errors[0], /映射/);
});
