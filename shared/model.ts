export type NodeKind = 'form' | 'api' | 'validate' | 'transform' | 'database' | 'response' | 'view' | 'source' | 'custom';
export type Expression = { kind: 'field'; name: string } | { kind: 'number'; value: number } | { kind: 'math'; op: '+' | '-' | '*' | '/'; left: Expression; right: Expression };
export type Assignment = { field: string; value: Expression | { kind: 'literal'; value: string | number | boolean | null } };
export interface CustomContent { instructions: string; operations: Assignment[]; generatedFor?: string }
export interface BlockData extends Record<string, unknown> {
  label: string; description: string; kind: NodeKind; config: Record<string, any>;
}
export interface GraphNode { id: string; type: 'module'; position: { x: number; y: number }; data: BlockData }
export interface GraphEdge { id: string; source: string; target: string; label?: string; data?: { custom?: CustomContent } }
export interface Graph { nodes: GraphNode[]; edges: GraphEdge[] }
export interface Project { id: string; name: string; description: string; revision: number; graph: Graph; sourceRoot: string | null; createdAt: string; updatedAt: string }
export interface Step { nodeId: string; label: string; kind: NodeKind; status: 'running' | 'ok' | 'error'; startedAt: string; durationMs?: number; input: any; output?: any; error?: string; sourceLine?: number }
export interface Run { id: string; projectId: string; revision: number; graph: Graph; input: any; status: 'running' | 'paused' | 'ok' | 'error' | 'cancelled'; startedAt: string; finishedAt?: string; environment: string; steps: Step[]; output?: any; error?: string; debug: boolean; traceId: string }
export const kinds: Record<NodeKind, { label: string; subtitle: string; color: string; group: string }> = {
  form: { label: '表单输入', subtitle: '收集用户填写的数据', color: '#4e88d8', group: '界面与事件' },
  view: { label: '结果展示', subtitle: '把执行结果呈现给用户', color: '#4e88d8', group: '界面与事件' },
  api: { label: 'API 接口', subtitle: '定义请求与响应入口', color: '#8063d4', group: '服务与逻辑' },
  validate: { label: '数据校验', subtitle: '验证字段与业务约束', color: '#d79c32', group: '服务与逻辑' },
  transform: { label: '数据处理', subtitle: '用积木定义计算逻辑', color: '#8063d4', group: '服务与逻辑' },
  database: { label: '数据存储', subtitle: '将结果写入本地数据库', color: '#399880', group: '数据与输出' },
  response: { label: '返回响应', subtitle: '输出结构化处理结果', color: '#399880', group: '数据与输出' },
  source: { label: '源码模块', subtitle: '由源码静态分析得到', color: '#738092', group: '项目结构' },
  custom: { label: '自定义模块', subtitle: '描述需求，AI 生成逻辑', color: '#b466b6', group: '自定义' },
};
export const defaultExpression: Expression = { kind: 'math', op: '*', left: { kind: 'field', name: 'unitPrice' }, right: { kind: 'field', name: 'quantity' } };
export function makeNode(kind: NodeKind, id: string, position = { x: 100, y: 100 }): GraphNode {
  const configs: Record<NodeKind, any> = {
    form: { fields: [{ name: 'sku', label: '商品编号', type: 'text', value: 'SKU-001' }, { name: 'quantity', label: '数量', type: 'number', value: 2 }, { name: 'unitPrice', label: '单价（分）', type: 'number', value: 100 }] },
    api: { method: 'POST', path: '/api/orders' },
    validate: { field: 'quantity', minimum: 1 },
    transform: { outputField: 'total', expression: structuredClone(defaultExpression) },
    database: { collection: 'orders' }, response: { statusCode: 201 }, view: { title: '订单创建成功' }, source: {}, custom: { instructions: '', operations: [] },
  };
  return { id, type: 'module', position, data: { kind, label: kinds[kind].label, description: kinds[kind].subtitle, config: configs[kind] } };
}
export function exampleGraph(): Graph {
  const spec: [NodeKind, string, string, number, number][] = [
    ['form', 'order_form', '订单表单', 60, 80], ['api', 'create_order', '创建订单接口', 370, 80],
    ['validate', 'validate_order', '校验订单', 680, 80], ['transform', 'calculate_total', '计算订单金额', 680, 290],
    ['database', 'save_order', '保存订单', 370, 290], ['response', 'return_order', '返回订单结果', 60, 290],
    ['view', 'show_receipt', '显示订单回执', 60, 500],
  ];
  return {
    nodes: spec.map(([kind, id, label, x, y]) => ({ ...makeNode(kind, id, { x, y }), data: { ...makeNode(kind, id).data, label } })),
    edges: spec.slice(0, -1).map((s, i) => ({ id: `edge-${i}`, source: s[1], target: spec[i + 1][1], label: ['提交数据', '订单参数', '校验通过', '金额结果', '存储结果', '响应数据'][i] })),
  };
}
export function expressionLabel(e: Expression): string {
  if (e.kind === 'field') return e.name;
  if (e.kind === 'number') return String(e.value);
  return `(${expressionLabel(e.left)} ${e.op === '*' ? '×' : e.op === '/' ? '÷' : e.op} ${expressionLabel(e.right)})`;
}
