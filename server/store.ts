import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Graph, Project, Run } from '../shared/model.js';
import { exampleGraph } from '../shared/model.js';
export const dataDir = path.resolve(process.env.MODULAR_DATA_DIR || '.modular');
mkdirSync(dataDir, { recursive: true });
export const db = new DatabaseSync(path.join(dataDir, 'studio.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, started_at TEXT NOT NULL, body TEXT NOT NULL); CREATE INDEX IF NOT EXISTS runs_project ON runs(project_id, started_at); CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, body TEXT NOT NULL);`);
export function allProjects(): Project[] { return db.prepare('SELECT body FROM projects').all().map(r => JSON.parse(r.body as string)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
export function getProject(id: string): Project { const row = db.prepare('SELECT body FROM projects WHERE id = ?').get(id); if (!row) throw Object.assign(new Error('项目不存在'), { statusCode: 404 }); return JSON.parse(row.body as string); }
export function putProject(project: Project) { db.prepare('INSERT OR REPLACE INTO projects VALUES (?, ?)').run(project.id, JSON.stringify(project)); return project; }
export function createProject(name: string, graph: Graph = exampleGraph(), sourceRoot: string | null = null) { return putProject({ id: randomUUID(), name, description: sourceRoot ? '从本地项目分析得到的源码依赖关系' : '从一个清晰的模块，开始构建你的产品。', graph, revision: 1, sourceRoot, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }); }
export function putRun(run: Run) { db.prepare('INSERT OR REPLACE INTO runs VALUES (?, ?, ?, ?)').run(run.id, run.projectId, run.startedAt, JSON.stringify(run)); }
export function getRun(id: string): Run { const row = db.prepare('SELECT body FROM runs WHERE id = ?').get(id); if (!row) throw Object.assign(new Error('执行记录不存在'), { statusCode: 404 }); return JSON.parse(row.body as string); }
export function listRuns(projectId: string): Run[] { return db.prepare('SELECT body FROM runs WHERE project_id = ? ORDER BY started_at DESC LIMIT 60').all(projectId).map(r => JSON.parse(r.body as string)); }
export function readSetting(id: string): any { const row = db.prepare('SELECT body FROM settings WHERE id = ?').get(id); return row ? JSON.parse(row.body as string) : null; }
export function writeSetting(id: string, value: any) { db.prepare('INSERT OR REPLACE INTO settings VALUES (?, ?)').run(id, JSON.stringify(value)); }
if (!allProjects().length) createProject('订单管理应用');
for (const row of db.prepare('SELECT body FROM runs').all()) { const run = JSON.parse(row.body as string) as Run; if (['running', 'paused'].includes(run.status)) { run.status = 'error'; run.error = '本地服务重启，执行会话已中断'; run.finishedAt = new Date().toISOString(); putRun(run); } }
