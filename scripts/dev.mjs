import { spawn } from 'node:child_process';
const children = [
  spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { stdio: 'inherit', windowsHide: true }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], { stdio: 'inherit', windowsHide: true }),
];
let closing = false;
function close(code = 0) { if (closing) return; closing = true; children.forEach(c => c.kill()); setTimeout(() => process.exit(code), 300); }
children.forEach(c => c.on('exit', code => close(code ?? 1)));
process.on('SIGINT', () => close()); process.on('SIGTERM', () => close());
