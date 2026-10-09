# 玩家导航与创作者工作台

玩家主导航统一为发现、分享、共建、游戏库；窄侧栏仍保留四个一级入口。“添加到 Agent”放在顶栏右侧。

账号菜单显示当前身份，并复用既有权限与路由：

- 未登录：登录到 `/account`。
- 普通成员：账号与设置、申请成为创作者（`/creator` 原有申请流程）。
- `canPublish`：创作中心。
- `role=admin`：额外显示治理（`/admin`），服务端继续独立鉴权。

`/creator` 下使用创作者工作台导航：我的作品、上传发布、GitHub 导入、AI 接入联机、AI 接入排行榜；均连接既有页面。返回 GameHub 回到发现页。既有作品编辑、上传、构建、AI 任务和高级文档深链保留，作者数据和反馈仍在我的作品页。

菜单支持 Enter/Space、上下键、Home/End、Esc、Tab/Shift+Tab 和外部点击；关闭或选择操作后处理触发按钮焦点，账号/权限变化时关闭旧菜单。Web hash 路由与 Agent 内存路由共用组件。

验证：`tests/client/navigation-browser.test.cjs` 覆盖访客、玩家、创作者、管理员、直接治理访问、真实 moderation service 的 403、键盘与焦点、身份切换、320–1365px 布局和内存路由。发现页和原有 AI 接入浏览器回归继续运行。

本次无数据库迁移。VS Code/Cursor 0.3.41，Harness 0.1.23。
