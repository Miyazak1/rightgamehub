# P0.4：VS Code / Cursor 真实宿主适配

日期：2026-09-29。状态：代码、构建与 VSIX 产物完成；本机没有可用的 `code` / `cursor` CLI，因此尚未写成“已在两个编辑器安装验收”。

## 本阶段交付

- `createEditorHostAdapter`：区分 VS Code 与 Cursor，报告真实版本、远程工作区与功能边界；
- 共享 React 客户端：不是跳转占位页，大厅、游戏、账号、创作与管理界面共用平台代码；
- WebviewView 宿主桥：主题变化、请求关联、超时处理与严格操作白名单；
- SecretStorage：只允许读取、写入、清除 GameHub token，不暴露通用宿主 API；
- 开发 CORS：仅 `NODE_ENV=development` 接受格式严格的 `vscode-webview://<id>`，生产环境仍需显式来源；
- 标准 VSIX：`artifacts/gamehub-agent-0.1.1.vsix`，可重复执行 `npm run pack:vscode` 生成。

## 能力矩阵

| 宿主 | 本阶段接入 | 当前结论 |
| --- | --- | --- |
| VS Code Desktop | Activity Bar + WebviewView + SecretStorage | 已实现并自动验证，待目标版本手工安装/交互验收 |
| Cursor 编辑器 | 复用同一 VSIX并按 appName 标识 Cursor | 已实现并自动验证，待目标版本手工安装/交互验收 |
| Codex Desktop | 内置浏览器打开本地 GameHub | 可用回退；不声称存在未公开的第三方常驻侧栏 UI |
| Harness | 现有正式右栏插件 | 已有独立真实宿主链路，不由本 VSIX 替代 |

Codex 的官方插件架构由 skills、MCP servers、apps 等组成；官方 MCP Apps UI 文档明确描述的是 ChatGPT 中的交互 UI。因此本阶段不把模型名当宿主，也不伪造“Codex 原生扩展已完成”。参考：[Codex plugin architecture](https://developers.openai.com/plugins/concepts/plugins)、[MCP Apps UI](https://developers.openai.com/plugins/build/chatgpt-ui)。

## 安全边界

扩展只接受三个桥操作：`credentials.get`、`credentials.set`、`credentials.clear`。配置 URL 必须是 HTTPS，或本机 `127.0.0.1` / `localhost` HTTP，且禁止 URL 内携带账号密码。Webview CSP 将脚本限制为扩展资源，将网络限制为配置的 API origin。扩展没有 `child_process`、终端创建或工作区文件读取代码。

## 验收与未完成项

已通过：扩展主进程语法检查、共享前端打包、HostAdapter 主题/凭据/远程能力测试、开发/生产 CORS 分界测试、VSIX ZIP 结构检查及全量自动测试。

仍需在安装有目标编辑器的机器分别完成：安装 VSIX、侧栏首次加载、GitHub/邮箱登录、刷新后 SecretStorage 恢复、主题切换、猜百科完整一局、Web 作品启动、远程工作区标识。未完成这些步骤前，不把 VS Code/Cursor 标成完整兼容。
