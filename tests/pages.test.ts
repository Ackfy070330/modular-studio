import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Script } from 'node:vm';
import { webGraph, makePageBlock } from '../shared/page.js';
import { exampleGraph } from '../shared/model.js';
import { parseGraph, executionOrder } from '../server/domain.js';
import { compileGraph, previewHtml, standaloneFiles } from '../server/compiler.js';
import { planGraph } from '../server/planner.js';
async function generated(graph: ReturnType<typeof webGraph>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'modular-page-'));
  const file = path.join(dir, 'pipeline.mjs'); await writeFile(file, compileGraph(parseGraph(graph)).code);
  return import(pathToFileURL(file).href);
}

test('all web project types preserve their page and execute button input without a form', async () => {
  for (const type of ['landing','dashboard','website'] as const) {
    const graph = parseGraph(webGraph(type)); assert.equal(graph.page?.projectType,type); assert.equal(executionOrder(graph)[0].data.kind,'event');
    const pipeline = await generated(graph); const result=await pipeline.runPipeline({name:'小林',eventId:'run_button'});
    assert.equal(result.count,3); assert.match(result.message,/你好，小林/); assert.equal(result.eventId,'run_button');
    const fallback=await pipeline.runPipeline({});assert.match(fallback.message,/你好，朋友/);
    const html=previewHtml('p','测试网站',graph);assert.ok(html.includes('data-action="run"'));assert.ok(html.includes('data-field="name"'));assert.ok(html.includes('renderData(body.output)'));
    const script=html.match(/<script>([\s\S]*)<\/script>/)![1]; new Script(script);
    const files=standaloneFiles('p','测试网站',graph);assert.ok(files['index.html'].includes('endpoint="/api/action"'));assert.deepEqual(JSON.parse(files['blueprint.json']).page,graph.page);
  }
  assert.equal(parseGraph(webGraph('website',true)).page?.blocks.length,0);
});

test('new text, value and list modules operate on real data and fail on missing dependencies', async () => {
  const graph=webGraph('dashboard'); const list=graph.nodes.find(n=>n.data.kind==='list')!;
  list.data.config.operation='first';let pipeline=await generated(graph);assert.deepEqual((await pipeline.runPipeline({})).count,{name:'页面设计',status:'已连接'});
  list.data.config.operation='last';pipeline=await generated(graph);assert.deepEqual((await pipeline.runPipeline({})).count,{name:'数据展示',status:'待绑定'});
  graph.nodes.find(n=>n.data.kind==='value')!.data.config.value=42;pipeline=await generated(graph);await assert.rejects(pipeline.runPipeline({}),/必须为列表/);
  graph.nodes.find(n=>n.data.kind==='text')!.data.config.template='{{missing}}';pipeline=await generated(graph);await assert.rejects(pipeline.runPipeline({}),/missing/);
});

test('planning preserves page design and understands event, text and list dependencies', () => {
  const graph=webGraph('dashboard');const original=structuredClone(graph);graph.edges=[];graph.nodes.reverse();
  const planned=planGraph(graph);assert.deepEqual(planned.errors,[]);assert.deepEqual(planned.graph?.page,original.page);assert.equal(executionOrder(planned.graph!)[0].data.kind,'event');
  graph.nodes.find(n=>n.data.kind==='text')!.data.config.template='{{missing}}';assert.match(planGraph(graph).errors.join(''),/missing/);
  assert.equal(executionOrder(parseGraph(exampleGraph())).length,7);
});

test('page validates geometry, bindings and actions; user text cannot inject HTML or scripts', () => {
  const graph=webGraph('landing');const page=graph.page!;
  page.blocks.find(b=>b.kind==='heading')!.text='</script><img src=x onerror=alert(1)>';
  const html=previewHtml('p','<script>bad()</script>',parseGraph(graph));assert.equal((html.match(/<script>/g)||[]).length,1);assert.ok(html.includes('&lt;img'));assert.ok(html.includes('\\u003c/script>'));
  new Script(html.match(/<script>([\s\S]*)<\/script>/)![1]);
  const bad=(edit:(g:typeof graph)=>void)=>{const next=structuredClone(graph);edit(next);assert.throws(()=>parseGraph(next));};
  bad(g=>g.page!.blocks[0].background='red;position:fixed');bad(g=>g.page!.blocks[0].width=10000);
  bad(g=>g.page!.blocks.push({...g.page!.blocks[0]}));bad(g=>g.page!.blocks.find(b=>b.kind==='input')!.field='__proto__');
  bad(g=>g.page!.blocks.find(b=>b.kind==='image')!.imageUrl='javascript:alert(1)');
  bad(g=>{g.page!.blocks[0].action='toggle';g.page!.blocks[0].target='missing';});
  bad(g=>{g.page!.projectType='game' as any;});
  const toggle=makePageBlock('button','toggle',20,20);toggle.action='toggle';toggle.target='message';page.blocks.push(toggle);page.blocks.find(b=>b.id==='message')!.hidden=true;
  assert.ok(previewHtml('p','test',parseGraph(graph)).includes('hidden>'));
});
