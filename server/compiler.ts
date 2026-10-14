import type { Graph, GraphNode } from '../shared/model.js';
import { executionOrder } from './domain.js';
import { designedPageHtml } from './page-compiler.js';
export function compileGraph(graph: Graph) {
  const ordered = executionOrder(graph);
  const bindings: Record<string, number> = {};
  const lines = [
    `import { DatabaseSync } from 'node:sqlite';`,
    `import { randomUUID } from 'node:crypto';`,
    `export const nodes = ${JSON.stringify(ordered.map(n => ({ id: n.id, ...n.data })))};`,
    `function evaluate(e, data) {`,
    `  if (e.kind === 'number') return e.value;`,
    `  if (e.kind === 'field') { const v = data[e.name]; if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('字段 ' + e.name + ' 必须是有效数字'); return v; }`,
    `  const a = evaluate(e.left, data), b = evaluate(e.right, data);`,
    `  if (e.op === '/' && b === 0) throw new Error('除数不能为零');`,
    `  const v = e.op === '+' ? a + b : e.op === '-' ? a - b : e.op === '*' ? a * b : a / b;`,
    `  if (!Number.isFinite(v)) throw new Error('计算结果溢出'); return v;`,
    `}`,
    `function assignFields(initial, operations) {`,
    `  const data = { ...initial };`,
    `  for (const op of operations) {`,
    `    const e = op.value;`,
    `    if (e.kind === 'field' && !Object.hasOwn(data, e.name)) throw new Error('映射字段 ' + e.name + ' 不存在');`,
    `    data[op.field] = e.kind === 'literal' ? e.value : e.kind === 'field' ? structuredClone(data[e.name]) : evaluate(e, data);`,
    `  } return data;`,
    `}`,
  ];
  ordered.forEach((node, index) => {
    lines.push(``, `// Module: ${node.id}`);
    bindings[node.id] = lines.length + 1;
    lines.push(`async function step_${index}(data, context) {`, `  const config = ${JSON.stringify(node.data.config)};`, `  if (context.breakpoints.includes(${JSON.stringify(node.id)})) { debugger; }`);
    switch (node.data.kind) {
      case 'event': lines.push(`  const output = { ...data }; for (const f of config.fields) { if (output[f.name] === undefined || output[f.name] === '') output[f.name] = f.value; if (f.type === 'number' && (typeof output[f.name] !== 'number' || !Number.isFinite(output[f.name]))) throw new Error(f.label + ' 必须是数字'); } return output;`); break;
      case 'value': lines.push(`  return { ...data, [config.outputField]: structuredClone(config.value) };`); break;
      case 'text': lines.push(`  const text = config.template.replace(/\{\{([a-zA-Z_][a-zA-Z0-9_]{0,63})\}\}/g, (_, field) => { if (!Object.hasOwn(data, field)) throw new Error('文本字段 ' + field + ' 不存在'); return typeof data[field] === 'object' ? JSON.stringify(data[field]) : String(data[field]); }); return { ...data, [config.outputField]: text };`); break;
      case 'list': lines.push(`  const items = data[config.field]; if (!Array.isArray(items)) throw new Error(config.field + ' 必须为列表'); return { ...data, [config.outputField]: config.operation === 'count' ? items.length : (config.operation === 'first' ? items[0] : items.at(-1)) ?? null };`); break;
      case 'form': lines.push(`  for (const f of config.fields) { if (data[f.name] === undefined || data[f.name] === '') throw new Error('请填写 ' + f.label); if (f.type === 'number' && (typeof data[f.name] !== 'number' || !Number.isFinite(data[f.name]))) throw new Error(f.label + ' 必须是数字'); }`, `  return { ...data };`); break;
      case 'validate': lines.push(`  if (typeof data[config.field] !== 'number' || data[config.field] < config.minimum) throw new Error(config.field + ' 必须大于等于 ' + config.minimum);`, `  return { ...data };`); break;
      case 'transform': lines.push(`  const result = evaluate(config.expression, data);`, `  return { ...data, [config.outputField]: result };`); break;
      case 'custom': lines.push(`  return assignFields(data, config.operations);`); break;
      case 'database': lines.push(`  const db = new DatabaseSync(context.databasePath);`, `  try {`, `    db.exec('CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, collection TEXT, body TEXT, created_at TEXT)');`, `    const output = { ...data, recordId: randomUUID() };`, `    db.prepare('INSERT INTO records VALUES (?, ?, ?, ?)').run(output.recordId, config.collection, JSON.stringify(output), new Date().toISOString());`, `    return output;`, `  } finally { db.close(); }`); break;
      default: lines.push(`  return { ...data };`);
    }
    lines.push(`}`);
  });
  lines.push(`const functions = [${ordered.map((_, i) => `step_${i}`).join(', ')}];`,
    `const forward = ${JSON.stringify(ordered.map(n => graph.edges.find(e => e.target === n.id && !e.data?.loop) || null))};`,
    `const loops = ${JSON.stringify(graph.edges.filter(e => e.data?.loop).map(e => ({ ...e, start: ordered.findIndex(n => n.id === e.target), end: ordered.findIndex(n => n.id === e.source) })))};`,
    `function shouldRepeat(condition, data) {`,
    `  if (!condition) return true; const value = data[condition.field];`,
    `  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('循环条件字段 ' + condition.field + ' 必须是有效数字');`,
    `  const target = condition.value; return condition.op === '<' ? value < target : condition.op === '<=' ? value <= target : condition.op === '>' ? value > target : condition.op === '>=' ? value >= target : condition.op === '==' ? value === target : value !== target;`,
    `}`,
    `export async function runPipeline(initial, options = {}) {`,
    `  const context = { databasePath: options.databasePath || './data.sqlite', breakpoints: options.breakpoints || [] };`,
    `  let data = structuredClone(initial), i = 0, sequence = 0, incoming = null;`,
    `  const visits = new Map(), iterations = new Map();`,
    `  while (i < nodes.length) {`,
    `    const node = nodes[i], startedAt = new Date().toISOString(), begin = performance.now(), input = structuredClone(data);`,
    `    const visit = (visits.get(node.id) || 0) + 1; visits.set(node.id, visit);`,
    `    const base = { nodeId: node.id, sequence: ++sequence, visit, viaEdgeId: incoming?.id, label: node.label, kind: node.kind, startedAt, input };`,
    `    try {`,
    `      if (sequence > 2000) throw new Error('执行超过 2000 步，已停止；请减少循环次数或修正退出条件');`,
    `      data = assignFields(data, incoming?.data?.custom?.operations || []); base.input = structuredClone(data);`,
    `      await options.onStep?.({ ...base, status: 'running' }); data = await functions[i](data, context);`,
    `      const loop = loops.find(edge => edge.end === i); let next = i + 1, nextEdge = forward[next];`,
    `      if (loop) {`,
    `        const count = (iterations.get(loop.id) || 0) + 1; iterations.set(loop.id, count);`,
    `        const config = loop.data.loop, repeat = shouldRepeat(config.condition, data);`,
    `        if (config.condition && repeat && count >= config.maxIterations) throw new Error('循环 ' + (loop.label || loop.id) + ' 达到 ' + config.maxIterations + ' 轮上限，退出条件仍未满足');`,
    `        if (repeat && count < config.maxIterations) {`,
    `          next = loop.start; nextEdge = loop; base.loopDecision = '返回 · 第 ' + (count + 1) + ' 轮 / 上限 ' + config.maxIterations;`,
    `          for (const inner of loops) if (inner.id !== loop.id && inner.start >= loop.start && inner.end < loop.end) iterations.delete(inner.id);`,
    `        } else { base.loopDecision = '退出循环 · 已完成 ' + count + ' 轮'; iterations.delete(loop.id); }`,
    `      }`,
    `      await options.onStep?.({ ...base, status: 'ok', output: structuredClone(data), durationMs: performance.now() - begin });`,
    `      i = next; incoming = nextEdge;`,
    `    }`,
    `    catch (error) { await options.onStep?.({ ...base, status: 'error', error: error.message, durationMs: performance.now() - begin }); throw error; }`,
    `  }`, `  return data;`, `}`);
  return { code: lines.join('\n'), bindings, ordered };
}
export function previewHtml(projectId: string, name: string, graph: Graph, standalone = false) {
  if (graph.page) return designedPageHtml(projectId, name, graph, standalone);
  const form = graph.nodes.find(n => n.data.kind === 'form');
  const title = graph.nodes.find(n => n.data.kind === 'view')?.data.config.title || '执行成功';
  const escape = (s: unknown) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  const action = standalone ? (graph.nodes.find(n => n.data.kind === 'api')?.data.config.path || '/api/run') : `/api/projects/${projectId}/execute`;
  const fields = (form?.data.config.fields || []).map((f: any) => `<label>${escape(f.label)}<input name="${escape(f.name)}" type="${f.type === 'number' ? 'number' : 'text'}" value="${escape(f.value)}" required ${f.type === 'number' ? 'step="any"' : ''}></label>`).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(name)}</title><style>*{box-sizing:border-box}body{font:14px system-ui,sans-serif;background:#f4f5f9;color:#243047;margin:0;padding:56px 24px}main{max-width:440px;margin:auto;background:white;padding:36px;border-radius:22px;box-shadow:0 16px 50px #1720380b}small{letter-spacing:2px;color:#8070c9}h1{font-size:25px;margin:22px 0 8px}p{color:#8490a1;line-height:1.8}label{display:block;font-size:12px;color:#556174;margin:22px 0}input{display:block;margin-top:8px;width:100%;padding:12px;border:1px solid #dfe3eb;border-radius:9px;font:inherit}button{border:0;border-radius:9px;padding:13px;background:#7561d5;color:white;width:100%;font:inherit;cursor:pointer}button:disabled{opacity:.5}pre{overflow:auto;background:#f5f6fa;padding:16px;white-space:pre-wrap;border-radius:9px;font-size:12px}footer{text-align:center;color:#a2aaba;font-size:11px;margin-top:24px}</style></head><body><main><small>BUILT WITH MODULAR</small><h1>${escape(name)}</h1><p>由功能蓝图生成 · 提交后实际执行后端流程</p><form id="form">${fields}<button>提交并执行</button></form><pre id="result" hidden></pre></main><footer>模序 · 把想法连接成产品</footer><script>
const form = document.getElementById('form'), result = document.getElementById('result');
form.onsubmit = async e => { e.preventDefault(); form.querySelector('button').disabled = true; const input = {}; for(const el of form.querySelectorAll('input')) input[el.name] = el.type === 'number' ? Number(el.value) : el.value;
try { const res = await fetch(${JSON.stringify(action)}, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({input}) }); const body = await res.json(); if(!res.ok) throw new Error(body.message || '执行失败'); result.textContent = ${JSON.stringify(title).replace(/</g, '\u003c')} + '\\n\\n' + JSON.stringify(body.output, null, 2); } catch(e) { result.textContent = e.message; } finally { result.hidden = false; form.querySelector('button').disabled = false; } };
</script></body></html>`;
}
export function standaloneFiles(projectId: string, name: string, graph: Graph) {
  const compiled = compileGraph(graph);
  const apiNode = graph.nodes.find(n => n.data.kind === 'api')!;
  const status = graph.nodes.find(n => n.data.kind === 'response')!.data.config.statusCode;
  const app = `import http from 'node:http';\nimport { readFileSync } from 'node:fs';\nimport { runPipeline } from './pipeline.mjs';\nconst server = http.createServer(async (req, res) => {\n  if (req.method === 'GET' && req.url === '/') { res.setHeader('content-type', 'text/html; charset=utf-8'); return res.end(readFileSync(new URL('./index.html', import.meta.url))); }\n  if(req.method !== 'POST' || req.url !== ${JSON.stringify(apiNode.data.config.path)}) {res.writeHead(404); return res.end('Not found');}\n  res.setHeader('content-type','application/json; charset=utf-8');\n  try { let raw = ''; for await (const chunk of req) {raw += chunk; if(raw.length > 65536) throw new Error('请求过大');}\n    const body = JSON.parse(raw); if(!body.input || typeof body.input !== 'object' || Array.isArray(body.input)) throw new Error('input 必须是对象');\n    const output = await runPipeline(body.input); res.writeHead(${status}); res.end(JSON.stringify({output}));\n  } catch(e) {res.writeHead(400); res.end(JSON.stringify({message:e.message}));}\n});\nserver.listen(4321,'127.0.0.1',()=>console.log('http://127.0.0.1:4321'));\n`;
  return { 'pipeline.mjs': compiled.code, 'app.mjs': app, 'index.html': previewHtml(projectId, name, graph, true), 'blueprint.json': JSON.stringify(graph, null, 2), 'package.json': JSON.stringify({ name: 'modular-generated-app', private: true, type: 'module', scripts: { start: 'node app.mjs' }, engines: { node: '>=24' } }, null, 2), 'README.md': `# ${name}\n\n由模序生成的独立前后端应用。需要 Node.js 24 或更新版本，无需安装第三方依赖。\n\n运行 npm start，再访问 http://127.0.0.1:4321 。数据保存在运行目录下的 data.sqlite。\n\n页面输入会发送至 ${apiNode.data.config.path}，由 pipeline.mjs 执行。当前为本机开发版本。\n` };
}
