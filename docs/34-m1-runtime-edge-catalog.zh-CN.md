# M1.6 匿名目录与 Runtime Edge

状态：**完成本地开发闭环**  
日期：2026-09-24

## 本阶段结果

M1.6 已建立业务 API 与作者内容运行面的明确分界：

- 业务 API 匿名提供公开作品列表、公开详情和短期有效语义的启动描述。
- Runtime Edge 在独立端口启动，并要求 `r-<releaseId无连字符>.<runtimeDomain>` 的精确 Host。
- 每个 GET、HEAD、Range 和条件请求都先查询 PostgreSQL 的最新 Work、WorkTarget 与 Release 状态；没有“数据库异常时继续使用旧允许结果”的路径。
- 资产只有同时存在于已校验 manifest、完成标记和不可变 Release 前缀中才会返回。

## 已实现接口

业务 API：

- `GET /v1/works?limit=&kind=`：只列出至少有一个 ready/enabled 当前目标的 public/published 作品。
- `GET /v1/works/:workId`：只返回公开作品及其当前可用目标。
- `GET /v1/works/:workId/launch?releaseId=`：默认解析 Web 当前版；显式旧版必须仍为 ready/enabled。响应 `Cache-Control: no-store`，URL host 只能由服务端按 Release ID 构造。

Runtime Edge：

- `npm run runtime:start` 在 `RUNTIME_PORT` 启动独立 Fastify 服务。
- 只接受 GET/HEAD；POST、PUT、PATCH、DELETE、OPTIONS 返回 405。
- 支持完整响应、HEAD、单字节 Range 和 ETag 条件请求；多 Range 或越界 Range 返回 416。
- query 不参与对象键；编码斜杠、反斜杠、点段、控制字符、过深或未知路径被拒绝。
- 每次读取重新验证 `complete.json`、manifest SHA-256、Release 元数据、资产大小与 SHA-256。

## 浏览器安全响应

所有成功资产响应包含：

- `Cache-Control: no-store`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- 清单决定的精确 MIME、ETag、Content-Length 与 Range 头

HTML 额外使用平台生成的 CSP 和 Permissions-Policy。网络、Worker、frame、object、form、设备权限默认关闭；只有 manifest 已批准的 fullscreen/pointerLock 才分别加入对应响应策略。作者文件不能提供或覆盖响应头。

当前实现没有使用“过期允许结果”缓存，而是每个请求读取权威状态。这牺牲吞吐换取明确的 fail-closed 基线；试运行引入最长 30 秒状态缓存时，必须保持禁用状态不使用 stale fallback，并重新执行撤下测试。

## 真实数据库验证

真实 PostgreSQL 与真实 M1.5 发布资产完成以下检查：

1. 匿名目录发现已发布作品，私有/撤下目标不出现。
2. 启动描述只生成固定 Release 子域，不接受任意外部 URL。
3. HTML、JavaScript、HEAD、Range、ETag 与 MIME 正确。
4. 错误 Host、编码斜杠、越界 Range 和写方法被拒绝。
5. runtime 文件被篡改后立即返回 503，不返回变化后的字节。
6. WorkTarget 撤下后，普通请求与带命中 ETag 的条件请求都立即返回 404。
7. PostgreSQL 状态读取异常时返回 503 与 `no-store`，不会继续读取对象存储。

最终执行 `npm run verify:m1-foundation`：73 项既有测试与 20 项平台测试全部通过，共 **93 项**。

## 部署边界

本阶段证明本地双服务与状态门禁逻辑，不表示生产 DNS、TLS、Cloudflare Worker/Cache API、跨数据中心失效或 60 秒撤下 SLA 已验收。生产必须使用独立无业务 Cookie 的运行域，私有对象存储不能公开直出，并对真实 CDN/代理再次执行 S05—S07。

## 下一阶段

M1.7：共享客户端。实现随 Agent/宿主主题切换的游戏化界面、匿名目录/详情、账号与作者区、上传时间线和 PlayerCore，并保持功能清晰、键盘可达与窄侧栏友好。
