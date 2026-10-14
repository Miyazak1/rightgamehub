# 墨鱼工坊 for VS Code / Cursor

这是墨鱼工坊共享客户端的编辑器宿主。VS Code 与 Cursor 使用同一份 VSIX；运行时会根据 `vscode.env.appName` 显示真实宿主，并跟随编辑器主题。

## 安装

正式发布前可在仓库根目录运行 `npm run pack:vscode`，然后在 VS Code、Cursor 或兼容编辑器的扩展面板菜单中选择 **Install from VSIX...**，安装 `artifacts/gamehub-agent-<版本>.vsix`。也可以使用宿主 CLI：

```bash
code --install-extension gamehub-agent-<版本>.vsix
cursor --install-extension gamehub-agent-<版本>.vsix
```

重载编辑器后，点击 Activity Bar 的墨鱼工坊图标。扩展默认连接 `https://mooyu.fun`；私有部署可在编辑器设置中调整 `gamehub.apiUrl` 和 `gamehub.browserUrl`。

## 当前能力

- 共享大厅、猜百科、账号、创作中心与管理界面；
- VS Code/Cursor 主题色和高对比度跟随；
- access/refresh token 通过 SecretStorage 保存；
- 用户主动执行“墨鱼工坊: 提交当前创作包”时，读取工作区内的 `creator-manifest.json` 和声明的结构化源码，本地校验后提交为私有草稿；
- 在命令面板执行“墨鱼工坊课件”命令，可从三种参考模板创建课件，并完成概览、Doctor、loopback 预览、构建和确定性 ZIP 打包；
- “执行真实学习路径”只调用用户已经配置的 Playwright 模块。扩展不会静默下载浏览器、安装依赖或运行第三方安装脚本；
- Web 作品在隔离运行页游玩；
- 除上述显式提交操作外不读取工作区文件；不运行 Shell，也不向游戏 frame 暴露编辑器 API。

## 交互课件工作流

打开命令面板并搜索“墨鱼工坊课件”。新建课件后，依次运行“检查当前课件”“启动本地预览”“构建当前课件”和“打包当前课件”。Doctor 未通过时，构建与打包会停止，不会生成可发布产物。

真实学习路径测试是可选能力。在已经自行安装 Playwright 的环境中，将 `gamehub.coursewarePlaywrightModule` 设置为可导入的 Playwright 模块路径，再执行“执行真实学习路径”。未配置时扩展只给出明确提示，不会改变本机依赖。

当前 VSIX 不接管下载目录，也不在 Webview 中启动 EXE；界面必须按 HostAdapter 的能力说明显示这些限制。
