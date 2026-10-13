import { useEffect, useState } from 'react';
import { Check, KeyRound, Loader2, Sparkles, X } from 'lucide-react';
import { api, post } from './api';
import type { Assignment, CustomContent, Graph } from '../shared/model';

export function CustomEditor({ target, id, label: initialLabel, content, graph, context, readOnly = false, refreshToken, close, configure, save }: {
  target: 'node' | 'edge'; id: string; label: string; content?: CustomContent; graph: Graph; context: string;
  readOnly?: boolean; refreshToken: string | null; close: () => void; configure: () => void;
  save: (label: string, content: CustomContent) => Promise<void>;
}) {
  const [label, setLabel] = useState(initialLabel);
  const [instructions, setInstructions] = useState(content?.instructions || '');
  const [result, setResult] = useState<{ operations: Assignment[]; generatedFor?: string; summary?: string } | null>(content?.generatedFor ? content : null);
  const [access, setAccess] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    api('/agent/settings').then(s => { if (active) setAccess(s.configured && s.hasKey ? 'ready' : 'missing'); }).catch(e => { if (active) { setError(e.message); setAccess('missing'); } });
    return () => { active = false; };
  }, [refreshToken]);
  const current = result?.generatedFor === instructions.trim();
  async function generate() {
    setBusy(true); setError('');
    try { setResult(await post('/custom/generate', { target, id, instructions: instructions.trim(), graph })); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function submit() {
    setBusy(true); setError('');
    try {
      await save(label.trim(), { instructions: instructions.trim(), operations: current ? result!.operations : [], ...(current ? { generatedFor: instructions.trim() } : {}) });
      close();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="modal-shade custom-shade"><section className="modal custom-editor" role="dialog" aria-modal="true" aria-label={target === 'node' ? '自定义模块内容' : '自定义连线内容'}>
    <header><div><h2>{target === 'node' ? '自定义模块内容' : '自定义连线内容'}</h2><p>{context}</p></div><button className="icon-button" aria-label="关闭自定义编辑" disabled={busy} onClick={close}><X size={18}/></button></header>
    <div className="modal-body">
      {!readOnly && access === 'loading' ? <p className="hint"><Loader2 className="spin" size={16}/>检查 API 配置…</p> : !readOnly && access === 'missing' ? <div className="custom-gate"><KeyRound size={32}/><h3>配置 API Key，启用自定义</h3><p>自定义模块和连线使用你的模型接口生成逻辑。请先填写 API 地址、模型名称和 API Key。</p><button className="button primary" onClick={configure}>去配置 API Key</button><small>内置模块和普通连线仍可直接使用。</small></div> : <>
        <label className="field">{target === 'node' ? '模块名称' : '连线名称'}<input maxLength={100} value={label} disabled={busy} readOnly={readOnly} onChange={e => setLabel(e.target.value)}/></label>
        <label className="field">自定义内容<textarea rows={5} maxLength={4000} value={instructions} disabled={busy} readOnly={readOnly} placeholder={target === 'node' ? '例如：计算折后金额 discountedTotal = total × 0.9，再添加 status 字段为“已计算”。' : '例如：把 total 复制为 orderAmount，保留其他字段。'} onChange={e => setInstructions(e.target.value)}/></label>
        <p className="hint">支持字段复制、固定值与四则运算。{target === 'edge' ? '映射在下游模块执行前生效。' : '模块按顺序处理数据并传给下一步。'}复杂条件、网络调用等需求暂不支持。</p>
        {!readOnly && <button className="button full" disabled={busy || !instructions.trim()} onClick={generate}>{busy ? <Loader2 className="spin" size={15}/> : <Sparkles size={15}/>}使用 API 生成逻辑</button>}
        {result && <div className={`custom-result ${current ? '' : 'stale'}`}><strong>{current ? '逻辑预览 · 保存后生效' : '内容已修改，请重新生成'}</strong>{result.summary && <p>{result.summary}</p>}<pre>{JSON.stringify(result.operations, null, 2)}</pre>{current && !result.operations.length && <small>原样传递数据，不修改字段。</small>}</div>}
        {!result && <p className="hint">可以先保存为草稿。运行前需要生成逻辑；仅填写文字不会被当作可执行功能。</p>}
        {!readOnly && <small className="custom-disclosure">生成时会将自定义内容和当前蓝图发送到已配置的 API；密钥不会写入蓝图。</small>}
      </>}
      {error && <p className="error-inline" role="alert">{error}</p>}
    </div>
    <footer><button className="button" disabled={busy} onClick={close}>{readOnly ? '关闭' : '取消'}</button>{!readOnly && access === 'ready' && <button className="button primary" disabled={busy || !label.trim() || !instructions.trim()} onClick={submit}><Check size={14}/>{current ? '保存到蓝图' : '保存草稿'}</button>}</footer>
  </section></div>;
}
