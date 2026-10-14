# Windows 桌面版

模序桌面版把工作台、后端服务和 Node.js 一起打包。安装后可以从桌面或开始菜单独立打开，不需要自己启动浏览器、Node.js 或终端。

## 使用

- 支持 Windows 10/11 x64。
- 安装包为 `Modular-Studio-Setup-0.2.0-x64.exe`，安装时可选择目录。
- 从“模序 Modular Studio”快捷方式打开。菜单可按 Alt 显示。
- “导入项目”中可点击“选择文件夹”，无需手动复制目录路径。
- 点击导出应用或导出蓝图，会弹出保存文件窗口。
- API Key 在接入设置填写，只保存在后端进程内存，退出应用后需重新填写。

本版安装包未做商业代码签名。点击右上角“v0.2 · 更新”，检查 GitHub Releases 中的新版本，下载后通过文件大小与 SHA-256 校验，再点击“显示安装包”。先保存项目、退出应用，再手动运行安装包；不会自动执行安装。支持取消、失败重试；下载中关闭更新面板不取消下载，退出应用会取消。

从 0.1 升级需先手动下载 0.2 安装包，因为 0.1 尚无更新入口。升级沿用 `%APPDATA%/Modular Studio/workspace/`，旧项目和历史记录保留。下载缓存与工作空间分别存储，更新操作不会删除工作空间。建议重要项目同时导出蓝图备份。

更新只接受本仓库正式发布、已上传且带 SHA-256 的 Windows x64 安装包，也包括标记为预览版的发布；不接受降级和任意外部地址。未上传完成的版本不会被推荐。

## 本地开发和打包

```powershell
npm ci
npm run desktop
```

首次构建会从 Node.js 官方下载固定版本的 Windows 运行时，并核对官方 SHA-256；文件缓存在 `.cache/`。Electron 的 Windows 运行文件也需从官方发布源下载。构建输出不纳入 Git 仓库。

```powershell
npm run build:desktop
npm run test:desktop
npm run dist:win
```

安装包输出到 `release/`。`release/win-unpacked/Modular Studio.exe` 是可直接运行的未安装目录版，移动时需保留整个目录。使用 `npm run desktop:open` 可快速打开已经构建好的开发桌面版。

## 数据与退出

桌面版数据位于 `%APPDATA%/Modular Studio/workspace/`，日志位于同目录上一级的 `desktop.log`。网页开发版仍使用仓库中的 `.modular/`，两个工作空间独立；迁移蓝图可使用“使用指南 → 导出蓝图/导入蓝图”。

后端绑定随机回环端口，并要求仅由桌面进程注入的会话凭据。窗口退出时会通知后端停止执行进程、关闭数据库；父进程断开时后端也会退出。

渲染窗口使用隔离上下文和沙箱，不启用 Node.js 集成。预加载脚本只开放目录选择功能，主进程核验发送窗口和主框架。实际业务执行使用单独的 Node.js 进程。

## 测试

`npm test` 检查业务运行、调试和自定义功能。`npm run test:desktop` 使用最终打包所用的 Node.js 与后端文件，验证随机端口、会话认证、页面资源、数据库写入、断点调试、源码导入、密钥限制、重启持久化及正常退出。

也可对解包目录验证：

```powershell
node scripts/test-desktop.mjs release/win-unpacked/resources
```

## GitHub 自动构建示例

仓库提供 [Windows CI 配置示例](windows-ci.example.yml)，尚未启用自动构建。当前上传凭据没有 GitHub `workflow` 权限，因此首次发布保留示例文件。将来使用具有相应权限的凭据，将它复制到 `.github/workflows/ci.yml` 并提交，即可在推送时测试并生成 Windows 安装包。
