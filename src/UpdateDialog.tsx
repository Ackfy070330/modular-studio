import { useEffect, useState } from 'react';
import { Download, RefreshCw, X, FolderOpen } from 'lucide-react';
import type { UpdateState } from './desktop';
export function UpdateDialog({ close }: { close: () => void }) {
  const [state, setState] = useState<UpdateState>({ status: 'idle', currentVersion: '0.3.0' });
  const [error, setError] = useState('');
  useEffect(() => {
    if (!window.desktop) return;
    window.desktop.updateState().then(setState).catch(e => setError(e.message));
    return window.desktop.onUpdate(setState);
  }, []);
  async function act(action: () => Promise<unknown>) { setError(''); try { await action(); } catch (e) { setError((e as Error).message); } }
  const busy = state.status === 'checking' || state.status === 'downloading';
  const messages = { idle: '手动检查新版本', checking: '正在检查 GitHub 版本…', current: '没有可用的更新安装包', available: '发现新版本', downloading: '正在下载安装包', downloaded: '下载完成，SHA-256 校验通过', error: state.release ? '下载未完成，可以重试' : '暂时无法检查更新' };
  return <div className="modal-shade"><section className="modal" role="dialog" aria-modal="true" aria-label="应用更新"><header><div><h2>应用更新</h2><p>当前版本 {state.currentVersion} · Windows x64</p></div><button className="icon-button" aria-label="关闭更新窗口" onClick={close}><X size={18}/></button></header><div className="modal-body">
    <h3 aria-live="polite">{window.desktop ? messages[state.status] : '请在桌面应用中检查更新'}</h3>
    {state.release && <><p>模序 {state.release.version}{state.release.preview ? ' · 预览版' : ''} · {(state.release.size / 1048576).toFixed(1)} MB</p>{state.status === 'downloading' && <div className="update-progress"><progress max={state.release.size} value={state.received || 0}/><span>{Math.floor((state.received || 0) / state.release.size * 100)}%</span></div>}<pre className="update-notes">{state.release.notes}</pre></>}
    {(error || state.error) && <p role="alert" className="error-inline">{error || state.error}</p>}
    {state.notice && <p className="hint" role="status">{state.notice}</p>}
    <p className="hint">只从本项目的 GitHub Releases 获取安装包。下载后请保存项目、退出应用，再运行安装包。更新不会自动执行安装，也不会删除工作空间。当前预览版尚未签名。</p>
    </div><footer><button className="button" disabled={!window.desktop} onClick={() => act(() => window.desktop!.openReleasePage())}>打开发布页</button><button className="button" disabled={!window.desktop || busy} onClick={() => act(() => window.desktop!.checkUpdate())}><RefreshCw size={14}/>检查更新</button>{state.status === 'downloading' ? <button className="button" onClick={() => act(() => window.desktop!.cancelUpdate())}>取消下载</button> : state.status === 'downloaded' ? <button className="button primary" onClick={() => act(() => window.desktop!.revealUpdate())}><FolderOpen size={14}/>显示安装包</button> : state.release && <button className="button primary" disabled={busy} onClick={() => act(() => window.desktop!.downloadUpdate())}><Download size={14}/>下载安装包</button>}</footer></section></div>;
}
