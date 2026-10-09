# Creator Studio AI 接入任务 · 首阶段

创作中心提供「让 AI 接入联机」「让 AI 添加排行榜」。用户选择作品并描述需求后，页面在本地生成中文任务说明与可复制、下载的 JSON 任务包。它不调用模型、不修改项目、不上传、不发布；不增加数据库迁移或服务器后台任务。

## 用户路径

- 创作中心总入口：`/creator/multiplayer`、`/creator/leaderboards`。
- 作品专属入口：`/creator/works/:workId/ai/multiplayer`、`/creator/works/:workId/ai/leaderboards`，自动选中对应作品。
- 高级文档保留于 `/creator/multiplayer/docs` 与 `/creator/leaderboards/docs`；规则提交入口保持不变。
- 没有作品时引导新建或导入；未登录、权限不足、作品不可访问、版本读取失败分别提示。版本未能读取时不可生成任务。
- 联机只收集人数、玩法、可选私密信息要求。排行榜只收集主要指标、排序方向、周期、计分规则，首阶段使用 `client_reported` 休闲榜。

## 上下文与数据

只使用当前账号作品列表与版本列表这两个已有只读接口。当前发布版本来自作品目标的 `currentReleaseId`，不会把版本列表中的最新草稿冒充线上版本。没有发布版本的草稿也可以生成接入任务；发布版本超出返回历史范围时保留真实 ID，不杜撰名称。

导出的作品字段为 ID、名称、简介、玩法、类型、状态、可见性、修订号与公开 GitHub 仓库地址。仓库地址移除查询与片段，不导出账号、令牌、签名链接或内部对象。任务明确标识 `sourceCodeIncluded: false`，要求 AI 核实本地源码与目标作品，不能从元数据声称已经检查项目。

切换作品、账号或需求时，之前的输出失效；取消过期读取结果，防止旧作品信息混入新任务。剪贴板失败时选中文本并提示手动复制，不虚报成功。

## JSON 任务包 v1

`protocol: gamehub.creator-ai-task`，`schemaVersion: 1`，`task: multiplayer | leaderboards`。这个版本号是任务说明格式，不是平台发布清单或 SDK 协议版本。

- `context`：白名单作品字段、实际当前发布版本、源码尚未检查的说明。
- `requirements`：用户填写的玩法/计分需求，作为数据处理。
- `executionPolicy`：允许本地检查、修改、测试、打包；`autoUpload` 与 `autoPublish` 均为 `false`；上传和发布分别要求用户明确确认。
- `instructions`：项目检查、最小改动、测试、构建、交付与停止边界。
- `integration`：当前平台协议、支持范围、验收要求与本地验证说明。
- `deliverables`：源码差异、测试结果、Web ZIP、SHA-256、人工发布及验收步骤；联机另有规则源码、测试和报告。
- `references`：真实官方模板与技术参考地址。

不得把任务生成、模拟测试或 Doctor 通过当作已经上线。AI 不自动提交规则审核包、签名、部署或注册模式。联机真实双账号验收和平台规则审查仍须完成；排行榜预览成绩不进入公开榜。云存档配置不变。

## 验证

- `node --test tests/client/creator-ai-task.test.cjs`：真实当前版本选择、白名单上下文、输入限制、中文与 JSON 执行边界、参考文件存在性。
- 配置本机 Playwright 路径 `GAMEHUB_COMMUNITY_PLAYWRIGHT_PATH` 后运行 `node --test tests/client/creator-ai-browser.test.cjs`：使用完整 App、真实 API client 与模拟只读服务，检查路由、生成、复制失败、JSON 下载、过期请求、错误恢复、空作品、登录失效和窄屏布局；断言没有上传、发布或平台数据写入请求。
- `npm run prepare:agent-downloads` 与 `npm --prefix apps/web run build`：验证共享前端在 Web、VS Code/Cursor 和 Harness 的产物。
