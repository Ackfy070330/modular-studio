export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch('/api' + path, { ...init, headers: { 'content-type': 'application/json', ...init.headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || '请求失败');
  return body;
}
export const post = <T = any>(path: string, body: any) => api<T>(path, { method: 'POST', body: JSON.stringify(body) });
export function download(name: string, data: any) {
  const url = URL.createObjectURL(new Blob([typeof data === 'string' ? data : JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}
