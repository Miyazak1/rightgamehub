# GameHub MCP App 与统一自动更新

## 交付形态

GameHub 的游戏、目录数据和完整平台界面继续运行在 `mooyu.fun`。Codex / ChatGPT 插件只包含最小连接配置、技能说明和安全更新器，不复制游戏文件，也不在用户机器上运行平台服务端。内嵌界面使用独立的 `/mcp-app` 入口加载与网页端相同的平台客户端；主站其他入口仍禁止被第三方页面嵌入。

远程 MCP 入口为 `https://mooyu.fun/mcp`，首版公开三个只读工具：

- `search_games`：搜索可在线运行的公开游戏；
- `get_game`：读取一个游戏的公开资料和稳定作品地址；
- `open_gamehub`：在支持 MCP Apps 的宿主中以全屏模式打开服务器托管的完整 GameHub 界面。

MCP App 内部导航始终停留在 `/mcp-app`，真实页面路由保存在 `gh_route` 中，因此社区、发现、游戏详情和游玩页切换后刷新仍可留在内嵌界面。外部打开使用 `/discover`、`/community`、`/w/:id` 等正式网址，不向用户暴露内嵌入口。

工具必须在宿主不支持 UI 时仍然可用。MCP Apps 资源使用版本化 URI `ui://gamehub/platform-v2.html`；不兼容宿主返回稳定网页地址作为回退。

## 更新模型

所有 GameHub 宿主插件遵守同一更新契约：

1. 首次安装与权限授予必须由用户确认；
2. 服务器端 MCP 工具实现和托管界面随平台部署生效，不要求重新安装本地插件；
3. 本地技能、清单、连接配置或宿主适配器通过 `downloads/manifest.json` 发布；
4. 更新器每 6 小时检查稳定通道，下载后先校验 SHA-256，再逐文件更新本地 marketplace；
5. 已暂存的本地包在宿主重启后激活，不修改正在运行的进程；
6. 更新失败记录为 `failed` 并在下次周期重试，不删除当前可用版本；
7. 新增权限、认证范围或可写工具时不得静默启用，必须重新提示用户确认。

Cursor / VS Code 由扩展自身完成下载与安装；Harness、Codex 和 Claude 使用同一平台清单与后台计划任务。`agentPlugin.updateScope=all-marketplace-plugins` 表示一个经过校验的 marketplace 包覆盖当前及以后由 GameHub 发布的同类 Agent 插件。

## 当前边界

MCP 工具本身仍是只读的，不访问用户工作区或宿主凭据。完整网页客户端中的登录、社区和创作者功能沿用 GameHub 现有服务与权限规则；需要离开内嵌上下文的授权流程会打开正式网页。MCP App 的视觉体验由支持开放 MCP Apps UI 和嵌入页面的宿主呈现；未呈现 UI 不影响模型调用只读工具或给出正式网页入口。
