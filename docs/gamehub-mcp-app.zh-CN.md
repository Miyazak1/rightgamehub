# GameHub MCP App 与统一自动更新

## 交付形态

GameHub 的游戏、目录数据和完整平台界面继续运行在 `mooyu.fun`。Codex / ChatGPT 插件只包含最小连接配置、技能说明和安全更新器，不复制游戏文件，也不在用户机器上运行平台服务端。内嵌界面使用独立的 `/mcp-app` 入口加载与网页端相同的平台客户端；主站其他入口仍禁止被第三方页面嵌入。

远程 MCP 入口为 `https://mooyu.fun/mcp`，当前公开 12 个稳定工具：

- 通用能力层：`search_capabilities`、`get_capability`、`launch_capability`，用于发现、读取和启动公开游戏、课件、官方工具与已发布合集；
- 兼容工具：`search_games`、`get_game`、`open_gamehub`，继续服务旧聊天和旧插件；
- 官方语义工具：`open_knowledge_map`、`open_pdf_reader`、`open_change_radar`、`open_privacy_redactor`、`open_document_compare`、`open_spreadsheet_audit`。

通用搜索和详情只返回有上限、已清洗的公开元数据。`launch_capability` 只表示完成导航，不表示游戏、课件、编辑、分析或监控任务已经完成；需要预填内容的明确任务继续使用相应 `open_*` 语义工具。

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

MCP 能力层不访问用户工作区或宿主凭据，也不开放账号写入、上传、发布或管理操作。知识图可在本地界面写入有上限的 Markdown；其他私密文件由用户在本地界面选择，原始内容不进入远程工具参数。完整网页客户端中的登录和创作者功能沿用 GameHub 现有服务与权限规则；需要离开内嵌上下文的授权流程会打开正式网页。MCP App 的视觉体验由支持开放 MCP Apps UI 和嵌入页面的宿主呈现；未呈现 UI 不影响模型读取结构化结果或获得正式网页入口。

## Agent 能力注册表

2026-10-20 起，六个官方工具的公共元数据由 `@gamehub/agent-capabilities` 统一维护，前端工具目录和远程 MCP 服务消费同一份严格、不可变注册表。React 组件加载器仍留在前端，输入输出 Schema 与 handler 仍留在 API；注册表不能引用任意模块、URL 或用户上传代码。P2 在这份注册表和既有公开目录之上增加稳定通用工具，作品数量增长不会增加顶层 MCP 工具数。旧工具名称、参数、响应、权限和 UI resource 保持兼容，完整设计及实施状态见 [80 Agent 能力层完整实施设计](./80-agent-capability-layer-implementation.zh-CN.md)。
