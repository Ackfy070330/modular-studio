import { z } from 'zod';
import { pageSchema } from './page-domain.js';
import type { Expression, Graph } from '../shared/model.js';
const fieldName = z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/).refine(s => !['__proto__', 'constructor', 'prototype'].includes(s));
const expression: z.ZodType<Expression> = z.lazy(() => z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('field'), name: fieldName }),
  z.object({ kind: z.literal('number'), value: z.number().finite() }),
  z.object({ kind: z.literal('math'), op: z.enum(['+', '-', '*', '/']), left: expression, right: expression }),
]));
export const operationsSchema = z.array(z.object({ field: fieldName, value: z.union([expression, z.object({ kind: z.literal('literal'), value: z.union([z.string().max(2000), z.number().finite(), z.boolean(), z.null()]) })]) })).max(20);
export const customContentSchema = z.object({ instructions: z.string().max(4000), operations: operationsSchema, generatedFor: z.string().max(4000).optional() });
export const loopSchema = z.object({ maxIterations: z.number().int().min(1).max(100), condition: z.object({ field: fieldName, op: z.enum(['<', '<=', '>', '>=', '==', '!=']), value: z.number().finite() }).optional() });
const configs = {
  event: z.object({ fields: z.array(z.object({ name: fieldName, label: z.string().max(80), type: z.enum(['text','number']), value: z.union([z.string().max(2000),z.number().finite()]) })).max(20) }),
  value: z.object({ outputField: fieldName, value: z.unknown().refine(v => v !== undefined && JSON.stringify(v).length <= 12000, '数据值过大或无效') }),
  text: z.object({ outputField: fieldName, template: z.string().max(2000) }),
  list: z.object({ field: fieldName, outputField: fieldName, operation: z.enum(['count','first','last']) }),
  form: z.object({ fields: z.array(z.object({ name: fieldName, label: z.string().max(80), type: z.enum(['text', 'number']), value: z.union([z.string(), z.number()]) })).min(1).max(20) }),
  api: z.object({ method: z.literal('POST'), path: z.string().regex(/^\/[a-zA-Z0-9_\-/]*$/).max(150) }),
  validate: z.object({ field: fieldName, minimum: z.number().finite() }),
  transform: z.object({ outputField: fieldName, expression }),
  database: z.object({ collection: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/) }),
  response: z.object({ statusCode: z.number().int().min(200).max(299) }),
  view: z.object({ title: z.string().max(100) }),
  source: z.record(z.string(), z.unknown()),
  custom: customContentSchema,
};
const graphSchema = z.object({
  page: pageSchema.optional(),
  nodes: z.array(z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), type: z.literal('module'), position: z.object({ x: z.number().finite(), y: z.number().finite() }), data: z.object({ label: z.string().min(1).max(100), description: z.string().max(500), kind: z.enum(['event', 'value', 'text', 'list', 'form', 'api', 'validate', 'transform', 'database', 'response', 'view', 'source', 'custom']), config: z.record(z.string(), z.unknown()) }) })).max(200),
  edges: z.array(z.object({ id: z.string().min(1).max(100), source: z.string(), target: z.string(), label: z.string().max(100).optional(), data: z.object({ custom: customContentSchema.optional(), loop: loopSchema.optional() }).optional() })).max(400),
});
export function parseGraph(value: unknown): Graph {
  const graph = graphSchema.parse(value) as Graph;
  const ids = new Set(graph.nodes.map(n => n.id));
  if (ids.size !== graph.nodes.length) throw new Error('模块 ID 不能重复');
  const edgeIds = new Set<string>();
  for (const node of graph.nodes) {
    if (JSON.stringify(node.data.config).length > 20000) throw new Error('模块配置过大');
    node.data.config = configs[node.data.kind].parse(node.data.config);
  }
  for (const edge of graph.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) throw new Error('连线引用了不存在的模块');
    if (edgeIds.has(edge.id)) throw new Error('连线 ID 不能重复');
    edgeIds.add(edge.id);
  }
  return graph;
}
export function executionOrder(graph: Graph) {
  for (const item of [...graph.nodes.filter(n => n.data.kind === 'custom').map(n => ({ name: n.data.label, content: n.data.config })), ...graph.edges.filter(e => e.data?.custom).map(e => ({ name: e.label || '连线', content: e.data!.custom! }))]) {
    if (!item.content.instructions.trim() || item.content.generatedFor !== item.content.instructions) throw new Error(`${item.name} 的自定义内容尚未生成逻辑，请先生成并应用`);
  }
  if (graph.nodes.some(n => n.data.kind === 'source')) throw new Error('导入项目目前提供静态结构分析；不能作为蓝图直接执行');
  if (!graph.nodes.length) throw new Error('请先添加模块');
  const forward = graph.edges.filter(e => !e.data?.loop);
  const inputs = new Map(graph.nodes.map(n => [n.id, forward.filter(e => e.target === n.id)]));
  const outputs = new Map(graph.nodes.map(n => [n.id, forward.filter(e => e.source === n.id)]));
  if ([...inputs.values(), ...outputs.values()].some(a => a.length > 1)) throw new Error('存在未定义的分叉：回到前面步骤的连线请配置为循环，或使用自动整理预览连接方案');
  const starts = graph.nodes.filter(n => !inputs.get(n.id)!.length);
  if (starts.length !== 1) throw new Error('流程必须有且只有一个入口；请用自动整理连接模块，或为回路线配置循环');
  const ordered = []; const seen = new Set<string>(); let node = starts[0];
  while (node) {
    if (seen.has(node.id)) throw new Error('流程中存在环路');
    seen.add(node.id); ordered.push(node);
    const next = outputs.get(node.id)![0]?.target;
    node = graph.nodes.find(n => n.id === next)!;
  }
  if (ordered.length !== graph.nodes.length) throw new Error('存在未连接的模块或环路');
  if (!['form','event'].includes(ordered[0].data.kind)) throw new Error('流程应从表单输入或页面事件开始');
  if (ordered.at(-1)?.data.kind !== 'view') throw new Error('流程应以结果展示结束');
  if (ordered.filter(n => ['form','event'].includes(n.data.kind)).length !== 1 || ordered.filter(n => n.data.kind === 'view').length !== 1) throw new Error('流程只支持一个输入入口（表单或页面事件）与一个结果展示');
  if (ordered.filter(n => n.data.kind === 'api').length !== 1 || ordered.filter(n => n.data.kind === 'response').length !== 1) throw new Error('流程需要一个 API 接口和一个返回响应模块');
  if (ordered[1]?.data.kind !== 'api' || ordered.at(-2)?.data.kind !== 'response') throw new Error('API 应紧接表单，返回响应应紧接结果展示之前');
  const ranges: { start: number; end: number }[] = [];
  const loopSources = new Set<string>();
  for (const edge of graph.edges.filter(e => e.data?.loop)) {
    loopSchema.parse(edge.data!.loop);
    const start = ordered.findIndex(n => n.id === edge.target), end = ordered.findIndex(n => n.id === edge.source);
    if (start < 2 || end > ordered.length - 3 || start > end) throw new Error('循环必须从处理步骤返回自身或之前的处理步骤，不能包含表单、API、响应和展示');
    if (loopSources.has(edge.source)) throw new Error('同一个模块只能配置一条循环返回线');
    loopSources.add(edge.source);
    if (ranges.some(r => (r.start < start && start <= r.end && r.end < end) || (start < r.start && r.start <= end && end < r.end))) throw new Error('循环区间不能交叉；可以使用独立循环或完整嵌套循环');
    ranges.push({ start, end });
  }
  return ordered;
}
export function safeSnapshot(value: unknown, depth = 0): any {
  if (depth > 5) return '[超过深度限制]';
  if (typeof value === 'string') return value.slice(0, 2000);
  if (Array.isArray(value)) return value.slice(0, 50).map(v => safeSnapshot(v, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 80).map(([k, v]) => [k, /password|secret|token|authorization|cookie|api.?key/i.test(k) ? '[已脱敏]' : safeSnapshot(v, depth + 1)]));
  return value;
}
