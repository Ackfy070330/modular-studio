import { useState } from 'react';
import { X, Repeat2, Sparkles } from 'lucide-react';
import type { Graph, GraphEdge, LoopConfig } from '../shared/model';

export function ConnectionEditor({ edge, graph, readOnly, close, save, customize }: { edge: GraphEdge; graph: Graph; readOnly: boolean; close: () => void; save: (edge: GraphEdge) => void; customize: () => void }) {
  const [label, setLabel] = useState(edge.label || '数据传递');
  const [enabled, setEnabled] = useState(!!edge.data?.loop);
  const [conditional, setConditional] = useState(!!edge.data?.loop?.condition);
  const [limit, setLimit] = useState(edge.data?.loop?.maxIterations || 3);
  const [condition, setCondition] = useState<NonNullable<LoopConfig['condition']>>(edge.data?.loop?.condition || { field: 'total', op: '<', value: 1000 });
  const [error, setError] = useState('');
  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (readOnly) return;
    if (enabled && (!Number.isInteger(limit) || limit < 1 || limit > 100)) { setError('循环次数必须为 1–100 的整数'); return; }
    if (enabled && conditional && (!/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(condition.field) || ['__proto__', 'constructor', 'prototype'].includes(condition.field) || !Number.isFinite(condition.value))) { setError('请填写有效的数字字段与比较值'); return; }
    const data = { ...edge.data }; delete data.loop;
    if (enabled) data.loop = { maxIterations: limit, ...(conditional ? { condition } : {}) };
    save({ ...edge, label, data }); close();
  }
  return <div className="modal-shade"><section className="modal" role="dialog" aria-modal="true" aria-label="连线与循环"><header><div><h2>连线与循环</h2><p>{graph.nodes.find(n => n.id === edge.source)?.data.label} → {graph.nodes.find(n => n.id === edge.target)?.data.label}</p></div><button className="icon-button" aria-label="关闭连线设置" onClick={close}><X size={18}/></button></header><form onSubmit={submit}><div className="modal-body">
    <label className="field">连线名称<input value={label} maxLength={100} required disabled={readOnly} onChange={e => setLabel(e.target.value)}/></label>
    <label className="loop-toggle"><input type="checkbox" checked={enabled} disabled={readOnly} onChange={e => setEnabled(e.target.checked)}/><Repeat2 size={18}/>将这条连线作为循环返回线</label>
    <p className="hint">从处理步骤返回自身或前面的处理步骤，原来的前进连线保留为循环出口。循环控制不需要 API Key。</p>
    {enabled && <div className="loop-config"><label className="field">循环方式<select value={conditional ? 'condition' : 'count'} disabled={readOnly} onChange={e => setConditional(e.target.value === 'condition')}><option value="count">固定轮数</option><option value="condition">条件为真时继续</option></select></label><label className="field">{conditional ? '最多执行轮数' : '总执行轮数（包含第一次）'}<input type="number" min={1} max={100} step={1} value={limit} disabled={readOnly} onChange={e => setLimit(Number(e.target.value))}/></label>{conditional && <div className="condition-fields"><label className="field">数字字段<input value={condition.field} disabled={readOnly} onChange={e => setCondition({ ...condition, field: e.target.value })}/></label><label className="field">比较<select value={condition.op} disabled={readOnly} onChange={e => setCondition({ ...condition, op: e.target.value as typeof condition.op })}>{['<', '<=', '>', '>=', '==', '!='].map(op => <option key={op} value={op}>{op}</option>)}</select></label><label className="field">数值<input type="number" step="any" value={condition.value} disabled={readOnly} onChange={e => setCondition({ ...condition, value: Number(e.target.value) })}/></label></div>}<p className="hint">每轮结束后检查条件。达到上限仍未满足退出条件会报错停止；整次执行最多 2000 步。循环内的存储会重复写入，失败不回滚。</p></div>}
    <button className="button spaced" type="button" onClick={customize}><Sparkles size={14}/>{edge.data?.custom ? '查看 / 编辑字段映射' : '自定义传递内容（需 API Key）'}</button>{error && <p role="alert" className="error-inline">{error}</p>}
    </div><footer><button type="button" className="button" onClick={close}>{readOnly ? '关闭' : '取消'}</button>{!readOnly && <button className="button primary">应用连线设置</button>}</footer></form></section></div>;
}
