import { makeNode, type Graph } from './model';
export type WebProjectType = 'landing' | 'dashboard' | 'website';
export type PageKind = 'section' | 'heading' | 'text' | 'button' | 'input' | 'image' | 'card' | 'stat' | 'table' | 'list' | 'nav' | 'divider' | 'progress';
export interface PageBlock {
  id: string; kind: PageKind; x: number; y: number; width: number; height: number;
  text: string; color: string; background: string; fontSize: number; radius: number;
  field: string; inputType: 'text' | 'number'; binding: string; imageUrl: string;
  action: 'none' | 'run' | 'scroll' | 'toggle'; target: string;
  animation: 'none' | 'fade' | 'slide' | 'hover'; hidden: boolean;
}
export interface PageDesign { projectType: WebProjectType; width: number; height: number; background: string; blocks: PageBlock[] }
export const projectTypes = [
  { id: 'landing', label: '前端展示页', description: '介绍产品、个人作品或活动，先把页面画出来。', mark: '01', available: true },
  { id: 'dashboard', label: '数据控制台', description: '数据卡片、列表与操作按钮，连接真实处理流程。', mark: '02', available: true },
  { id: 'website', label: '网站', description: '本版支持单页网站，导航、内容区和交互一同设计。', mark: '03', available: true },
  { id: 'app', label: '桌面 / 移动应用', description: '原生界面与设备能力将在后续版本开放。', mark: '04', available: false },
  { id: 'game', label: '游戏', description: '场景、角色与游戏运行时将在后续版本开放。', mark: '05', available: false },
] as const;
export const pageKinds: Record<PageKind, { label: string; mark: string; width: number; height: number }> = {
  section: { label: '区域', mark: '▧', width: 520, height: 220 }, heading: { label: '标题', mark: 'H', width: 520, height: 90 },
  text: { label: '段落', mark: 'T', width: 440, height: 100 }, button: { label: '按钮', mark: '↗', width: 180, height: 52 },
  input: { label: '输入框', mark: '⌨', width: 280, height: 72 }, image: { label: '图片', mark: '▧', width: 400, height: 260 },
  card: { label: '内容卡片', mark: '▣', width: 300, height: 170 }, stat: { label: '指标卡', mark: '#', width: 240, height: 140 },
  table: { label: '数据表格', mark: '▤', width: 620, height: 230 }, list: { label: '列表', mark: '≡', width: 320, height: 220 },
  nav: { label: '导航 / 链接', mark: '→', width: 220, height: 48 }, divider: { label: '分割线', mark: '—', width: 600, height: 24 },
  progress: { label: '进度条', mark: '%', width: 320, height: 100 },
};
export function makePageBlock(kind: PageKind, id: string, x = 48, y = 48): PageBlock {
  const meta = pageKinds[kind];
  return { id, kind, x, y, width: meta.width, height: meta.height, text: kind === 'heading' ? '你的下一个想法，从这里开始' : kind === 'button' ? '运行功能' : meta.label, color: kind === 'button' ? '#ffffff' : '#263343', background: kind === 'button' ? '#7460d5' : ['section', 'card', 'stat', 'table', 'list', 'progress'].includes(kind) ? '#ffffff' : 'transparent', fontSize: kind === 'heading' ? 40 : 16, radius: 16, field: 'name', inputType: 'text', binding: '', imageUrl: '', action: kind === 'button' ? 'run' : 'none', target: '', animation: 'none', hidden: false };
}
export function makePage(type: WebProjectType, empty = false): PageDesign {
  const page: PageDesign = { projectType: type, width: 1200, height: type === 'dashboard' ? 940 : 1060, background: '#f5f6fb', blocks: [] };
  if (empty) return page;
  const add = (kind: PageKind, id: string, x: number, y: number, patch: Partial<PageBlock>) => page.blocks.push({ ...makePageBlock(kind, id, x, y), ...patch });
  add('nav', 'brand', 56, 30, { text: type === 'dashboard' ? 'STUDIO / 工作空间' : 'STUDIO / 新的可能', width: 400, fontSize: 17 });
  add('nav', 'nav_content', 940, 30, { text: '探索内容 ↓', action: 'scroll', target: 'content' });
  if (type === 'dashboard') {
    add('heading', 'hero', 56, 118, { text: '让数据，成为行动。', width: 1040, height: 70, fontSize: 42, animation: 'fade' });
    add('text', 'intro', 56, 194, { text: '这是你的控制台。调整卡片位置，绑定输出字段，再用按钮触发流程。', width: 960, height: 60 });
    add('stat', 'metric', 56, 284, { text: '项目数量', binding: 'count', width: 332, height: 152, animation: 'slide' });
    add('card', 'card_info', 414, 284, { text: '本地运行\n每一次操作都可以在运行追踪中查看。', width: 350, height: 152 });
    add('card', 'card_next', 790, 284, { text: '从布局到功能\n选中组件，在右侧设置内容、事件与数据。', width: 354, height: 152 });
    add('table', 'content', 56, 466, { text: '项目概览', binding: 'items', width: 708, height: 310 });
    add('input', 'name_input', 800, 482, { text: '你的称呼', width: 320 });
    add('button', 'run_button', 800, 582, { text: '刷新工作空间', width: 320 });
    add('text', 'message', 800, 660, { text: '运行后显示欢迎信息', binding: 'message', width: 320, height: 120 });
  } else {
    add('heading', 'hero', 56, 158, { text: type === 'website' ? '一个网站，\n连接你的每个想法。' : '让好想法，\n拥有自己的舞台。', width: 640, height: 180, fontSize: 54, animation: 'slide' });
    add('text', 'intro', 56, 350, { text: '先勾勒页面，再赋予它功能。你画出的布局，会成为可以预览和导出的真实网页。', width: 570, height: 100, color: '#768196', fontSize: 19 });
    add('input', 'name_input', 56, 472, { text: '怎么称呼你？', width: 310 });
    add('button', 'run_button', 392, 490, { text: '开始体验 ↗', width: 220, animation: 'hover' });
    add('image', 'visual', 738, 164, { text: '在这里放入你的视觉', width: 406, height: 396, background: '#e7e2fc', radius: 32 });
    add('text', 'message', 56, 570, { text: '点击按钮，感受页面与功能的连接。', binding: 'message', width: 620, height: 64 });
    add('heading', 'content', 56, 700, { text: '从一张草图，到可以使用。', fontSize: 30, width: 1000, height: 64 });
    add('card', 'card_one', 56, 800, { text: '01 / 画页面\n自由拖动与缩放组件，调整内容和颜色。', width: 344, height: 170 });
    add('card', 'card_two', 428, 800, { text: '02 / 定义功能\n用事件、文本、列表和计算模块组织逻辑。', width: 344, height: 170 });
    add('card', 'card_three', 800, 800, { text: '03 / 连接数据\n把输出字段绑定到指标、表格与文本。', width: 344, height: 170 });
  }
  return page;
}
export function webGraph(type: WebProjectType, empty = false): Graph {
  const specs = ['event', 'api', 'value', 'text', 'list', 'response', 'view'] as const;
  const nodes = specs.map((kind, i) => makeNode(kind, `web_${kind}`, { x: 60 + (i % 3) * 310, y: 80 + Math.floor(i / 3) * 210 }));
  nodes[1].data.config.path = '/api/action'; nodes[5].data.config.statusCode = 200;
  return { nodes, edges: nodes.slice(1).map((n, i) => ({ id: `web_edge_${i}`, source: nodes[i].id, target: n.id, label: '数据传递' })), page: makePage(type, empty) };
}
