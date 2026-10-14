import { useRef, useState } from 'react';
import { Plus, MousePointer2, SquareDashed, Copy, Trash2, ArrowUp, ArrowDown, Undo2, Redo2, Workflow, Eye } from 'lucide-react';
import { makePageBlock, pageKinds, projectTypes, type PageBlock, type PageDesign, type PageKind } from '../shared/page';
import { blockContent, pageCss } from '../shared/page-render';
import type { Graph } from '../shared/model';
import './PageDesigner.css';
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
export function PageDesigner({ page, graph, change, undo, redo, canUndo, canRedo, functions, preview }: {
  page: PageDesign; graph: Graph; change: (page: PageDesign) => void; undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean; functions: () => void; preview: () => void;
}) {
  const [selected, select] = useState<string | null>(null), [tool, setTool] = useState<'select' | 'draw'>('select');
  const [zoom, setZoom] = useState(.6), [previewMotion, setPreviewMotion] = useState(false), [search, setSearch] = useState('');
  const [draft, setDraft] = useState<PageDesign | null>(null), [dragging, setDragging] = useState(false);
  const gesture = useRef<{ base: PageDesign; id: string; mode: 'move' | 'resize' | 'draw'; x: number; y: number; originX: number; originY: number } | null>(null);
  const board = useRef<HTMLDivElement>(null);
  const shown = draft || page, block = shown.blocks.find(b => b.id === selected);
  const knownFields = [...new Set(graph.nodes.flatMap(n => ['event','form'].includes(n.data.kind) ? n.data.config.fields.map((f: any) => f.name) : n.data.config.outputField ? [n.data.config.outputField] : n.data.kind === 'custom' ? n.data.config.operations.map((o: any) => o.field) : n.data.kind === 'database' ? ['recordId'] : []))] as string[];
  function commit(next: PageDesign) { setDraft(null); change(next); }
  function patch(values: Partial<PageBlock>) {
    if (!block) return;
    const updated = { ...block, ...values };
    updated.width = clamp(updated.width, 24, page.width); updated.height = clamp(updated.height, 24, page.height);
    updated.x = clamp(updated.x, 0, page.width - updated.width); updated.y = clamp(updated.y, 0, page.height - updated.height);
    commit({ ...page, blocks: page.blocks.map(b => b.id === updated.id ? updated : b) });
  }
  function add(kind: PageKind) {
    if (page.blocks.length >= 100) return;
    const b = makePageBlock(kind, 'page_' + crypto.randomUUID().slice(0, 8), 48 + page.blocks.length % 6 * 16, 100 + page.blocks.length % 6 * 24);
    b.width = Math.min(b.width, page.width - b.x); b.height = Math.min(b.height, page.height - b.y);
    if (kind === 'input') { let field = 'input'; while (page.blocks.some(b => b.kind === 'input' && b.field === field)) field += '_'; b.field = field; }
    commit({ ...page, blocks: [...page.blocks, b] }); select(b.id); setTool('select');
  }
  function start(e: React.PointerEvent<HTMLDivElement>, id: string, mode: 'move' | 'resize' | 'draw', base = page) {
    if (e.button !== 0) return; e.preventDefault(); e.stopPropagation(); select(id); setDragging(true);
    const rect = board.current!.getBoundingClientRect();
    const b = base.blocks.find(b => b.id === id)!;
    gesture.current = { base, id, mode, x: e.clientX, y: e.clientY, originX: (e.clientX - rect.left) / zoom, originY: (e.clientY - rect.top) / zoom };
    if (mode === 'draw') { b.x = clamp(gesture.current.originX, 0, page.width - 24); b.y = clamp(gesture.current.originY, 0, page.height - 24); }
    setDraft(base); board.current!.setPointerCapture(e.pointerId);
  }
  function draw(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    if (tool !== 'draw') { select(null); return; }
    if (page.blocks.length >= 100) return;
    const b = { ...makePageBlock('section', 'page_' + crypto.randomUUID().slice(0, 8)), width: 24, height: 24 };
    start(e, b.id, 'draw', { ...page, blocks: [...page.blocks, b] });
  }
  function move(e: React.PointerEvent<HTMLDivElement>) {
    const g = gesture.current; if (!g) return;
    const b = g.base.blocks.find(b => b.id === g.id)!;
    const dx = Math.round((e.clientX - g.x) / zoom / 4) * 4, dy = Math.round((e.clientY - g.y) / zoom / 4) * 4;
    const updated = g.mode === 'move' ? { ...b, x: clamp(b.x + dx, 0, page.width - b.width), y: clamp(b.y + dy, 0, page.height - b.height) }
      : g.mode === 'resize' ? { ...b, width: clamp(b.width + dx, 24, page.width - b.x), height: clamp(b.height + dy, 24, page.height - b.y) }
      : { ...b, x: clamp(Math.min(g.originX, g.originX + dx), 0, page.width - 24), y: clamp(Math.min(g.originY, g.originY + dy), 0, page.height - 24), width: 24, height: 24 };
    if (g.mode === 'draw') { updated.width = clamp(Math.abs(dx), 24, page.width - updated.x); updated.height = clamp(Math.abs(dy), 24, page.height - updated.y); }
    setDraft({ ...g.base, blocks: g.base.blocks.map(b => b.id === g.id ? updated : b) });
  }
  function end(e: React.PointerEvent<HTMLDivElement>, cancelled = false) {
    if (!gesture.current) return;
    if (!cancelled && draft) change(draft);
    gesture.current = null; setDraft(null); setDragging(false); setTool('select');
    if (board.current?.hasPointerCapture(e.pointerId)) board.current.releasePointerCapture(e.pointerId);
  }
  function layer(direction: number) {
    if (!block) return; const blocks = [...page.blocks], i = blocks.findIndex(b => b.id === block.id), j = clamp(i + direction, 0, blocks.length - 1);
    [blocks[i], blocks[j]] = [blocks[j], blocks[i]]; commit({ ...page, blocks });
  }
  function duplicate() {
    if (!block || page.blocks.length >= 100) return;
    const b = { ...block, id: 'page_' + crypto.randomUUID().slice(0, 8), x: Math.min(page.width - block.width, block.x + 24), y: Math.min(page.height - block.height, block.y + 24) };
    if (b.kind === 'input') { while (page.blocks.some(v => v.kind === 'input' && v.field === b.field)) b.field += '_'; }
    commit({ ...page, blocks: [...page.blocks, b] }); select(b.id);
  }
  function remove() { if (!block) return; commit({ ...page, blocks: page.blocks.filter(b => b.id !== block.id).map(b => b.target === block.id ? { ...b, target: '', action: 'none' } : b) }); select(null); }
  return <div className="page-designer">
    <style>{pageCss}</style>
    <aside className="page-library"><div className="page-panel-title"><strong>页面组件</strong><span>13</span></div><div className="page-search"><input aria-label="搜索页面组件" placeholder="搜索组件…" value={search} onChange={e => setSearch(e.target.value)}/></div>
      <div className="page-component-grid">{(Object.entries(pageKinds) as [PageKind, typeof pageKinds.heading][]).filter(([,v]) => v.label.includes(search)).map(([kind, item]) => <button key={kind} onClick={() => add(kind)} disabled={page.blocks.length >= 100}><span>{item.mark}</span>{item.label}<Plus size={12}/></button>)}</div>
      <div className="page-layer-heading">页面图层 <span>{page.blocks.length}</span></div><div className="page-layers">{[...shown.blocks].reverse().map(b => <button key={b.id} className={selected === b.id ? 'active' : ''} onClick={() => { select(b.id); setTool('select'); }}><span>{pageKinds[b.kind].mark}</span><strong>{b.text.split('\n')[0] || pageKinds[b.kind].label}</strong>{b.hidden && <small>隐藏</small>}</button>)}</div>
      <p className="page-library-tip">先画出结构，再连接功能。<br/>拖动组件摆放，拖右下角缩放。<br/>“拉框”可以直接画出区域。</p>
    </aside>
    <main className="page-studio"><div className="page-toolbar"><div><button className={tool === 'select' ? 'active' : ''} title="选择与拖动" onClick={() => setTool('select')}><MousePointer2 size={16}/></button><button className={tool === 'draw' ? 'active' : ''} onClick={() => setTool('draw')}><SquareDashed size={16}/>拉框</button><span className="page-toolbar-separator"/><button title="撤销页面修改" disabled={!canUndo} onClick={undo}><Undo2 size={16}/></button><button title="重做页面修改" disabled={!canRedo} onClick={redo}><Redo2 size={16}/></button></div><div><select aria-label="页面画布缩放" value={zoom} onChange={e => setZoom(Number(e.target.value))}>{[.35,.5,.6,.75,1].map(z => <option key={z} value={z}>{Math.round(z*100)}%</option>)}</select><button onClick={() => setPreviewMotion(!previewMotion)} className={previewMotion ? 'active' : ''}><Eye size={14}/>动效</button><button className="page-next" onClick={functions}><Workflow size={14}/>定义功能 →</button></div></div>
      <div className="page-canvas-scroll"><div className="page-artboard-label"><span>{projectTypes.find(t => t.id === page.projectType)?.label} / 页面草图</span><span>{page.width} × {page.height}</span></div><div style={{ width: page.width * zoom, height: page.height * zoom, margin: '0 auto 60px', position: 'relative' }}><div ref={board} className={`page-artboard ${tool === 'draw' ? 'drawing' : ''} ${previewMotion ? '' : 'motion-off'} ${dragging ? 'dragging' : ''}`} style={{ width: page.width, height: page.height, background: page.background, transform: `scale(${zoom})`, transformOrigin: 'top left' }} onPointerDown={draw} onPointerMove={move} onPointerUp={e => end(e)} onPointerCancel={e => end(e, true)}>
        {!shown.blocks.length && <div className="page-blank-hint"><SquareDashed size={44}/><h2>把你想象的页面，画在这里。</h2><p>从左侧添加组件，或选“拉框”绘制一个区域。</p><button onPointerDown={e => e.stopPropagation()} onClick={() => add('heading')}>添加第一个标题</button></div>}
        {shown.blocks.map(b => <div key={b.id} tabIndex={0} role="button" aria-label={`页面组件 ${pageKinds[b.kind].label} ${b.text.slice(0,30)}`} className={`designer-block ${selected === b.id ? 'selected' : ''} ${b.hidden ? 'initial-hidden' : ''}`} style={{ left: b.x, top: b.y, width: b.width, height: b.height }} onPointerDown={e => tool === 'draw' ? draw(e) : start(e, b.id, 'move')} onKeyDown={e => { if (e.key === 'Enter') select(b.id); }}>
          <div className={`page-block page-${b.kind} motion-${b.animation}`} style={{ inset: 0, width: '100%', height: '100%', color: b.color, background: b.background, fontSize: b.fontSize, borderRadius: b.radius }} dangerouslySetInnerHTML={{ __html: blockContent(b) }}/>
          {selected === b.id && <><span className="component-caption">{pageKinds[b.kind].label} · {Math.round(b.width)} × {Math.round(b.height)}</span><div role="button" aria-label="缩放选中组件" className="page-resize-handle" onPointerDown={e => start(e, b.id, 'resize')}/></>}
        </div>)}
      </div></div></div><div className="page-bottom"><span>自由布局 · 小屏幕按从上到下的顺序排列</span><button onClick={preview}>预览真实页面 ↗</button></div>
    </main>
    <aside className="page-properties"><div className="page-panel-title"><strong>{block ? pageKinds[block.kind].label : '页面设置'}</strong>{block && <span>{block.id.slice(-8)}</span>}</div>
      {!block ? <div className="page-property-body"><p className="hint">选择组件编辑内容、事件、数据绑定与动效。</p><label className="field compact">背景颜色<input type="color" value={page.background === 'transparent' ? '#ffffff' : page.background} onChange={e => commit({ ...page, background: e.target.value })}/></label><label className="field compact">页面高度<input type="number" min={400} max={4000} value={page.height} onChange={e => { const v = Number(e.target.value); if (v >= Math.max(400,...page.blocks.map(b=>b.y+b.height)) && v <= 4000) commit({...page,height:v}); }}/></label><p className="hint">高度不能小于已有组件的底边。画布为桌面布局；窄屏预览会将内容转为单列。</p><button className="button full" onClick={functions}>继续定义功能与数据流 →</button></div> : <div className="page-property-body">
        <div className="page-object-actions"><button title="复制组件" onClick={duplicate}><Copy size={15}/></button><button title="上移一层" onClick={() => layer(1)}><ArrowUp size={15}/></button><button title="下移一层" onClick={() => layer(-1)}><ArrowDown size={15}/></button><button title="删除组件" onClick={remove}><Trash2 size={15}/></button></div>
        <label className="field compact">内容<textarea rows={3} value={block.text} maxLength={2000} onChange={e => patch({ text: e.target.value })}/></label>
        <div className="page-coordinates">{(['x','y','width','height'] as const).map(key => <label key={key}>{({x:'X',y:'Y',width:'宽度',height:'高度'})[key]}<input type="number" value={Math.round(block[key])} onChange={e => patch({[key]:Number(e.target.value)})}/></label>)}</div>
        <div className="page-color-fields"><label>文字<input type="color" value={block.color === 'transparent' ? '#263343' : block.color} onChange={e => patch({color:e.target.value})}/></label><label>背景<input type="color" value={block.background === 'transparent' ? '#ffffff' : block.background} onChange={e => patch({background:e.target.value})}/></label><button onClick={() => patch({background:'transparent'})}>透明</button></div>
        <div className="page-coordinates"><label>字号<input type="number" min={10} max={96} value={block.fontSize} onChange={e => patch({fontSize:clamp(Number(e.target.value),10,96)})}/></label><label>圆角<input type="number" min={0} max={100} value={block.radius} onChange={e => patch({radius:clamp(Number(e.target.value),0,100)})}/></label></div>
        {block.kind === 'image' && <label className="field compact">图片地址（HTTPS）<input value={block.imageUrl} placeholder="https://…" onChange={e => patch({imageUrl:e.target.value})}/><small>预览与导出时会从该地址加载图片。</small></label>}
        {block.kind === 'input' && <><label className="field compact">输入字段名<input value={block.field} onChange={e => patch({field:e.target.value})}/></label><label className="field compact">输入类型<select value={block.inputType} onChange={e => patch({inputType:e.target.value as 'text'|'number'})}><option value="text">文字</option><option value="number">数字</option></select></label><p className="hint">按钮执行时会将此字段传给流程；默认值可在“页面事件”模块中设置。</p></>}
        {['heading','text','card','stat','table','list','progress'].includes(block.kind) && <><label className="field compact">绑定输出字段<input list="page-output-fields" placeholder="如 message、count、items" value={block.binding} onChange={e => patch({binding:e.target.value})}/><datalist id="page-output-fields">{knownFields.map(f => <option key={f} value={f}/>)}</datalist></label><p className="hint">运行成功后，将字段值显示到这里。表格和列表需要数组；进度条需要 0–100 的数字。</p></>}
        {['button','nav'].includes(block.kind) && <><label className="field compact">点击事件<select value={block.action} onChange={e => patch({action:e.target.value as PageBlock['action']})}><option value="none">无动作</option><option value="run">执行当前功能流程</option><option value="scroll">滚动到组件</option><option value="toggle">切换组件显示 / 隐藏</option></select></label>{['scroll','toggle'].includes(block.action) && <label className="field compact">目标组件<select value={block.target} onChange={e => patch({target:e.target.value})}><option value="">请选择目标</option>{page.blocks.filter(b => b.id !== block.id).map(b => <option key={b.id} value={b.id}>{pageKinds[b.kind].label} · {b.text.slice(0,20)}</option>)}</select></label>}{block.action === 'run' && <p className="hint">所有执行按钮共用当前流程，eventId 字段标识触发按钮；可在运行追踪中查看真实数据。</p>}</>}
        <label className="field compact">动效<select value={block.animation} onChange={e => patch({animation:e.target.value as PageBlock['animation']})}><option value="none">无</option><option value="fade">进入时淡入</option><option value="slide">进入时上滑</option><option value="hover">悬停时浮起</option></select></label><label className="page-checkbox"><input type="checkbox" checked={block.hidden} onChange={e => patch({hidden:e.target.checked})}/>初始隐藏（可用按钮切换）</label>
      </div>}
    </aside>
  </div>;
}
