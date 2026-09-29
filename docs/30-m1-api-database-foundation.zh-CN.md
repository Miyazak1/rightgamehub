# GameHub M1.2 API 与数据库基础

日期：2026-09-24 · 状态：实现与本机 PostgreSQL 集成验证完成，尚未形成完整业务 API。

## 阶段目标

把 M1.1 的静态契约和 SQL 推进为可运行的 Fastify 5 服务基础：严格配置、存活/就绪探针、PostgreSQL 连接、受锁 migration runner、邮箱验证码和设备授权事务。

## 已实现

- Fastify 5 bootstrap，64 KiB 默认 JSON 上限，拒绝未知写字段，统一错误 envelope 和 UUID requestId。
- `/health` 只表示进程存活；`/ready` 同时检查数据库和全部 migration checksum，未知状态 fail closed。
- `pg` 连接池最大 5；事务 helper 在异常时回滚。
- migration runner 使用 PostgreSQL advisory lock、逐文件 SHA-256、单迁移事务和 checksum 防篡改；重复执行幂等。
- 邮箱 challenge：地址规范化、6 位验证码、10 分钟有效、基于数据库事务和 advisory lock 的同邮箱 60 秒重发限制；数据库只存带服务密钥的 HMAC。
- verify：行锁消费 challenge、失败计次、按已验证邮箱创建身份、设备授权、15 分钟 access token 和 30 天 refresh token；数据库只存随机 token 的 SHA-256。
- Auth 响应 `Cache-Control: no-store`。未配置邮件适配器时明确失败，不向真实邮箱误发测试验证码。
- `deploy/compose.dev.yml` 提供绑定 `127.0.0.1:54329` 的 PostgreSQL 16.10 开发实例；数据使用项目命名卷。

## 实际验证

- PostgreSQL 容器健康后，从空库实际执行 `0001`—`0008`。
- 再次执行 migration，确认没有重复应用。
- 在真实数据库创建 challenge、消费验证码、创建用户/身份/creator_usage/device grant/access token/refresh token。
- 同一 challenge 重放被拒绝。
- 使用真实数据库和 migration 状态调用 `/ready`，返回 ready。
- 平台测试 17 项：16 项常规通过；不提供数据库 URL 时真实数据库用例明确 skip。提供 `GAMEHUB_TEST_DATABASE_URL` 时 17/17 通过。连同 Harness 73 项，完整回归为 90/90。
- 原有 Harness 73 项继续纳入最终回归；测试没有运行真实 EXE。

## 当前边界

- 尚未实现 refresh token 轮换/族级重放撤销、设备 logout、Bearer 中间件和 `/me`。
- 尚未接邮件供应商或开发收件箱；默认 mailer 不可发送。
- 尚未实现作品、上传、对象存储、worker、运行网关和前端。
- Compose 密码仅用于本机开发示例，不得用于测试或生产。
- 本次真实数据库验证使用临时开发容器；收尾停止容器但保留命名卷。

## 下一增量

M1.3：补齐 refresh/logout/Bearer 认证与 `/me`，实现作者资格、作品和多目标 repository/API，再加入 Idempotency-Key 与 Work/Target ETag 的真实 PostgreSQL 并发测试。
