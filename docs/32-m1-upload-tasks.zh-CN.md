# M1.4 多目标上传任务

状态：**完成**  
日期：2026-09-24

## 本阶段结果

M1.4 已把作者作品写入推进到可验证的上传任务闭环：创建 `WorkTarget`、事务预留配额、签发单任务上传授权、流式写入私有 quarantine、核对实际字节数与 SHA-256、幂等提交校验任务，并查询任务状态。

当前只接收 `targetKey=web` 与 `packageType=web_zip`。Windows 包类型仍保留在共享契约和数据模型中，但在扫描链路完成前由服务端明确返回 `UNSUPPORTED_PACKAGE`，不会假装可发布。

## 已实现内容

- `POST /v1/creator/works/:workId/uploads`：Bearer 作者授权、严格 JSON Schema、`Idempotency-Key`、作品归属校验、5 GiB 账户配额、单作者一个活动上传、300 MiB Web 展开空间预留。
- `POST /v1/creator/uploads/:uploadId/grant`：返回一次性明文 grant；数据库仅保存 SHA-256 哈希，响应禁止缓存。
- `PUT /v1/creator/uploads/:uploadId/content`：使用 `Authorization: Upload <token>`，不继承作者 Bearer 权限；服务端生成对象键并流式写入 `.partial`，成功后原子改名。
- `POST /v1/creator/uploads/:uploadId/complete`：要求幂等键，事务切换到 `queued`，依靠 `(kind,target_id)` 唯一约束保证并发重试只产生一个 `validate` 作业。
- `GET /v1/creator/uploads/:uploadId`：只允许所有者读取任务状态。
- 自动发布意图在对应 `WorkTarget` 行锁内递增 `publish_generation`；并发创建只有一个任务能取得活动上传名额。
- `0009_upload_release_label.sql` 以追加迁移保存 `releaseLabel`，不修改已应用的 `0001`—`0008`。

核心实现位于 `apps/api/src/upload-service.mjs`、`upload-repository.mjs`、`local-object-store.mjs` 和 `app.mjs`；共享 OpenAPI 已加入原始字节 PUT 与独立 `uploadGrant` 安全方案。

## 已验证的不变量

真实 PostgreSQL 16.10 集成测试覆盖：

1. 两个并发创建请求中一个成功、一个以 `UPLOAD_BUSY` 失败，`publish_generation` 只增加一次。
2. grant 只能消费一次；重复 PUT 返回 401。
3. 正确内容保存实际大小与摘要；同大小错误摘要返回 422、任务失败并释放预留。
4. 超过声明大小的流立即以 `UPLOAD_TOO_LARGE` 失败，不留下最终对象或 `.partial` 文件。
5. 两个并发 complete 都返回同一个任务状态，数据库只有一个 `validate` 作业。
6. `releaseLabel`、配额预留、活动上传计数和任务查询均由真实数据库断言。

最终验证：`npm run verify:m1-foundation` 通过；73 项既有测试与 18 项平台测试全部通过，共 91 项。测试 PostgreSQL 容器在验证后停止，命名卷保留。

## 明确边界

本阶段没有解析或信任 ZIP 内容，也没有创建 Release、公开资产或切换发布指针。quarantine 当前是开发环境本地适配器；生产对象存储、恶意软件扫描、受限解包、作业租约和不可变发布属于下一阶段。

## 下一阶段

M1.5：Web ZIP validator 与 publication。重点是作业租约/恢复、ZIP 路径与展开限制、资源清单、不可变 runtime 对象、Release 创建，以及在事务中核对 `publish_generation` 后切换 `WorkTarget.current_release_id`。
