import { makeNode, type Expression, type Graph, type GraphNode } from '../shared/model.js';
import { executionOrder, parseGraph } from './domain.js';

function fields(expression: Expression | { kind: 'literal'; value: unknown }): string[] {
  return expression.kind === 'field' ? [expression.name] : expression.kind === 'math' ? [...fields(expression.left), ...fields(expression.right)] : [];
}
function requirements(node: GraphNode) {
  const c = node.data.config;
  if (node.data.kind === 'list') return [c.field as string];
  if (node.data.kind === 'text') return [...c.template.matchAll(/\{\{([a-zA-Z_][a-zA-Z0-9_]{0,63})\}\}/g)].map((m: RegExpMatchArray) => m[1]);
  if (node.data.kind === 'validate') return [c.field as string];
  if (node.data.kind === 'transform') return fields(c.expression);
  if (node.data.kind === 'custom') {
    const written = new Set<string>(), required = new Set<string>();
    for (const op of c.operations) { for (const name of fields(op.value)) if (!written.has(name)) required.add(name); written.add(op.field); }
    return [...required];
  }
  return [];
}
function outputs(node: GraphNode): string[] {
  return ['transform','value','text','list'].includes(node.data.kind) ? [node.data.config.outputField] : node.data.kind === 'custom' ? node.data.config.operations.map((o: any) => o.field) : node.data.kind === 'database' ? ['recordId'] : [];
}
export function planGraph(value: unknown) {
  const graph = parseGraph(value), changes: string[] = [], warnings: string[] = [];
  const fail = (message: string) => ({ graph: null as Graph | null, changes, warnings, errors: [message] });
  if (graph.nodes.some(n => n.data.kind === 'source')) return fail('导入源码为只读结构图，不能自动改造成可执行蓝图。');
  if (!graph.nodes.length) return fail('请至少放入一个功能模块，或从订单模板开始。');
  const envelope: Record<string, GraphNode> = {};
  for (const kind of ['form', 'api', 'response', 'view'] as const) {
    const matches = graph.nodes.filter(n => kind === 'form' ? ['form','event'].includes(n.data.kind) : n.data.kind === kind);
    if (matches.length > 1) return fail(`存在多个${matches[0].data.label}类型模块，请先选择要保留的入口或输出；不会自动删除模块。`);
    if (matches[0]) envelope[kind] = matches[0];
    else {
      let id = `auto_${kind}`; while (graph.nodes.some(n => n.id === id)) id += '_';
      const node = makeNode(kind, id); graph.nodes.push(node); envelope[kind] = node;
      changes.push(`补充「${node.data.label}」模块${kind === 'form' ? '，使用示例输入字段，请检查并调整' : ''}`);
    }
  }
  let ordered: GraphNode[] | undefined;
  try { ordered = executionOrder(graph); } catch { /* An incomplete graph gets a reviewable proposal below. */ }
  if (!ordered) {
    // Layout coordinates never decide execution. Prefer a valid existing path, then data dependencies.
    const available = new Set<string>(envelope.form.data.config.fields.map((f: any) => f.name));
    const rank = { validate: 0, transform: 1, custom: 1, database: 2 };
    const pending = graph.nodes.filter(n => !Object.values(envelope).includes(n)).sort((a, b) => (rank[a.data.kind as keyof typeof rank] ?? 1) - (rank[b.data.kind as keyof typeof rank] ?? 1));
    const processing: GraphNode[] = [];
    while (pending.length) {
      const index = pending.findIndex(n => requirements(n).every(f => available.has(f)));
      if (index < 0) return fail(pending.map(n => `「${n.data.label}」缺少先前生成的字段：${requirements(n).filter(f => !available.has(f)).join('、')}`).join('；') + '。请补充表单字段、修改表达式或显式连接字段映射。');
      const [node] = pending.splice(index, 1); processing.push(node); outputs(node).forEach(f => available.add(f));
    }
    ordered = [envelope.form, envelope.api, ...processing, envelope.response, envelope.view];
  }
  // Check the first pass, including existing edge mappings. Later loop passes cannot supply missing initial input.
  const firstPass = new Set<string>(envelope.form.data.config.fields.map((f: any) => f.name));
  for (const node of ordered) {
    const incoming = graph.edges.find(e => e.target === node.id && !e.data?.loop);
    for (const operation of incoming?.data?.custom?.operations || []) {
      const missing = fields(operation.value).filter(name => !firstPass.has(name));
      if (missing.length) return fail(`进入「${node.data.label}」的映射缺少字段：${missing.join('、')}。请补充初始输入或先生成字段。`);
      firstPass.add(operation.field);
    }
    const missing = requirements(node).filter(name => !firstPass.has(name));
    if (missing.length) return fail(`「${node.data.label}」缺少首次执行所需字段：${missing.join('、')}。请补充表单字段或调整前置处理。`);
    outputs(node).forEach(name => firstPass.add(name));
  }
  const loops = graph.edges.filter(e => e.data?.loop);
  const forward = graph.edges.filter(e => !e.data?.loop);
  const ids = new Set(graph.edges.map(e => e.id));
  const nextId = () => { let id = `auto_edge_${ids.size}`; while (ids.has(id)) id += '_'; ids.add(id); return id; };
  const links = ordered.slice(1).map((node, i) => forward.find(e => e.source === ordered![i].id && e.target === node.id) || { id: nextId(), source: ordered![i].id, target: node.id, label: '数据传递' });
  for (const edge of forward.filter(e => !links.includes(e))) {
    const from = ordered.findIndex(n => n.id === edge.source), to = ordered.findIndex(n => n.id === edge.target);
    if (to >= 2 && from <= ordered.length - 3 && from >= to && !loops.some(e => e.source === edge.source)) {
      loops.push({ ...edge, data: { ...edge.data, loop: { maxIterations: 3 } } });
      changes.push(`将「${ordered[from].data.label} → ${ordered[to].data.label}」回路线设为固定 3 轮；可在连线设置中修改`);
    } else if (edge.data?.custom) return fail('整理会改变带自定义字段映射的连线，已保留原图；请先手动调整相关连线。');
    else changes.push(`移除未定义的连接「${graph.nodes.find(n => n.id === edge.source)?.data.label} → ${graph.nodes.find(n => n.id === edge.target)?.data.label}」`);
  }
  const created = links.filter(e => !forward.includes(e)).length;
  if (created) changes.push(`按输入、数据依赖、输出顺序建立 ${created} 条连接`);
  const proposed: Graph = { ...graph, nodes: ordered.map((n, i) => ({ ...n, position: { x: 60 + (Math.floor(i / 3) % 2 ? 2 - i % 3 : i % 3) * 310, y: 80 + Math.floor(i / 3) * 210 } })), edges: [...links, ...loops] };
  try { executionOrder(proposed); } catch (e) { return fail((e as Error).message); }
  if (loops.some(e => proposed.nodes.slice(ordered!.findIndex(n => n.id === e.target), ordered!.findIndex(n => n.id === e.source) + 1).some(n => n.data.kind === 'database'))) warnings.push('循环体包含数据存储，每轮都会写入一条记录；失败不会回滚已完成的写入。');
  if (!changes.length) changes.push('保留现有执行顺序与连线，整理画布布局');
  warnings.push('此方案检查连接与可推断的字段依赖，不代替业务验收；请确认顺序，再用预览和调试验证。');
  return { graph: proposed as Graph | null, changes, warnings, errors: [] as string[] };
}
