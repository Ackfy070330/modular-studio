import http from 'node:http';
import { readFileSync } from 'node:fs';
import { runPipeline } from './pipeline.mjs';
const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/') { res.setHeader('content-type', 'text/html; charset=utf-8'); return res.end(readFileSync(new URL('./index.html', import.meta.url))); }
  if(req.method !== 'POST' || req.url !== "/api/orders") {res.writeHead(404); return res.end('Not found');}
  res.setHeader('content-type','application/json; charset=utf-8');
  try { let raw = ''; for await (const chunk of req) {raw += chunk; if(raw.length > 65536) throw new Error('请求过大');}
    const body = JSON.parse(raw); if(!body.input || typeof body.input !== 'object' || Array.isArray(body.input)) throw new Error('input 必须是对象');
    const output = await runPipeline(body.input); res.writeHead(201); res.end(JSON.stringify({output}));
  } catch(e) {res.writeHead(400); res.end(JSON.stringify({message:e.message}));}
});
server.listen(4321,'127.0.0.1',()=>console.log('http://127.0.0.1:4321'));
