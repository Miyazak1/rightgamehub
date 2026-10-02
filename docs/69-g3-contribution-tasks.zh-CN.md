# G3.3 新手贡献任务与公开贡献履历

状态：代码完成，待生产部署验收
更新日期：2026-10-02

## 1. 本阶段交付

G3.3 把作者已经确认的玩家反馈变成一个受控、可追踪的新手贡献闭环：

1. 作者只能从自己作品中已查看或已关联 Issue 的反馈创建私有任务草稿。
2. 作者补充标题、完成标准、难度和技能标签后，必须再次明确点击“公开任务”。
3. 玩家可浏览公开任务，领取其中一个任务，并提交公开的 PR、commit 或演示地址。
4. 作者可以验收完成、退回修改、关闭或重新开放任务。
5. 只有作者验收完成且存在公开成果地址的贡献，才显示在贡献者公开主页。

导航新增“共建”入口。作者的任务管理仍位于创作中心，避免把作者操作和玩家任务市场混在一起。

## 2. 信任与 GitHub 边界

GitHub App 权限保持只读。本阶段没有增加 GitHub 写权限，也不会：

- 自动创建 Issue；
- 自动创建分支、commit 或 Pull Request；
- 给贡献者授予仓库写权限；
- 拉取或执行贡献者提交的代码；
- 把私有反馈内容未经作者确认直接公开。

“生成 Issue 草稿”只返回 GitHub `issues/new` 预填地址，并附带 `good first issue` 标签建议。作者必须检查内容、确认仓库已启用 Issues，并在 GitHub 手动提交。领取任务只表示站内协作意向；实际贡献仍通过仓库既有 fork / PR 流程完成。

## 3. 数据模型与状态机

迁移 `0044_contribution_tasks.sql` 增加：

- `contribution_tasks`：作品、来源反馈、作者、认领者、难度、技能、仓库/Issue/成果地址和状态；
- `contribution_task_events`：创建草稿、公开、领取、释放、提交、退回、验收、关闭、重开和 Issue 操作的仅追加事件；
- 作者队列、公开任务队列和贡献者活动任务索引；
- 事件表更新/删除阻断触发器；
- 状态、认领者、提交地址和时间戳之间的数据库一致性约束。

状态流：

```text
draft -> open -> claimed -> submitted -> completed
           ^        |          |
           |        + release  + request_changes -> claimed
           |
         reopen <- closed
```

规则包括：

- 仅公开发布且关联有效 GitHub 仓库的作品可以公开任务；
- 作者不能领取自己的任务；
- 每位玩家最多同时保有 3 个 `claimed` / `submitted` 任务；
- 只有当前认领者能释放或提交任务；
- 只有作品作者能验收、退回、关闭、重开和关联 Issue；
- Issue 地址必须属于作品关联仓库；
- 提交地址必须是公开 HTTPS 地址；
- 匿名公开列表不返回来源反馈 ID、提交说明或未验收贡献者身份；成果地址和贡献者仅在完成验收后公开。

## 4. API

```text
POST  /v1/creator/feedback/{feedbackId}/contribution-task
GET   /v1/creator/contribution-tasks
PATCH /v1/creator/contribution-tasks/{taskId}
POST  /v1/creator/contribution-tasks/{taskId}/issue-draft

GET   /v1/contribution-tasks?status=all|open|claimed|submitted|completed
POST  /v1/contribution-tasks/{taskId}/claim
POST  /v1/contribution-tasks/{taskId}/release
POST  /v1/contribution-tasks/{taskId}/submission
```

除公开列表外，所有接口都要求 GameHub 登录。作者接口还要求创作者权限。公开列表仅包含公开作品的 `open`、`claimed`、`submitted` 或 `completed` 任务。

## 5. 界面行为

作者侧：

- 玩家反馈需要先“标记已查看”；
- “从反馈创建共建任务”展示私有草稿表单；
- 共建任务区提供公开、关闭、重开、Issue 草稿、Issue 关联、退回修改和验收入口；
- 验收按钮明确写为“验收并记入履历”。

玩家侧：

- “共建”页面可按状态筛选；
- 卡片展示作者、作品、难度、技能、仓库、Issue 和成果；
- 未登录领取时转到登录页；
- 当前认领者可以提交成果或释放任务；
- 已完成任务展示贡献者和公开成果。

公开主页新增“已完成贡献”，只展示作者验收后的任务、关联作品、完成日期和公开成果链接。

## 6. 部署与生产验收

服务器拉取包含本阶段提交的版本后，继续使用现有部署入口：

```sh
cd /www/gamehub
git pull --ff-only origin main
cd /www/gamehub/deploy
sh deploy.sh
curl -fsS https://mooyu.fun/ready
```

`deploy.sh` 会重建镜像并由 `migrate` 服务应用 `0044`。`/ready` 必须显示迁移 `expected` 与 `applied` 均为 `44`，且 API、Web、Worker、Source Builder、Rule Builder/Worker 保持健康。

生产验收至少覆盖两个账号：

1. 作者从一条“已查看”反馈创建草稿；草稿不会出现在公开共建页。
2. 作者公开任务；另一账号在“共建”页可以看到并领取。
3. 作者账号无法领取自己的任务；贡献者同时领取第 4 个任务会被拒绝。
4. 贡献者提交公开 PR 地址；作者可退回，贡献者可再次提交。
5. 作者验收后，贡献者公开主页出现该成果；关闭或未验收任务不会出现。
6. Issue 预填页指向正确仓库；跨仓库 Issue 地址被拒绝；GitHub 仓库没有被平台自动写入。
7. 桌面与窄屏页面都可完成领取、提交和验收。

自动验证已覆盖契约生成、迁移顺序、服务状态与权限、路由鉴权、客户端请求和 Web 正式构建。真实 PostgreSQL 集成测试仍需在设置 `GAMEHUB_TEST_DATABASE_URL` 的环境运行。

## 7. 后续路线

G3.3 生产验收后，G3 主线可以进入 Remix / 衍生作品来源链：显式记录来源作品与固定版本、作者确认公开、许可证兼容提示和衍生关系展示。它不应自动复制私有仓库，也不应把许可证提示表述为法律结论。
