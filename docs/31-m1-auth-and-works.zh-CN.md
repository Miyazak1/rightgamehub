# GameHub M1.3 认证生命周期与作品写入

日期：2026-09-24 · 状态：实现并通过真实 PostgreSQL 集成验证；仍非完整作品发布闭环。

## 阶段目标

完成设备授权的使用和撤销闭环，并交付第一个真实作者写路径：登录后创建、幂等重放和基于 ETag 修改作品。

## 已实现

- `/v1/auth/refresh`：refresh token 单次轮换，绝对到期不延长。
- 旧 refresh token 再次使用时，事务内撤销该 family 和对应 grant 的 access tokens，要求重新登录。
- Bearer 中间件每次检查 access token、device grant、账号状态与到期时间。
- `/v1/me` 返回当前资料；`/v1/auth/device/logout` 幂等撤销设备、access 和 refresh。
- 设备 scopes 根据验证时的作者资格签发；后续把账号改为作者不会自动扩大旧设备 token 权限。
- `POST /v1/creator/works` 检查 `canPublish`、`works:write`、作品配额和 `Idempotency-Key`。
- 幂等 key 使用 PostgreSQL transaction advisory lock 串行同一操作；领域写入和结果缓存同事务提交。
- `PATCH /v1/creator/works/:id` 要求 Work `If-Match`；成功递增 revision，旧 ETag 返回 412。
- 请求 hash 使用递归规范 JSON，字段顺序不同但语义相同不会产生错误冲突。
- OpenAPI 增加 refresh/logout/me/update work，并明确 update 的 Idempotency-Key 与 If-Match。

## 真实数据库证据

- access token 可读取 `/v1/me`；logout 后相同 token 返回 401。
- refresh 成功产生新 token；重放旧 refresh 后，新 access token 也因族级风险处置失效。
- 获得作者资格后重新登录，新的设备授权包含作品写 scope。
- 两个并发、相同 Idempotency-Key 的创建请求返回同一 workId，数据库只有一条作品。
- 同 key 不同请求返回 409。
- 更新返回新 ETag；同请求幂等重放保持 revision；新 key 携带旧 ETag 返回 412。
- 完整测试仍包含 Harness 73 项；平台测试数量不因把多个真实场景放在同一隔离数据库用例中虚增。

## 当前边界

- 尚未实现作品公开目录、目标创建、上传任务、发布、撤下和管理员授权界面。
- refresh family 风险处置当前撤销对应 access token，不自动撤销设备记录；设备仍因没有可用 token 而需重新登录。后续管理设备列表时可明确显示风险状态。
- 尚未配置生产邮件、全局/IP 发送限流或真实邀请管理。
- 作者资格在测试中由数据库夹具开启，产品管理 API 尚未实现。

## 下一增量

M1.4：作品多目标与上传任务 API。实现 WorkTarget 创建、配额预留、上传 grant、流式内容接收、complete 入队与任务查询；继续使用真实 PostgreSQL 验证并发配额、上传幂等和 publish generation。
