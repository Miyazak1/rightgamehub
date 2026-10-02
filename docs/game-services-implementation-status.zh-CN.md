# 游戏存档与竞赛基础设施：实施状态

更新：2026-10-02。实施分支：`codex/game-services-foundation`。

权威设计：

- [71 通用竞赛成绩与排行榜](71-platform-competition-leaderboards-design.zh-CN.md)
- [72 通用游戏存档](72-game-save-platform-infrastructure-design.zh-CN.md)

## 第一阶段：共享前置切片

本阶段提供后续领域服务需要的宿主、授权和传输边界，**没有完成 Cloud Save S0–S3 或 Competition C0–C4**，也不能据此公开 A Dark Room 或可信排行榜。

已落地：

1. PlayerCore 支持任一批准的 `cloudSave / competition / multiplayer` 能力创建桥。
2. 通用 `createWebGameHost`，模块只能注册属于自身能力的白名单方法。未注册模块不出现在握手中。旧多人入口作为兼容层，已有房间/对局行为保留。
3. 每次连接拥有独立端口、处理器和清理状态；旧异步操作不会将结果送入新连接。账号/设备授权身份变化会关闭旧桥。
4. `POST /v1/game-sessions`、`GET/DELETE /v1/game-sessions/current`。默认 5 分钟、每设备授权最多 8 个活动会话、每分钟最多签发 30 次（撤销不重置频率额度）。数据库只存令牌摘要，当前账号和设备授权必须匹配。
5. 作品、目标、release 与服务 scope 的撤销代际；撤下再启用不能复活旧会话。scope 审批有追加审计，授权快照不可修改。
6. 共享分片组件：16 KiB 解码正文、32 KiB JSON 信封上限、顺序与相同内容重传、SHA-256、总量、5 分钟空闲 TTL、中止、受限下载游标。
7. SDK 在关闭时取消未完成握手，发送前检查完整信封大小。保留已有协议主版本；存档/竞赛响应执行 32 KiB 上限，多人响应维持其既有领域边界，避免房间列表回归。
8. 修正旧发布规范的 sandbox 描述，与真实运行代码一致：不包含 `allow-same-origin`。

## 权限与兼容合同

当前平台身份接口使用父宿主持有的 bearer。游戏会话在此之上缩小作用域，不改变既有登录协议，也不把 bearer 或 gameSessionId 交给 iframe。

`game_release_service_scopes` 是平台审批记录，与 ZIP 清单分离。当前没有创作者写入该表的 API；后续领域服务必须验证 policy/mode 状态和 release 绑定后才可批准 scope。仅有 manifest 声明不能获得私有服务权限。

首次会话由可信宿主在首次服务 RPC 前创建；业务 handler 执行前必须成功完成授权。匿名本机存档将在持久缓存阶段单独接入，不能通过创建匿名云会话模拟。

新能力在共享合同中为可选字段。当前生产 catalog 和 ZIP 校验仍不开放新能力；领域 handler、持久缓存与控制面完成后再启用。测试中的单能力组合通过受控模块夹具验证宿主合同，不能当作实际游戏已经接入的证据。

分片首期仅接受 `identity` 编码。gzip 在受限解压与计量实现前明确拒绝。一个连接内两个领域共享一个活动 transfer；具体 handler 还必须实施自己的 policy 上限（存档默认 256 KiB，竞赛默认 256 KiB、硬上限 2 MiB）。

短期授权不证明客户端未被篡改；存档仍然是玩家可控制数据。正式比赛成绩必须由验证器或权威多人终局计算。

## 验证记录

- 现有基线：Legacy 74 通过/1 跳过，Platform 154 通过/5 跳过，Client 64 通过。初次 Client 缺少忽略的 Harness 产物，生成后通过。
- 整合 G3.3 后完整测试：312 通过、7 跳过、0 失败。跳过项包含需单独数据库环境的测试。
- 本阶段 PostgreSQL 集成专项：8 通过、0 失败；使用任务专用 PostgreSQL 16 容器，真实执行 0001–0045 迁移。
- 覆盖并发额度、跨用户/设备/作品、preview/production、scope 退休、release 禁用后重新启用、不可变授权和审计。
- 合同生成检查、Harness 构建、Web 正式构建通过。
- 此阶段没有生产部署、双账号人工游玩、备份恢复演练或混合负载验收。

复验：

```powershell
pnpm install --frozen-lockfile
pnpm build:harness
pnpm contracts:check
pnpm test
pnpm web:build
# 将下面的变量设置为专用测试数据库，勿指向生产库。
$env:GAMEHUB_GAME_SESSION_DATABASE_URL = '<dedicated-test-database-url>'
node --test tests/platform/game-sessions-postgres.test.cjs
```

## 合并与迁移

G3.3 使用 `0044_contribution_tasks.sql`，本分支基于它的完成提交 `50ac09a` 整合；共同修改的错误处理保留两个领域错误类型。没有改动 G3.3 的迁移正文。

本阶段新增 `0045_game_sessions.sql`，无破坏性表删除。部署应先备份并迁移，再更新 API/前端；新功能尚不启用。回滚应用代码时保留迁移，后续用向前迁移修复。

设计稿在源共享工作区原路径保留，实施分支使用编号 71/72，以避开 G3.2 的 68、G3.3 的 69 和 G4 的 70。

后续预留 0046/0047 给存档/竞赛，真正提交前再次检查远端迁移序列。与 G4 的生产演练、Skill/MCP 控制面保持分工；共用授权边界。

## 后续实施清单

- Cloud Save：policy、slot、revision、usage、operations；CAS、幂等优先于 CAS、配额与滚动历史；运行 API 与 namespace/schema 兼容。
- 持久缓存：Browser IndexedDB、Agent/Windows adapter；confirmed/inFlight/pending 原子 outbox；匿名导入、多设备冲突与 recovery。
- 用户/运营：导出、导入、恢复、删除、容量/写频率门禁、对账清理、break-glass 审计与真实备份恢复演练。
- Competition：模式/规则、赛季 closing、run/submission/decision/result-set/participants、租约验证器、代际榜单与水位追赶。
- 跨域后台资源门禁及实时对局、存档、验证、构建、备份的混合负载验收。
- 2048 确定性规则与回放验证、第二款不同结构存档游戏、迷阵权威终局适配；Web/Agent/Windows 跨端验收。
- 短期会话票据交换与 Agent/Windows 的受控本机凭据存储；目前复用已存在的宿主账号 bearer，不宣称原生票据流程完成。

第一阶段的成功不能替代上述完成条件。
