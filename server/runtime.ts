import { fork, type ChildProcess } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID, randomBytes } from 'node:crypto';
import path from 'node:path';
import WebSocket from 'ws';
import type { Project, Run } from '../shared/model.js';
import { compileGraph } from './compiler.js';
import { safeSnapshot } from './domain.js';
import { dataDir, putRun, getRun } from './store.js';
type DebugState = { state: string; generation: number; frames: any[]; variables: Record<string, any>; reason?: string };
interface Session { child: ChildProcess; ws?: WebSocket; request: (method: string, params?: any) => Promise<any>; state: DebugState; cleanup?: () => void }
const sessions = new Map<string, Session>();
export async function startRun(project: Project, input: Record<string, any>, options: { debug?: boolean; breakpoints?: string[] } = {}) {
  if ([...sessions.values()].length >= 4) throw new Error('已有 4 个执行会话，请先完成或停止它们');
  const compiled = compileGraph(project.graph);
  const id = randomUUID(); const dir = path.join(dataDir, 'runs', id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'pipeline.mjs'), compiled.code);
  await writeFile(path.join(dir, 'runner.mjs'), `import { runPipeline } from './pipeline.mjs';\nconst send = message => new Promise((resolve, reject) => process.send(message, error => error ? reject(error) : resolve()));\nprocess.once('message', async message => { try { const output = await runPipeline(message.input, { ...message.options, onStep: step => send({type:'step', step}) }); await send({type:'done', output}); } catch(error) { await send({type:'failed', error:error.message}); } finally { if (process.connected) process.disconnect(); } });\n`);
  const run: Run = { id, projectId: project.id, revision: project.revision, graph: structuredClone(project.graph), input: safeSnapshot(input), status: 'running', startedAt: new Date().toISOString(), environment: 'development', steps: [], debug: !!options.debug, traceId: randomBytes(16).toString('hex') };
  putRun(run);
  const child = fork(path.join(dir, 'runner.mjs'), [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], execArgv: options.debug ? ['--inspect=127.0.0.1:0', '--disable-warning=ExperimentalWarning'] : ['--disable-warning=ExperimentalWarning'], windowsHide: true, env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, TEMP: process.env.TEMP } });
  const session: Session = { child, request: async () => { throw new Error('调试器未连接'); }, state: { state: options.debug ? 'connecting' : 'disabled', generation: 0, frames: [], variables: {} } };
  sessions.set(id, session);
  let finished = false; let stderr = '';
  const timeout = setTimeout(() => { if (!finished) finish('error', undefined, options.debug ? '调试会话超过 15 分钟，已结束' : '执行超过 30 秒，已结束'); }, options.debug ? 900000 : 30000);
  function finish(status: Run['status'], output?: any, error?: string) {
    if (finished) return; finished = true; clearTimeout(timeout);
    run.status = status; run.finishedAt = new Date().toISOString();
    if (output !== undefined) run.output = safeSnapshot(output);
    if (error) run.error = error;
    putRun(run); session.state = { state: 'ended', generation: session.state.generation + 1, frames: [], variables: {} };
    session.ws?.close(); child.kill(); sessions.delete(id);
  }
  session.cleanup = () => finish('cancelled', undefined, '用户停止执行');
  child.on('message', (message: any) => {
    if (finished) return;
    if (message.type === 'step') {
      const step = { ...safeSnapshot(message.step), sourceLine: compiled.bindings[message.step.nodeId] };
      const i = run.steps.findIndex(s => s.sequence === step.sequence);
      if (i < 0) run.steps.push(step); else run.steps[i] = step;
      putRun(run);
    } else if (message.type === 'done') finish('ok', message.output);
    else if (message.type === 'failed') finish('error', undefined, String(message.error));
  });
  child.on('error', e => finish('error', undefined, e.message));
  child.on('close', code => { if (!finished) finish('error', undefined, `执行进程退出 (${code})`); });
  const begin = () => { if (!finished && child.connected) child.send({ input, options: { breakpoints: options.debug ? options.breakpoints ?? [] : [], databasePath: path.join(dataDir, 'records.sqlite') } }); };
  if (!options.debug) begin();
  else child.stderr?.on('data', async data => {
    stderr += String(data);
    if (session.ws) return;
    const url = stderr.match(/ws:\/\/127\.0\.0\.1:\d+\/[a-zA-Z0-9-]+/)?.[0];
    if (!url) return;
    try {
      const ws = new WebSocket(url); session.ws = ws;
      let requestId = 0;
      const waiting = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
      session.request = (method, params = {}) => new Promise((resolve, reject) => {
        const reqId = ++requestId;
        const timer = setTimeout(() => { waiting.delete(reqId); reject(new Error('调试器响应超时')); }, 10000);
        waiting.set(reqId, { resolve, reject, timer }); ws.send(JSON.stringify({ id: reqId, method, params }));
      });
      ws.on('message', async raw => {
        const msg = JSON.parse(raw.toString());
        if (msg.id) { const pending = waiting.get(msg.id); if (pending) { clearTimeout(pending.timer); waiting.delete(msg.id); msg.error ? pending.reject(new Error(msg.error.message)) : pending.resolve(msg.result); } return; }
        if (msg.method === 'Debugger.resumed') {
          session.state = { state: 'running', generation: session.state.generation + 1, frames: [], variables: {} }; run.status = 'running'; putRun(run);
        }
        if (msg.method === 'Debugger.paused') {
          const generation = session.state.generation + 1;
          session.state = { state: 'paused', generation, frames: [], variables: {}, reason: msg.params.reason }; run.status = 'paused'; putRun(run);
          try {
            const frames = msg.params.callFrames.slice(0, 12).map((f: any) => ({ name: f.functionName || '(匿名)', line: f.location.lineNumber + 1, file: f.url || 'pipeline.mjs' }));
            const vars: Record<string, any> = {};
            const scopes = msg.params.callFrames[0]?.scopeChain.filter((s: any) => s.type === 'local') ?? [];
            for (const scope of scopes) {
              const result = await session.request('Runtime.getProperties', { objectId: scope.object.objectId, ownProperties: true, generatePreview: false });
              for (const p of result.result.slice(0, 30)) {
                if (!p.value || p.value.type === 'function' || p.name === 'context') continue;
                if (p.value.objectId && p.value.subtype !== 'null') {
                  const properties = await session.request('Runtime.getProperties', { objectId: p.value.objectId, ownProperties: true });
                  vars[p.name] = Object.fromEntries(properties.result.filter((q: any) => q.value && q.value.type !== 'function').slice(0, 30).map((q: any) => [q.name, q.value.value ?? q.value.description ?? '[对象]']));
                } else vars[p.name] = p.value.value ?? p.value.description ?? '[未赋值]';
              }
            }
            if (session.state.generation === generation && session.state.state === 'paused') session.state = { state: 'paused', generation, frames, variables: safeSnapshot(vars), reason: msg.params.reason };
          } catch (e) { if (session.state.generation === generation) session.state.reason = String(e); }
        }
      });
      ws.on('error', e => finish('error', undefined, `调试器连接失败：${e.message}`));
      ws.on('close', () => { for (const p of waiting.values()) { clearTimeout(p.timer); p.reject(new Error('调试器已断开')); } waiting.clear(); if (!finished) finish('error', undefined, '调试连接已断开'); });
      await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
      await session.request('Runtime.enable'); await session.request('Debugger.enable'); session.state.state = 'running'; begin();
    } catch (e) { finish('error', undefined, String(e)); }
  });
  return run;
}
export function debugState(id: string) { getRun(id); return sessions.get(id)?.state ?? { state: 'ended', generation: 0, frames: [], variables: {} }; }
export async function controlRun(id: string, command: string) {
  const session = sessions.get(id); if (!session) throw new Error('执行会话已结束');
  if (command === 'stop') { session.cleanup?.(); return; }
  if (session.state.state !== 'paused') throw new Error('只有暂停的调试会话可以继续或单步');
  const methods: Record<string, string> = { continue: 'Debugger.resume', next: 'Debugger.stepOver', into: 'Debugger.stepInto', out: 'Debugger.stepOut' };
  if (!methods[command]) throw new Error('不支持的调试命令');
  await session.request(methods[command]);
}
export function stopAll() { for (const session of sessions.values()) session.cleanup?.(); }
