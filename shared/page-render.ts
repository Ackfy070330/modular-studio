import type { PageBlock, PageDesign } from './page';
export const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function blockContent(block: PageBlock) {
  const text = escapeHtml(block.text), binding = escapeHtml(block.binding);
  switch (block.kind) {
    case 'heading': return `<h1 data-value>${text}</h1>`;
    case 'text': return `<p data-value>${text}</p>`;
    case 'button': case 'nav': return `<button type="button" data-action="${block.action}">${text}</button>`;
    case 'input': return `<label>${text}<input aria-label="${text}" data-field="${escapeHtml(block.field)}" type="${block.inputType}" ${block.inputType === 'number' ? 'step="any"' : ''} placeholder="${text}"></label>`;
    case 'image': return block.imageUrl ? `<img src="${escapeHtml(block.imageUrl)}" alt="${text}" loading="lazy" referrerpolicy="no-referrer">` : `<div class="image-placeholder"><span>◇</span><small>${text}</small></div>`;
    case 'stat': return `<small>${text}</small><strong data-value aria-label="${binding}">—</strong>`;
    case 'table': case 'list': return `<h3>${text}</h3><div data-value><small class="binding-placeholder">${binding ? `等待输出字段 ${binding}` : '选择输出字段后，运行时显示数据'}</small></div>`;
    case 'progress': return `<small>${text}</small><progress data-value max="100" value="0" aria-label="${text}"></progress><span class="progress-label">0%</span>`;
    case 'divider': return '<hr>';
    default: return `<div data-value>${text}</div>`;
  }
}
export function blockStyle(block: PageBlock) {
  return `left:${block.x}px;top:${block.y}px;width:${block.width}px;height:${block.height}px;color:${block.color};background:${block.background};font-size:${block.fontSize}px;border-radius:${block.radius}px;--block-x:${block.x};--block-y:${block.y}`;
}
export const pageCss = `
.page-block{position:absolute;box-sizing:border-box;padding:18px;overflow:auto;white-space:pre-line;line-height:1.55;font-family:inherit}
.page-block h1,.page-block p,.page-block h3{margin:0;font-size:inherit;line-height:1.25;font-weight:inherit}.page-block h1{font-weight:750;letter-spacing:-.035em}.page-block h3{font-size:16px;font-weight:650;margin-bottom:18px}
.page-input{overflow:visible}
.page-heading,.page-text,.page-input,.page-image,.page-button,.page-nav{padding:0}.page-section{border:1px solid #8291a215}.page-section>div{font-size:12px;opacity:.5}
.page-card,.page-stat,.page-table,.page-list,.page-progress{box-shadow:0 4px 25px #26334306;border:1px solid #8291a215}
.page-card{padding:26px}.page-stat small,.page-progress small{display:block;color:inherit;opacity:.65;font-size:14px}.page-stat strong{font-size:42px;font-weight:650;display:block;margin-top:10px;white-space:normal}
.page-block button{font:inherit;color:inherit;background:transparent;border:0;width:100%;height:100%;text-align:center;cursor:pointer;border-radius:inherit}.page-nav button{text-align:left}.page-block button:disabled{opacity:.5;cursor:wait}
.page-block label{display:block;font-size:13px}.page-block input{display:block;box-sizing:border-box;width:100%;font:inherit;font-size:16px;padding:10px 13px;margin-top:7px;border:1px solid #dce0ea;border-radius:9px;background:#ffffff;color:#263343}
.page-block img{width:100%;height:100%;object-fit:cover;border-radius:inherit}.image-placeholder{height:100%;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:18px;color:inherit;background:linear-gradient(140deg,#ffffff40,#7460d515);border:1px dashed #7460d540;border-radius:inherit}.image-placeholder span{font-size:110px;line-height:1}.image-placeholder small{font-size:14px}
.page-block table{width:100%;border-collapse:collapse;white-space:normal;font-size:14px}.page-block td,.page-block th{padding:12px 8px;border-bottom:1px solid #8790a522;text-align:left}.page-block th{font-size:12px;opacity:.65}.page-block ul{padding-left:20px;margin:0;white-space:normal}.page-block li{margin:10px 0}.binding-placeholder{color:#8b94a5;font-size:13px}
.page-block progress{width:100%;height:10px;accent-color:#7460d5;margin-top:18px}.progress-label{display:block;font-size:12px;margin-top:4px}.page-block hr{border:0;border-top:1px solid currentColor;opacity:.2}
@keyframes page-fade{from{opacity:0}to{opacity:1}}@keyframes page-slide{from{opacity:0;translate:0 16px}to{opacity:1;translate:0 0}}.motion-fade{animation:page-fade .65s both}.motion-slide{animation:page-slide .65s both}.motion-hover{transition:transform .2s,box-shadow .2s}.motion-hover:hover{transform:translateY(-3px);box-shadow:0 12px 28px #7460d525}
@media(prefers-reduced-motion:reduce){.page-block{animation:none!important;transition:none!important}}
`;
export function pageMarkup(page: PageDesign) {
  return page.blocks.map(b => `<section id="block-${b.id}" data-block="${b.id}" class="page-block page-${b.kind} motion-${b.animation}" style="${blockStyle(b)}" ${b.hidden ? 'hidden' : ''}>${blockContent(b)}</section>`).join('');
}
