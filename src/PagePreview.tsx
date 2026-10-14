import { useEffect, useRef, useState } from 'react';
export function PagePreview({ projectId, width = 1200 }: { projectId: string; width?: number }) {
 const [device,setDevice]=useState<'desktop'|'mobile'>('desktop');const [available,setAvailable]=useState(800);const container=useRef<HTMLDivElement>(null);
 useEffect(()=>{const observer=new ResizeObserver(entries=>setAvailable(entries[0].contentRect.width));if(container.current)observer.observe(container.current);return()=>observer.disconnect();},[]);
 const viewport=device==='mobile'?390:width+20, scale=Math.min(1,Math.max(250,available-32)/viewport);
 return <><div className="preview-device-toolbar"><button className={device==='desktop'?'active':''} onClick={()=>setDevice('desktop')}>桌面布局</button><button className={device==='mobile'?'active':''} onClick={()=>setDevice('mobile')}>手机布局</button><span>真实页面 · 按钮会执行功能流程</span></div><div ref={container} className="preview-device-stage"><div style={{width:viewport*scale,height:530,margin:'0 auto',position:'relative',overflow:'hidden'}}><iframe title="生成应用预览" src={`/api/projects/${projectId}/preview`} style={{width:viewport,height:530/scale,transform:`scale(${scale})`,transformOrigin:'top left',border:0,background:'white'}}/></div></div></>;
}
