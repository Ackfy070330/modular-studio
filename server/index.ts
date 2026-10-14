import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import JSZip from 'jszip';
import { z } from 'zod';
import { allProjects, getProject, putProject, createProject, listRuns, getRun, dataDir, db } from './store.js';
import { parseGraph, executionOrder } from './domain.js';
import { compileGraph, standaloneFiles, previewHtml } from './compiler.js';
import { planGraph } from './planner.js';
import { startRun, debugState, controlRun, stopAll } from './runtime.js';
import { analyzeProject, readProjectSource } from './importer.js';
import { agentSettings, saveAgentSettings, proposeChanges, applyProposal, assertCustomChanges, generateCustom } from './agents.js';
import { exampleGraph, loopExampleGraph } from '../shared/model.js';
export const app = Fastify({ logger: false, bodyLimit: 512000 });
const desktopToken = process.env.MODULAR_SESSION_TOKEN;
app.addHook('onRequest', async (request, reply) => {
  const port = (app.server.address() as AddressInfo | null)?.port;
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!hosts.includes(request.headers.host || '')) return reply.code(403).send({ message: '不允许的服务地址' });
  const origin = request.headers.origin;
  const origins = hosts.map(host => `http://${host}`);
  if (!desktopToken) origins.push('http://127.0.0.1:5173', 'http://localhost:5173');
  if (origin && !origins.includes(origin)) return reply.code(403).send({ message: '仅允许本地工作台访问' });
  if (desktopToken) {
    const actual = Buffer.from(String(request.headers['x-modular-desktop'] || ''));
    const expected = Buffer.from(desktopToken);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return reply.code(403).send({ message: '需要桌面会话凭据' });
    const preview = /^\/api\/projects\/[^/]+\/preview(?:\?|$)/.test(request.url);
    reply.header('Content-Security-Policy', `default-src 'self'; script-src 'self'${preview ? " 'unsafe-inline'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'`);
  }
  reply.header('X-Content-Type-Options', 'nosniff');
});
app.setErrorHandler((error: any, _request, reply) => { const status = error.statusCode || 400; reply.code(status).send({ message: error instanceof z.ZodError ? error.issues.map(i => `${i.path.join('.')}：${i.message}`).join('；').slice(0, 800) : error.message || '操作失败' }); });
const idOf = (r: any) => String(r.params.id);
app.get('/api/health', async () => ({ ok: true, version: '0.2.0', storage: 'sqlite', runtime: process.version, mode: 'local' }));
app.get('/api/projects', async () => allProjects());
app.post('/api/projects', async req => { const { name, empty, template } = z.object({ name: z.string().min(1).max(80), empty: z.boolean().optional(), template: z.literal('loop').optional() }).parse(req.body); return createProject(name, empty ? { nodes: [], edges: [] } : template === 'loop' ? loopExampleGraph() : exampleGraph()); });
app.post('/api/projects/import', async req => { const { directory } = z.object({ directory: z.string().min(1).max(1000) }).parse(req.body); const result = await analyzeProject(directory); const project = createProject(result.name, result.graph, result.root); return { project, notes: result.notes, fileCount: result.fileCount }; });
app.get('/api/projects/:id', async req => getProject(idOf(req)));
app.put('/api/projects/:id', async req => {
  const body = z.object({ revision: z.number().int(), name: z.string().min(1).max(80), graph: z.unknown() }).parse(req.body); const project = getProject(idOf(req));
  if (body.revision !== project.revision) throw Object.assign(new Error('项目已更新，请重新加载后再保存'), { statusCode: 409 });
  const graph = parseGraph(body.graph);
  assertCustomChanges(graph, project.graph);
  if (project.sourceRoot && JSON.stringify(graph.nodes.map(n => n.data)) !== JSON.stringify(project.graph.nodes.map(n => n.data))) throw new Error('源码分析节点只读，请修改源文件后重新导入');
  return putProject({ ...project, name: body.name, graph, revision: project.revision + 1, updatedAt: new Date().toISOString() });
});
app.post('/api/projects/:id/validate', async req => { const project = getProject(idOf(req)); const graph = (req.body as any)?.graph ? parseGraph((req.body as any).graph) : project.graph; return { valid: true, order: executionOrder(graph).map(n => n.id) }; });
app.post('/api/projects/:id/plan', async req => { const project = getProject(idOf(req)); if (project.sourceRoot) throw new Error('源码分析项目只读'); return planGraph((req.body as any)?.graph || project.graph); });
app.get('/api/projects/:id/code', async req => { const project = getProject(idOf(req)); return compileGraph(project.graph); });
app.get('/api/projects/:id/source/:nodeId', async (req: any) => { const project = getProject(idOf(req)); const node = project.graph.nodes.find(n => n.id === req.params.nodeId); if (!project.sourceRoot || !node || node.data.kind !== 'source') throw new Error('没有关联的源码'); return { code: await readProjectSource(project.sourceRoot, node.data.config.path), path: node.data.config.path }; });
app.get('/api/projects/:id/export', async (req, reply) => { const project = getProject(idOf(req)); const files = standaloneFiles(project.id, project.name, project.graph); const zip = new JSZip(); for (const [name, content] of Object.entries(files)) zip.file(name, content); reply.header('content-type', 'application/zip').header('content-disposition', 'attachment; filename="modular-app.zip"'); return zip.generateAsync({ type: 'nodebuffer' }); });
app.get('/api/projects/:id/preview', async (req, reply) => { const project = getProject(idOf(req)); executionOrder(project.graph); reply.type('text/html'); return previewHtml(project.id, project.name, project.graph); });
const runSchema = z.object({ input: z.record(z.string(), z.unknown()), debug: z.boolean().optional(), breakpoints: z.array(z.string()).max(100).optional() });
app.post('/api/projects/:id/runs', async req => { const body = runSchema.parse(req.body); return startRun(getProject(idOf(req)), body.input, body); });
app.post('/api/projects/:id/execute', async (req, reply) => {
  const body = runSchema.parse(req.body); const project = getProject(idOf(req)); const run = await startRun(project, body.input);
  const completed = await new Promise<any>((resolve, reject) => { let attempts = 0; const timer = setInterval(() => { const current = getRun(run.id); if (!['running', 'paused'].includes(current.status)) { clearInterval(timer); resolve(current); } else if (++attempts > 350) { clearInterval(timer); reject(new Error('执行超时')); } }, 100); });
  if (completed.status !== 'ok') return reply.code(400).send({ message: completed.error, runId: run.id });
  reply.code(project.graph.nodes.find(n => n.data.kind === 'response')?.data.config.statusCode || 200); return { output: completed.output, runId: run.id, traceId: run.traceId };
});
app.get('/api/projects/:id/runs', async req => listRuns(idOf(req)));
app.get('/api/runs/:id', async req => getRun(idOf(req)));
app.get('/api/runs/:id/debug', async req => debugState(idOf(req)));
app.post('/api/runs/:id/control', async req => { const { command } = z.object({ command: z.enum(['continue', 'next', 'into', 'out', 'stop']) }).parse(req.body); await controlRun(idOf(req), command); return { ok: true }; });
app.get('/api/runs/:id/source', async req => { const run = getRun(idOf(req)); return { code: await readFile(path.join(dataDir, 'runs', run.id, 'pipeline.mjs'), 'utf8'), bindings: compileGraph(run.graph).bindings }; });
app.get('/api/agent/settings', async () => agentSettings());
app.put('/api/agent/settings', async req => saveAgentSettings(req.body));
app.post('/api/custom/generate', async req => generateCustom(req.body));
app.post('/api/projects/:id/agent-tasks', async req => { const body = z.object({ prompt: z.string().min(1).max(4000), selectedNodeId: z.string().optional() }).parse(req.body); return proposeChanges(idOf(req), body.prompt, body.selectedNodeId); });
app.post('/api/agent-tasks/:id/apply', async req => applyProposal(idOf(req)));
app.addHook('onClose', async () => { stopAll(); db.close(); });
let closing = false;
const shutdown = async () => { if (closing) return; closing = true; await app.close(); process.exit(0); };
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
process.on('message', message => { if ((message as any)?.type === 'shutdown') shutdown(); });
if (process.send) process.on('disconnect', shutdown);
async function startServer() {
  const staticRoot = path.resolve(process.env.MODULAR_STATIC_DIR || 'dist');
  if (existsSync(path.join(staticRoot, 'index.html'))) { await app.register(fastifyStatic, { root: staticRoot }); app.setNotFoundHandler((req, reply) => req.url.startsWith('/api/') ? reply.code(404).send({ message: '接口不存在' }) : reply.sendFile('index.html')); }
  const url = await app.listen({ host: '127.0.0.1', port: Number(process.env.PORT || 4310) });
  console.log('Modular Studio API · ' + url);
  process.send?.({ type: 'ready', url });
}
startServer().catch(error => { console.error(error); process.exit(1); });
