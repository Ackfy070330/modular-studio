import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { readSetting, writeSetting, getProject, putProject } from './store.js';
import { parseGraph, safeSnapshot, executionOrder, operationsSchema } from './domain.js';
import type { Graph } from '../shared/model.js';
let apiKey = process.env.MODULAR_AGENT_API_KEY || '';
const settingsSchema = z.object({ baseUrl: z.string().trim().url().max(400), model: z.string().trim().min(1).max(100), apiKey: z.string().trim().max(2000).optional() });
export function agentSettings() { const s = readSetting('agent') || { baseUrl: '', model: '' }; return { ...s, hasKey: !!apiKey, configured: !!(s.baseUrl && s.model), keyStorage: 'process-memory' }; }
export function saveAgentSettings(value: unknown) {
  const s = settingsSchema.parse(value); const url = new URL(s.baseUrl);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('API 地址需要是无凭据和查询参数的 HTTP(S) URL');
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('远程 API 请使用 HTTPS；本机服务可用 HTTP');
  if (s.apiKey !== undefined) apiKey = s.apiKey;
  writeSetting('agent', { baseUrl: s.baseUrl.replace(/\/$/, ''), model: s.model }); return agentSettings();
}
export function requireCustomAccess() {
  const s = agentSettings();
  if (!s.configured || !s.hasKey) throw Object.assign(new Error('自定义功能需要先配置 API 地址、模型和 API Key'), { statusCode: 428 });
  return s;
}
export function assertCustomChanges(next: Graph, previous: Graph) {
  const changedNode = next.nodes.some(n => n.data.kind === 'custom' && JSON.stringify(n.data) !== JSON.stringify(previous.nodes.find(p => p.id === n.id)?.data));
  const changedEdge = next.edges.some(e => e.data?.custom && JSON.stringify(e) !== JSON.stringify(previous.edges.find(p => p.id === e.id)));
  if (changedNode || changedEdge) requireCustomAccess();
}
export async function generateCustom(value: unknown) {
  const s = requireCustomAccess();
  const body = z.object({ target: z.enum(['node', 'edge']), instructions: z.string().trim().min(1).max(4000), graph: z.unknown(), id: z.string().optional() }).parse(value);
  const graph = parseGraph(body.graph);
  const res = await fetch(`${s.baseUrl}/chat/completions`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: s.model, temperature: 0.2, messages: [
      { role: 'system', content: '你是模块化开发助手。将用户的模块或连线需求转换为安全字段赋值。只输出 JSON: {"supported":true,"summary":"中文说明","operations":[{"field":"输出字段名","value":表达式}]}。表达式仅支持 {kind:"field",name:"已有字段"} 复制任意字段、{kind:"number",value:数字}、{kind:"literal",value:字符串或数字或布尔或null}、{kind:"math",op:"+|-|*|/",left:数字表达式,right:数字表达式}。赋值按顺序执行，保留其他字段；连线赋值在目标节点之前执行。纯说明/原样传递可返回空 operations。严禁任意代码。若需求涉及这些操作不能实现的条件、网络、文件等，返回 supported:false,summary 解释限制,operations:[]，不要假装实现。不要声称已测试。' },
      { role: 'user', content: JSON.stringify({ target: body.target, id: body.id, request: body.instructions, context: safeSnapshot({ nodes: graph.nodes.map(n => ({ id: n.id, ...n.data })), edges: graph.edges }) }) },
    ] }), signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) throw new Error(`API 请求失败（HTTP ${res.status}），请检查接入配置`);
  const raw = await res.text(); if (raw.length > 200000) throw new Error('API 响应过大');
  const content = JSON.parse(raw).choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('接口未返回兼容的模型内容');
  const result = z.object({ supported: z.boolean(), summary: z.string().max(4000), operations: operationsSchema }).parse(JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')));
  if (!result.supported) throw new Error(result.summary || '当前执行器不能实现此需求');
  return { ...result, generatedFor: body.instructions };
}
const changeSchema = z.object({ nodeId: z.string(), label: z.string().max(100).optional(), description: z.string().max(500).optional(), config: z.record(z.string(), z.unknown()).optional() });
const proposalSchema = z.object({ summary: z.string().max(8000), changes: z.array(changeSchema).max(30) });
export async function proposeChanges(projectId: string, prompt: string, selectedNodeId?: string) {
  const s = agentSettings(); if (!s.configured) throw new Error('请先在接入设置中配置 API 地址和模型');
  const project = getProject(projectId); if (project.sourceRoot) throw new Error('当前 API 协作仅支持蓝图修改，导入源码的智能体修改尚未实现');
  const context = { project: project.name, revision: project.revision, selectedNodeId, nodes: project.graph.nodes.map(n => ({ id: n.id, ...n.data })) };
  const res = await fetch(`${s.baseUrl}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) }, body: JSON.stringify({ model: s.model, messages: [{ role: 'system', content: '你是软件蓝图开发助手。只输出 JSON，格式 {"summary":"中文说明","changes":[{"nodeId":"已有ID","label":"可选","description":"可选","config":{完整替换配置}}]}。只能修改给出的模块，不执行命令。公式 AST: {kind:"math",op:"+|-|*|/",left:表达式,right:表达式}、{kind:"field",name:"字段"}、{kind:"number",value:数字}。保留不需要修改的配置字段。用户需要解释时 changes 可以为空。不要声称已执行测试。' }, { role: 'user', content: JSON.stringify({ request: prompt, context: safeSnapshot(context) }) }], temperature: 0.2 }), signal: AbortSignal.timeout(90000) });
  if (!res.ok) throw new Error(`API 请求失败（HTTP ${res.status}），请检查地址、模型和凭据`);
  const raw = await res.text(); if (raw.length > 200000) throw new Error('API 响应过大');
  const payload = JSON.parse(raw); const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('接口未返回兼容的 choices[0].message.content');
  const json = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const proposal = proposalSchema.parse(JSON.parse(json));
  const updated = structuredClone(project.graph);
  for (const change of proposal.changes) { const node = updated.nodes.find(n => n.id === change.nodeId); if (!node) throw new Error('建议引用了不存在的模块'); if (change.label) node.data.label = change.label; if (change.description !== undefined) node.data.description = change.description; if (change.config) node.data.config = change.config; }
  parseGraph(updated); assertCustomChanges(updated, project.graph); executionOrder(updated);
  const task = { id: randomUUID(), projectId, baseRevision: project.revision, prompt, ...proposal, graph: updated, createdAt: new Date().toISOString(), status: 'proposed' };
  writeSetting(`task:${task.id}`, task); return task;
}
export function applyProposal(taskId: string) {
  const task = readSetting(`task:${taskId}`); if (!task) throw new Error('建议不存在');
  const project = getProject(task.projectId);
  if (project.revision !== task.baseRevision) throw Object.assign(new Error('蓝图已经变化，请重新生成建议'), { statusCode: 409 });
  if (task.status === 'applied') throw new Error('该建议已应用');
  const next = parseGraph(task.graph); assertCustomChanges(next, project.graph); project.graph = next; project.revision++; project.updatedAt = new Date().toISOString(); putProject(project);
  task.status = 'applied'; writeSetting(`task:${taskId}`, task); return project;
}
