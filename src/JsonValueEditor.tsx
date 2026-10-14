import { useEffect, useState } from 'react';
export function JsonValueEditor({ value, disabled, change }: { value: unknown; disabled: boolean; change: (value: unknown) => void }) {
 const [text,setText]=useState(JSON.stringify(value,null,2)),[error,setError]=useState('');
 useEffect(()=>{setText(JSON.stringify(value,null,2));setError('');},[value]);
 return <label className="field compact">数据值（JSON）<textarea rows={8} className="code-editor" readOnly={disabled} value={text} onChange={e=>{setText(e.target.value);setError('点击应用数据后保存到模块。');}}/><small>{error}</small><button className="button" disabled={disabled} onClick={()=>{try{const next=JSON.parse(text);if(text.length>12000)throw new Error('数据最多 12000 个字符');change(next);setError('数据已应用');}catch(e){setError((e as Error).message);}}}>应用数据</button></label>;
}
