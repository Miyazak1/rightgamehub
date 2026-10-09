# G3.3 共建任务与贡献履历

状态：代码完成；本地真实数据库、53→54 升级与双账号浏览器验收通过；待生产部署确认。
更新日期：2026-10-09

## 1. 协作流程

作者从已查看的玩家反馈创建私有草稿，填写标题、完成标准、难度和技能，再明确公开。玩家领取、提交成果；作者可填写原因退回修改，或验收并记入贡献履历。原反馈随验收标记为“已解决（贡献已验收）”，可直接打开关联任务。

验收和上线分开记录。作者可在验收时选择当前已发布版本，也可先验收、发布后再关联。平台验证版本属于该作品且当前可用；是否包含此项修改由作者核对。未关联时明确显示“尚未关联上线版本”。关联版本后若停止服务，界面会显示当前不可用。

## 2. 任务与异常处理

- 草稿和已关闭任务可编辑；草稿可关闭。每条反馈保持唯一任务，避免重复招募。
- 发布、重开、提交与验收检查作品公开状态和作者有效状态。
- 最多同时领取 3 个未到期进行中任务或待验收任务；作者不能领取自己的任务。
- 领取有效期 7 天，当前贡献者可以续期 7 天；退回或撤回提交后重新计算期限。
- 待验收任务不自动超时。贡献者可以撤回修改，也可以确认释放；作者可以填写原因关闭。
- 到期后名额立即不再计入上限；列表访问按索引每 30 秒最多整理 100 个过期任务，访问单个任务或执行动作时也会检查并整理，无需常驻轮询进程。
- 作品撤下、设为私有或暂停时，在同一数据库事务关闭其未完成任务、释放领取，并保存提交记录和通知。作品重新公开不会自动重开旧任务。
- 发布后的任务范围不可直接改写；需要调整时先说明原因关闭，编辑后重开。
- 作者操作携带 `expectedVersion`，防止旧页面覆盖编辑、验收已经撤回或重提的成果。

任务流：

```text
draft -> open -> claimed -> submitted -> completed
  |        ^       |           |
 close     |       + release   + request_changes / withdraw -> claimed
  |        |       + expiry    + release -> open
closed -> reopen              + close -> closed
```

## 3. 查找、沟通与隐私

“任务大厅”和“我的任务”分别查询，支持状态筛选和分页。我的任务保留过去领取的记录，包括已释放、到期、作品下架后的任务。创作中心也支持分页。任务详情使用独立地址 `/contribute/{taskId}`，可从通知、任务卡片、原反馈进入。

作者能看到成果地址和完整提交说明；退回修改、关闭必须填写 5–2000 字原因。相关账号在共建页面或创作中心查看任务通知，点击后标记已读。通知是站内记录，进入页面或手动刷新时读取，不发送邮件、不持续轮询。

处理记录仅追加。详情展示最近 100 条与当前账号相关的记录；作者可查看该任务记录。历史参与者只能查看自己参与期间的私有提交与处理说明，不能读取后来贡献者的私有说明。通知读取与已读标记均按当前账号隔离。

公开任务详情与列表隐藏反馈 ID、私有提交说明和处理原因。未验收时也隐藏其他贡献者身份及成果链接；验收后公开贡献者与成果链接，个人主页仍遵循原有隐私规则。

## 4. 数据和接口

基础迁移为 `0044_contribution_tasks.sql`；本次迁移为 `0054_contribution_workflow.sql`。

新增任务版本号、领取到期时间、退回/关闭原因和上线版本关联；新增历史参与者与事件通知回执。作品下架触发器覆盖所有作品状态写入入口，迁移时也整理已经隐藏的未完成任务。既有公开任务的领取期限从迁移时起给予 7 天。

```text
POST  /v1/creator/feedback/{feedbackId}/contribution-task
GET   /v1/creator/contribution-tasks?limit=21&offset=0
PATCH /v1/creator/contribution-tasks/{taskId}
POST  /v1/creator/contribution-tasks/{taskId}/issue-draft
GET   /v1/contribution-tasks?status=all&limit=21&offset=0&mine=true
GET   /v1/contribution-tasks/{taskId}
POST  /v1/contribution-tasks/{taskId}/claim
POST  /v1/contribution-tasks/{taskId}/release
POST  /v1/contribution-tasks/{taskId}/renew
POST  /v1/contribution-tasks/{taskId}/withdraw
POST  /v1/contribution-tasks/{taskId}/submission
GET   /v1/contribution-notifications?limit=21&offset=0
POST  /v1/contribution-notifications/{eventId}/read
```

作者 PATCH 操作：`edit / publish / close / reopen / complete / request_changes / link_issue / link_release`，均须携带 `expectedVersion`；关闭和退回需要 `reason`。`complete` 的 `releaseId` 可为空，`link_release` 必填。提交接口支持 `expectedVersion`。

`mine=true`、通知及所有写操作要求登录；作者操作要求创作者权限。分页默认 50、最大 100，页面每次请求 21 条显示 20 条并判断下一页。每账号每小时最多 120 次有记录的任务操作，数据库事务串行检查额度；系统到期与下架整理不计入额度。

## 5. GitHub 边界

领取任务不会获得仓库写权限。平台不执行提交的代码，不自动创建 Issue、分支或 PR，也不自动合并。GitHub Issue 草稿仅打开预填页，作者检查后手动提交。Issue 地址须属于任务关联仓库，成果地址验证 HTTPS 及基本安全格式；平台不据此保证代码正确或外部链接永久可用。

## 6. 验证与部署

自动验证入口：

- `tests/platform/contribution-tasks.test.cjs`：输入校验、鉴权和 Issue 草稿。
- `tests/platform/contribution-workflow-postgres.test.cjs`：真实 PostgreSQL 的双账号流程、并发领取、旧版本验收、通知隐私、分页、到期、名额、下架与不可篡改历史。
- `tests/client/contribution-browser.test.cjs`：真实 API 与数据库上的浏览器操作，包括编辑、领取、提交失败恢复、退回重提、验收、版本关联和窄屏布局。
- `tests/platform/deployment-preflight.test.cjs`：只快进包含当前线上提交的版本，保护现有分支与本地修改。

真实数据库测试使用专用本地 `GAMEHUB_COMMUNITY_DATABASE_URL`（`community_test`）；测试创建独立临时数据库。浏览器测试另需 `GAMEHUB_COMMUNITY_PLAYWRIGHT_PATH`。测试截图位于 `.runtime/contribution-acceptance/`。

生产使用发布提交内的 `deploy/update-community-sharing.sh`，以确认的提交 SHA 为参数。脚本先校验祖先关系、构建和备份，再应用迁移；更新后 `/ready` 的 expected/applied 都应为 54。云存档保持关闭。网页与 Agent 客户端一起发布；旧客户端需更新并重新加载后使用带版本检查的作者操作。

生产验收仍须用作者和贡献者两个账号确认任务、退回原因、贡献履历及通知，并核对页面版本和服务健康。自动验证结果不能替代“线上已更新”的确认。
