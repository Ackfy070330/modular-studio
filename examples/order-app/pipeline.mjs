import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
export const nodes = [{"id":"order_form","kind":"form","label":"订单表单","description":"收集用户填写的数据","config":{"fields":[{"name":"sku","label":"商品编号","type":"text","value":"SKU-001"},{"name":"quantity","label":"数量","type":"number","value":2},{"name":"unitPrice","label":"单价（分）","type":"number","value":100}]}},{"id":"create_order","kind":"api","label":"创建订单接口","description":"定义请求与响应入口","config":{"method":"POST","path":"/api/orders"}},{"id":"validate_order","kind":"validate","label":"校验订单","description":"验证字段与业务约束","config":{"field":"quantity","minimum":1}},{"id":"calculate_total","kind":"transform","label":"计算订单金额","description":"用积木定义计算逻辑","config":{"outputField":"total","expression":{"kind":"math","op":"*","left":{"kind":"field","name":"unitPrice"},"right":{"kind":"field","name":"quantity"}}}},{"id":"save_order","kind":"database","label":"保存订单","description":"将结果写入本地数据库","config":{"collection":"orders"}},{"id":"return_order","kind":"response","label":"返回订单结果","description":"输出结构化处理结果","config":{"statusCode":201}},{"id":"show_receipt","kind":"view","label":"显示订单回执","description":"把执行结果呈现给用户","config":{"title":"订单创建成功"}}];
function evaluate(e, data) {
  if (e.kind === 'number') return e.value;
  if (e.kind === 'field') { const v = data[e.name]; if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('字段 ' + e.name + ' 必须是有效数字'); return v; }
  const a = evaluate(e.left, data), b = evaluate(e.right, data);
  if (e.op === '/' && b === 0) throw new Error('除数不能为零');
  const v = e.op === '+' ? a + b : e.op === '-' ? a - b : e.op === '*' ? a * b : a / b;
  if (!Number.isFinite(v)) throw new Error('计算结果溢出'); return v;
}

// Module: order_form
async function step_0(data, context) {
  const config = {"fields":[{"name":"sku","label":"商品编号","type":"text","value":"SKU-001"},{"name":"quantity","label":"数量","type":"number","value":2},{"name":"unitPrice","label":"单价（分）","type":"number","value":100}]};
  if (context.breakpoints.includes("order_form")) { debugger; }
  for (const f of config.fields) { if (data[f.name] === undefined || data[f.name] === '') throw new Error('请填写 ' + f.label); if (f.type === 'number' && (typeof data[f.name] !== 'number' || !Number.isFinite(data[f.name]))) throw new Error(f.label + ' 必须是数字'); }
  return { ...data };
}

// Module: create_order
async function step_1(data, context) {
  const config = {"method":"POST","path":"/api/orders"};
  if (context.breakpoints.includes("create_order")) { debugger; }
  return { ...data };
}

// Module: validate_order
async function step_2(data, context) {
  const config = {"field":"quantity","minimum":1};
  if (context.breakpoints.includes("validate_order")) { debugger; }
  if (typeof data[config.field] !== 'number' || data[config.field] < config.minimum) throw new Error(config.field + ' 必须大于等于 ' + config.minimum);
  return { ...data };
}

// Module: calculate_total
async function step_3(data, context) {
  const config = {"outputField":"total","expression":{"kind":"math","op":"*","left":{"kind":"field","name":"unitPrice"},"right":{"kind":"field","name":"quantity"}}};
  if (context.breakpoints.includes("calculate_total")) { debugger; }
  const result = evaluate(config.expression, data);
  return { ...data, [config.outputField]: result };
}

// Module: save_order
async function step_4(data, context) {
  const config = {"collection":"orders"};
  if (context.breakpoints.includes("save_order")) { debugger; }
  const db = new DatabaseSync(context.databasePath);
  try {
    db.exec('CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, collection TEXT, body TEXT, created_at TEXT)');
    const output = { ...data, recordId: randomUUID() };
    db.prepare('INSERT INTO records VALUES (?, ?, ?, ?)').run(output.recordId, config.collection, JSON.stringify(output), new Date().toISOString());
    return output;
  } finally { db.close(); }
}

// Module: return_order
async function step_5(data, context) {
  const config = {"statusCode":201};
  if (context.breakpoints.includes("return_order")) { debugger; }
  return { ...data };
}

// Module: show_receipt
async function step_6(data, context) {
  const config = {"title":"订单创建成功"};
  if (context.breakpoints.includes("show_receipt")) { debugger; }
  return { ...data };
}
const functions = [step_0, step_1, step_2, step_3, step_4, step_5, step_6];
export async function runPipeline(initial, options = {}) {
  const context = { databasePath: options.databasePath || './data.sqlite', breakpoints: options.breakpoints || [] };
  let data = structuredClone(initial);
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i], startedAt = new Date().toISOString(), begin = performance.now(), input = structuredClone(data);
    const base = { nodeId: node.id, label: node.label, kind: node.kind, startedAt, input };
    await options.onStep?.({ ...base, status: 'running' });
    try { data = await functions[i](data, context); await options.onStep?.({ ...base, status: 'ok', output: data, durationMs: performance.now() - begin }); }
    catch (error) { await options.onStep?.({ ...base, status: 'error', error: error.message, durationMs: performance.now() - begin }); throw error; }
  }
  return data;
}