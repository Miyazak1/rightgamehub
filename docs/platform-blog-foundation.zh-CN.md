# 平台博客架构与实施状态

状态：核心链路已实现；真实 PostgreSQL 部署验证与分享卡生成待上线阶段完成

负责会话：平台主线会话

基线：`codex/change-radar-autonomous-research-design` 已推送提交 `a6956fefee468405e12c487e6a05698d8f6460a7`

## 1. 为什么必须是独立领域

平台已有三类相似但职责不同的内容：

- `DevelopmentEntry` 是从属于单个作品的版本与开发记录；
- `DiscoveryCampaign` 是管理员维护的发现页专题；
- `CommunityPost` 是用户社交投稿，依赖社区开关、审核队列和互动关系。

博客是平台的长期知识与公告资产。它不能依赖已经下线展示的社区，也不能伪装成作品更新或发现专题。因此博客使用独立的文章、修订、事件和来源证明模型。未来社区重新启用时，可以引用博客，但不能拥有博客数据。

## 2. 领域不变量

1. 文章身份与文章内容分离。`article` 保存身份、作者、状态和当前指针；正文保存在不可变 `revision` 中。
2. 公开读取只允许读取 `published_revision_id`。编辑 `working_revision_id` 时，线上内容不会变化。
3. 发布是显式动作。创建、编辑、研究导入、定时研究都不得隐式触发发布。
4. 撤回只切断公开可见性，不删除历史修订、来源证明和审计事件。
5. 每次写入必须携带 `Idempotency-Key`；每次既有文章变更必须携带当前 ETag。
6. 第一阶段是平台官方博客，只有状态正常且可发布的管理员账号可以写入；普通创作者和普通用户不能投稿。文章作者从服务器认证上下文取得，客户端不得提交或覆盖作者身份。
7. 第一阶段只接受结构化正文块，不接受 HTML、脚本、iframe、任意嵌入或客户端提供的渲染代码。
8. 引用只接受公开 HTTPS 地址；拒绝 IP、localhost、内网域名、凭据、端口与片段。
9. 研究系统只可调用“导入私有草稿”，且必须冻结报告摘要、声明 ID 与证据 ID。
10. 发布权限要求 `role=admin + canPublish + works:write`。待平台令牌迁移能力完备后再拆分为 `articles:write`，避免现有管理员设备立即失效。

## 3. 状态与修订

文章状态：

- `draft`：没有公开版本；
- `published`：存在公开版本；可能同时存在尚未发布的新工作版本；
- `withdrawn`：曾经公开但当前不可公开访问，历史仍保留。

修订状态：

- `working`：作者可继续形成新修订；
- `published`：被文章公开指针引用的冻结版本；
- `superseded`：被后续工作版本替代，但仍保留审计记录。

当已发布文章再次编辑时，文章仍为 `published`，公开指针保持不变。再次执行发布后才将工作修订提升为公开修订。此设计避免“改一半的文章”被读者或 Agent 看到。

## 4. 内容协议

第一阶段正文块只支持：

- `heading`：二级或三级标题；
- `paragraph`：纯文本段落；
- `quote`：纯文本引用，并通过 `citationIds` 指向来源；
- `list`：有序或无序纯文本列表；
- `code`：指定语言的纯文本代码块。

图片、附件、外部播放器和可交互组件暂不进入第一阶段。以后如需增加，必须先接入独立媒体处理、内容寻址、病毒检测与 CSP，而不是放开任意 URL 或 HTML。

每个文章修订包含：

- 稳定 slug、语言、标题、摘要；
- 结构化正文块；
- 结构化引用（标题、发布者、URL、发布时间与访问时间）；
- 规范化内容摘要；
- 可选但不可变的研究来源证明。

## 5. Change Radar / Researcher 边界

Change Radar 负责输出事实材料，不拥有博客发布权。约定的首个导入协议为 `change-radar-publication-draft-v1`，至少包含：

- topic ID；
- 不可变 report snapshot ID 与 SHA-256；
-被采用的 accepted claim IDs；
-对应 evidence IDs；
-生成时间。

平台网关必须验证这些 ID 均属于同一用户和同一报告快照，并且声明在快照冻结时已被接受。验证通过后通过独立的 `importResearchDraft` 仓储入口只创建 `draft`，不复用能够执行发布操作的通用写入口。Researcher 也只向 Change Radar 或平台网关交付研究工件，不直接写博客表。

## 6. API 轮廓

公开读：

- `GET /v1/blog/articles`
- `GET /v1/blog/articles/:slug`
- `GET /blog/:slug`（带 CSP、规范链接与 Article JSON-LD 的服务端页面）

作者管理：

- `GET /v1/me/blog/articles`
- `GET /v1/me/blog/articles/:articleId`
- `POST /v1/me/blog/articles`
- `PUT /v1/me/blog/articles/:articleId/draft`
- `POST /v1/me/blog/articles/:articleId/publish`
- `POST /v1/me/blog/articles/:articleId/withdraw`
- `POST /v1/me/blog/research-drafts`

所有响应使用 `Cache-Control` 明确区分：公开读可短时缓存，管理接口始终 `no-store`。公开页面不得回传工作修订、未发布引用或内部来源标识。

服务端与数据库仓储会再次核对管理员状态，不只信任客户端字段或旧令牌中的展示信息。每个管理员最多保留 100 篇未发布草稿，每 24 小时最多执行 200 次文章状态操作，每篇文章最多保留 200 个修订；达到上限时失败关闭，不自动删除历史。

## 7. 数据库实施顺序

Change Radar 已在提交 `a6956fefee468405e12c487e6a05698d8f6460a7` 正式落位迁移 `0108–0112`。本分支已经 rebase 到该提交，并从 `0113_platform_blog_foundation.sql` 开始增加：

- `blog_articles`；
- `blog_article_revisions`；
- `blog_article_events`；
- `blog_revision_research_provenance`；
- 复用现有 `idempotency_keys`，为博客操作增加命名空间。

数据库约束会负责状态枚举、指针归属、slug 唯一性和必要外键；事务内锁定文章，并将幂等回放、版本检查、修订创建、指针提升和事件追加放在同一事务中。

## 8. 分阶段交付

1. 已完成：内容协议、服务边界、幂等/并发协议、研究草稿安全边界与单元测试。
2. 已完成：在 Radar `a6956fef` 之后增加 `0113`、Postgres repository、路由、运行时注册和 API 集成测试。
3. 已完成：管理界面的文章列表、结构化区块/来源编辑器、发布确认与撤回。
4. 已完成：公开列表与正文、SEO 服务端页面、Article 结构化数据、站点地图与缓存策略；独立分享卡仍待补充。
5. 已完成：Agent 只读 `search_blog_articles` / `read_blog_article`；它们只返回已发布版本，不把文章伪装成可启动能力。
6. 待部署验证：在真实 PostgreSQL 执行 `0113`，完成创建、修订、发布、撤回和研究草稿导入的端到端验收。

## 9. 明确不做

- 不让研究任务或定时任务自动发布；
- 不复用社区投稿表和社区开关；
- 不把博客塞入作品开发日志；
- 不接收原始 HTML、脚本或 iframe；
- 不在第一阶段提供评论、点赞、上传附件或普通用户开放投稿；
- 不在另一个会话尚未提交时修改或搬运其工作树文件。
