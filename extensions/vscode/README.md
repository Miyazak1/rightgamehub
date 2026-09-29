# GameHub for VS Code / Cursor

这是 GameHub 共享客户端的编辑器宿主。VS Code 与 Cursor 使用同一份 VSIX；运行时会根据 `vscode.env.appName` 显示真实宿主，并跟随编辑器主题。

## 安装

正式发布前可在仓库根目录运行 `npm run pack:vscode`，然后在 VS Code、Cursor 或兼容编辑器的扩展面板菜单中选择 **Install from VSIX...**，安装 `artifacts/gamehub-agent-0.3.0.vsix`。也可以使用宿主 CLI：

```bash
code --install-extension gamehub-agent-0.3.0.vsix
cursor --install-extension gamehub-agent-0.3.0.vsix
```

重载编辑器后，点击 Activity Bar 的 GameHub 图标。扩展默认连接 `https://mooyu.fun`；私有部署可在编辑器设置中调整 `gamehub.apiUrl` 和 `gamehub.browserUrl`。

## 当前能力

- 共享大厅、猜百科、账号、创作中心与管理界面；
- VS Code/Cursor 主题色和高对比度跟随；
- access/refresh token 通过 SecretStorage 保存；
- Web 作品在隔离运行页游玩；
- 不读取工作区文件、不运行 Shell，也不向游戏 frame 暴露编辑器 API。

当前 VSIX 不接管下载目录，也不在 Webview 中启动 EXE；界面必须按 HostAdapter 的能力说明显示这些限制。
