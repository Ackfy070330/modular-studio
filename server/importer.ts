import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import type { Graph, GraphNode } from '../shared/model.js';
const ignored = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.modular', 'vendor']);
const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
export async function analyzeProject(directory: string) {
  const root = await realpath(path.resolve(directory));
  if (!(await stat(root)).isDirectory()) throw new Error('请选择项目文件夹');
  const files: string[] = []; const notes: string[] = [];
  async function scan(folder: string, depth = 0) {
    if (depth > 8 || files.length >= 150) return;
    for (const item of await readdir(folder, { withFileTypes: true })) {
      if (item.isSymbolicLink() || item.name.startsWith('.') || ignored.has(item.name)) continue;
      const full = path.join(folder, item.name);
      if (item.isDirectory()) await scan(full, depth + 1);
      else if (extensions.includes(path.extname(item.name)) && files.length < 150) {
        if ((await stat(full)).size < 512000) files.push(full); else notes.push(`跳过较大文件：${path.relative(root, full)}`);
      }
    }
  }
  await scan(root);
  if (!files.length) throw new Error('该目录没有可分析的 JavaScript / TypeScript 源文件');
  if (files.length >= 150) notes.push('达到 150 个源文件上限，本次展示部分结构');
  const nodes: GraphNode[] = []; const edges: Graph['edges'] = [];
  const byPath = new Map(files.map((f, i) => [f.toLowerCase(), `file_${i}`]));
  for (const [index, filename] of files.entries()) {
    const text = await readFile(filename, 'utf8');
    const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, filename.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const imports: string[] = []; const symbols: { name: string; line: number }[] = []; const routes: string[] = [];
    function visit(node: ts.Node) {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
      if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) symbols.push({ name: node.name.getText(source), line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
      if (ts.isVariableDeclaration(node) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) symbols.push({ name: node.name.getText(source), line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ['get', 'post', 'put', 'delete', 'patch'].includes(node.expression.name.text) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) routes.push(`${node.expression.name.text.toUpperCase()} ${node.arguments[0].text}`);
      ts.forEachChild(node, visit);
    }
    visit(source);
    nodes.push({ id: `file_${index}`, type: 'module', position: { x: (index % 4) * 300, y: Math.floor(index / 4) * 180 }, data: { kind: 'source', label: path.basename(filename), description: path.relative(root, filename).replaceAll('\\', '/'), config: { path: path.relative(root, filename), symbols: symbols.slice(0, 50), routes: routes.slice(0, 30), imports, lines: text.split('\n').length, evidence: '静态语法分析；路由为候选模式，需确认' } } });
    for (const imp of imports.filter(v => v.startsWith('.'))) {
      const base = path.resolve(path.dirname(filename), imp);
      const noExtension = base.replace(/\.(m?js|cjs)$/, '');
      const candidates = [base, ...extensions.map(ext => noExtension + ext), ...extensions.map(ext => path.join(base, `index${ext}`))];
      const target = candidates.map(v => byPath.get(v.toLowerCase())).find(Boolean);
      if (target) edges.push({ id: `dependency_${edges.length}`, source: `file_${index}`, target, label: 'import 依赖' });
      else notes.push(`未解析：${path.relative(root, filename)} → ${imp}`);
    }
  }
  return { root, name: path.basename(root), graph: { nodes, edges }, notes: [...new Set(notes)].slice(0, 80), fileCount: files.length };
}
export async function readProjectSource(root: string, relative: string) {
  const resolved = await realpath(path.resolve(root, relative));
  const resolvedRoot = await realpath(root);
  const rel = path.relative(resolvedRoot, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel) || !extensions.includes(path.extname(resolved)) || (await stat(resolved)).size > 512000) throw new Error('文件不在允许的项目范围内');
  return readFile(resolved, 'utf8');
}
