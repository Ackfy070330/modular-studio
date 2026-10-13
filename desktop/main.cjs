const { app, BrowserWindow, Menu, ipcMain, dialog, session } = require('electron');
const { fork } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { existsSync, mkdirSync, appendFileSync } = require('node:fs');
const path = require('node:path');

app.setName('Modular Studio');
if (process.env.MODULAR_DESKTOP_TEST_DATA) app.setPath('userData', process.env.MODULAR_DESKTOP_TEST_DATA);
let window, backend, origin, quitting = false;
const sessionToken = randomBytes(32).toString('hex');
const resources = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', 'desktop-runtime');
const dataDirectory = path.join(app.getPath('userData'), 'workspace');
mkdirSync(dataDirectory, { recursive: true });
const logFile = path.join(app.getPath('userData'), 'desktop.log');
function log(message) { appendFileSync(logFile, `[${new Date().toISOString()}] ${message}\n`); }
function trustedSender(event) { return window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && new URL(event.senderFrame.url).origin === origin; }

async function startBackend() {
  const executable = path.join(resources, 'node', 'node.exe');
  const entry = path.join(resources, 'backend', 'server.cjs');
  if (!existsSync(executable) || !existsSync(entry)) throw new Error('缺少桌面运行文件，请先执行 npm run build:desktop 或重新安装。');
  backend = fork(entry, [], {
    execPath: executable, execArgv: ['--disable-warning=ExperimentalWarning'], windowsHide: true,
    cwd: app.getPath('userData'), stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, TEMP: process.env.TEMP, USERPROFILE: process.env.USERPROFILE,
      PORT: '0', MODULAR_DATA_DIR: dataDirectory, MODULAR_STATIC_DIR: path.join(resources, 'ui'), MODULAR_SESSION_TOKEN: sessionToken },
  });
  backend.stdout.on('data', b => log(String(b).trim()));
  backend.stderr.on('data', b => log(String(b).trim()));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('本地服务启动超时。详细信息见 ' + logFile)), 30000);
    backend.once('error', error => { clearTimeout(timeout); reject(error); });
    backend.on('message', message => {
      if (message?.type === 'ready') { clearTimeout(timeout); origin = message.url; resolve(origin); }
    });
    backend.once('exit', code => {
      clearTimeout(timeout);
      if (!origin) reject(new Error('本地服务启动失败 (' + code + ')。详细信息见 ' + logFile));
      else if (!quitting) { dialog.showErrorBox('本地服务已停止', '请重新打开模序。已保存的项目不受影响。'); app.quit(); }
    });
  });
}

async function createWindow() {
  await startBackend();
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: [origin + '/*'] }, (details, callback) => {
    callback({ requestHeaders: { ...details.requestHeaders, 'X-Modular-Desktop': sessionToken } });
  });
  window = new BrowserWindow({
    width: 1440, height: 940, minWidth: 840, minHeight: 680, title: '模序 · Modular Studio',
    backgroundColor: '#f8f9fc', show: false, autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== origin) event.preventDefault(); });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('render-process-gone', (_event, details) => log('Renderer stopped: ' + details.reason));
  window.webContents.on('console-message', (_event, details) => { if (details.level === 'error') log('Renderer error: ' + details.message); });
  window.webContents.session.on('will-download', (_event, item) => {
    item.setSaveDialogOptions({ title: '保存导出文件', defaultPath: path.join(app.getPath('downloads'), path.basename(item.getFilename())) });
  });
  window.once('ready-to-show', () => { window.show(); log('Desktop window ready'); });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '应用', submenu: [{ label: '关于模序', click: () => dialog.showMessageBox(window, { title: '模序', message: 'Modular Studio ' + app.getVersion(), detail: '模块化软件开发与数据流调试工作台\n本地数据目录：' + dataDirectory }) }, { type: 'separator' }, { label: '退出', role: 'quit' }] },
    { label: '编辑', submenu: [{ role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' }, { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' }] },
    { label: '视图', submenu: [{ role: 'reload', label: '重新加载' }, { role: 'resetZoom', label: '实际大小' }, { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' }, { role: 'togglefullscreen', label: '全屏' }] },
  ]));
  ipcMain.handle('desktop:select-directory', async event => {
    if (!trustedSender(event)) throw new Error('不允许的窗口请求');
    const result = await dialog.showOpenDialog(window, { title: '选择要导入的项目', properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  await window.loadURL(origin);
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.whenReady().then(createWindow).catch(error => { log(error.stack || String(error)); dialog.showErrorBox('模序启动失败', error.message); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (quitting || !backend || backend.exitCode !== null) return;
    event.preventDefault(); quitting = true;
    const timeout = setTimeout(() => { backend.kill(); app.exit(); }, 5000);
    backend.once('exit', () => { clearTimeout(timeout); app.quit(); });
    if (backend.connected) backend.send({ type: 'shutdown' }); else backend.kill();
  });
}
