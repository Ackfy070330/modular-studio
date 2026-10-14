import type { Graph } from '../shared/model.js';
import { pageSchema } from './page-domain.js';
import { pageCss, pageMarkup, escapeHtml } from '../shared/page-render.js';
const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
export function designedPageHtml(projectId: string, name: string, graph: Graph, standalone: boolean) {
  const page = pageSchema.parse(graph.page);
  const fields = graph.nodes.find(n => ['form','event'].includes(n.data.kind))?.data.config.fields || [];
  const action = standalone ? graph.nodes.find(n => n.data.kind === 'api')!.data.config.path : `/api/projects/${projectId}/execute`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(name)}</title><style>
*{box-sizing:border-box}body{margin:0;background:${page.background};color:#263343;font-family:system-ui,sans-serif}#page{position:relative;width:${page.width}px;height:${page.height}px;margin:0 auto}button:focus-visible,input:focus-visible{outline:3px solid #9584e9;outline-offset:3px}[hidden]{display:none!important}
${pageCss}
#page-status{position:fixed;bottom:12px;left:50%;transform:translateX(-50%);max-width:90%;border-radius:12px;background:#263343;color:white;padding:12px 20px;font-size:13px;z-index:100}
@media(max-width:${page.width - 1}px){#page{width:100%;height:auto;min-height:100vh;display:flex;flex-direction:column;padding:24px;gap:22px}.page-block{position:relative;left:auto!important;top:auto!important;width:100%!important;min-height:48px;flex-shrink:0;order:var(--block-y)}.page-heading{font-size:clamp(26px,7vw,44px)!important;height:auto!important;min-height:80px}.page-section{display:none}.page-text{height:auto!important;min-height:64px}.page-table{min-height:200px}}
</style></head><body><main id="page" aria-label="${escapeHtml(name)}">${pageMarkup(page)}</main><div id="page-status" role="status" aria-live="polite" hidden></div><script>
const design=${scriptJson(page)}, fields=${scriptJson(fields)}, endpoint=${scriptJson(action)};
${String.raw`
const status = document.getElementById('page-status'); let running = false;
const showStatus = text => { status.textContent = text; status.hidden = false; };
const defaults = Object.fromEntries(fields.map(f => [f.name, f.value]));
for (const input of document.querySelectorAll('[data-field]')) if (Object.hasOwn(defaults, input.dataset.field)) input.value = defaults[input.dataset.field];
const printable = value => value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
function renderData(data) {
  for (const block of design.blocks) {
    if (!block.binding || !Object.hasOwn(data, block.binding)) continue;
    const root = document.getElementById('block-' + block.id), slot = root.querySelector('[data-value]'); if (!slot) continue;
    const value = data[block.binding];
    if (block.kind === 'progress') { const amount = typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0,value)) : 0; slot.value=amount; root.querySelector('.progress-label').textContent=amount+'%'; }
    else if (block.kind === 'table') {
      slot.replaceChildren(); if (!Array.isArray(value)) { slot.textContent='绑定字段需要为列表'; continue; }
      if (!value.length) { slot.textContent='暂无数据'; continue; }
      const rows=value.slice(0,100), keys=[...new Set(rows.flatMap(row=>row && typeof row==='object' && !Array.isArray(row) ? Object.keys(row) : ['value']))].slice(0,12);
      const table=document.createElement('table'), head=document.createElement('tr');
      keys.forEach(key=>{ const th=document.createElement('th'); th.textContent=key;head.append(th); }); table.append(head);
      rows.forEach(row=>{ const tr=document.createElement('tr');keys.forEach(key=>{const td=document.createElement('td');td.textContent=printable(row && typeof row==='object' ? row[key] ?? '' : row);tr.append(td);});table.append(tr); }); slot.append(table);
    } else if (block.kind === 'list') {
      slot.replaceChildren(); if(!Array.isArray(value)){slot.textContent='绑定字段需要为列表';continue;} const ul=document.createElement('ul');value.slice(0,100).forEach(item=>{const li=document.createElement('li');li.textContent=printable(item);ul.append(li);});slot.append(ul);if(!value.length)slot.textContent='暂无数据';
    } else slot.textContent=printable(value);
  }
}
for (const block of design.blocks) {
  const root=document.getElementById('block-'+block.id), button=root.querySelector('[data-action]'); if(!button)continue;
  button.addEventListener('click', async()=>{
    if(block.action==='scroll') { const target=document.getElementById('block-'+block.target);if(target){target.hidden=false;target.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});}return; }
    if(block.action==='toggle'){const target=document.getElementById('block-'+block.target);if(target)target.hidden=!target.hidden;return;}
    if(block.action!=='run'||running)return;
    running=true;document.querySelectorAll('[data-action="run"]').forEach(el=>el.disabled=true);showStatus('正在执行…');
    try {
      const input={...defaults,eventId:block.id};for(const el of document.querySelectorAll('[data-field]')){if(el.value!=='' || !Object.hasOwn(input,el.dataset.field))input[el.dataset.field]=el.type==='number'?Number(el.value):el.value;}
      const res=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({input})});const body=await res.json();if(!res.ok)throw new Error(body.message||'执行失败');renderData(body.output);showStatus('执行成功'+(body.runId?' · 可在工作台查看本次运行追踪':''));
    }catch(error){showStatus(error.message||'执行失败');}finally{running=false;document.querySelectorAll('[data-action="run"]').forEach(el=>el.disabled=false);}
  });
}
`}
</script></body></html>`;
}
