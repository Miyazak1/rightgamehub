# 游戏存档与竞赛基础设施：实施状态

更新：2026-10-08。实施分支：`codex/game-services-foundation`。

权威设计：

- [71 通用竞赛成绩与排行榜](71-platform-competition-leaderboards-design.zh-CN.md)
- [72 通用游戏存档](72-game-save-platform-infrastructure-design.zh-CN.md)

## 当前状态：声明式排行榜 v1（2026-10-08）

以下第一至第五阶段保留历史验收记录；本节描述最新实现。云存档继续关闭，本机存档保留。排行榜独立于云存档，不新增服务。

- 创作者以 `platform.json` 声明榜单、整数指标、排序与规则版本；经过上传校验和发布绑定后，SDK 可签发运行、提交/重试成绩。游戏详情页自动展示相应指标、周期和本人名次，无需前端作品白名单。
- 首版支持明确标记的休闲榜与平台固定的 2048 回放验证榜。猜百科沿用旧成绩及题目隔离；2048 提供独立排行挑战，第三方「十次点击」模板通过同一上传流程接入。规则版本不可覆盖修改，预览成绩不入公开榜；身份、屏蔽、隐私、作废/恢复及审计生效。
- 每账号每小时最多 60 局，全平台最多保留 20,000 条运行记录；达到容量后暂停新局，已签发局提交、榜单读取和自由游玩继续可用。复用 worker 限量清理过期原始回放与未完成运行。完整范围见 [接入合同与限制](competition-creator-guide.zh-CN.md)。
- 迁移为 `0053_competition_boards.sql`。VS Code / Cursor 版本 `0.3.34`、Harness `0.1.16`。这轮没有执行生产部署；更新脚本备份后迁移，更新校验器，并通过原上传流程发布 2048 新版本，保留旧版本。2048 原生存储在正式沙箱中使用页面内存，本轮只隔离自由模式和排行挑战，不承诺刷新续玩；其他已接入平台本机存档的游戏不受影响。
- `npm run verify:m1-foundation`：391 通过、20 跳过、0 失败。另在真实 PostgreSQL 执行通用发布/成绩专项：8 项通过；实际 Chromium 的 2048、可编辑第三方模板、猜百科详情页回归：3 项通过，覆盖 360–1200 px。2048 和模板使用正式 runtime 资源响应与 `sandbox="allow-scripts"`。API 与校验器生产镜像、Web 镜像的构建阶段通过，API 镜像入口可加载；Web、VSIX、Harness 本机构建通过。
- 浏览器验收使用本地数据库和测试身份，不是生产投稿或本轮新安装的 Cursor 人工验收。没有完成混合负载测试、独立 Windows 宿主、团队/Elo、通用异步验证器审核与重算流水线，不把本版视为完整 C0–C4。

复验入口：`tests/platform/competition.test.cjs`、`tests/platform/competition-publication.test.cjs`、`tests/client/competition-browser.test.cjs`。数据库专项需要 `GAMEHUB_COMMUNITY_DATABASE_URL` 指向专用测试库，浏览器专项另需 `GAMEHUB_COMMUNITY_PLAYWRIGHT_PATH`。

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

## 第二阶段：Cloud Save S0（2026-10-05）

S0 的数据库与运行 API 已实现；生产能力仍关闭。新增 `0046_game_saves.sql`，包括 policy/审批审计、slot、不可变 revision、可回收 payload、usage、跨 channel 的写频率预算，以及不可变幂等操作回执。

已落地：

- 运行 API 提供策略、列表、元数据、正文、写入、删除、历史分页与恢复。所有请求通过账号 bearer 和短期游戏会话绑定 user/work/channel/namespace；接口不接受用户或 release 覆盖字段。
- 原样保留正文，以 SHA-256 校验；JSON 必须是 UTF-8 顶层对象，并限制深度和节点数。默认单文档 256 KiB、硬上限 1 MiB，只接受 identity 编码。
- 新槽使用 `If-None-Match: *`，已有槽使用单一强 ETag。先查完整请求摘要的幂等回执，再做 CAS；相同重试返回原成功结果，摘要或前置条件改变返回 409，过期 ETag 返回 412。
- 每用户/作品/channel 的当前正文总额固定不超过 1 MiB、有效槽不超过 10 个，所有 namespace 共享。namespace policy 可进一步收紧额度。写频率跨 production/preview 共用 20 次/分钟、2,000 次/UTC 日；重试不重复计数，日额度耗尽后仍可删除有效槽。
- 历史正文按 namespace 策略与 5 MiB 作品级总预算回收；优先保留有效槽的上一份正文。回收不改变修订事实和幂等回执，不阻塞当前保存；不足时返回 `historyDegraded`。
- 删除写入墓碑；恢复复制历史正文为新修订，保留来源 ID。已清理历史明确返回 410。读取列表隐藏墓碑，元数据仍返回其 ETag，重新写入必须以墓碑 ETag 为基线。
- 授权行在领域事务中持有共享锁，撤销与保存有确定顺序。SQL 约束防止跨槽指针、修订重写、孤立新修订、正文摘要不符及清理当前正文。正文、指针、计数和回执一起提交或回滚。
- 正文响应设置 private/no-store、nosniff 和 attachment；错误不返回正文。接口契约与 TypeScript 声明已更新。revision 以十进制字符串返回，避免 bigint 精度损失。

本次验证：

- 完整测试：315 通过、8 跳过、0 失败（Legacy 74、Platform 163、Client 78）。
- 存档 PostgreSQL 专项：11 通过、0 跳过、0 失败；真实应用 0001–0046 迁移。
- 共享会话 PostgreSQL 专项：8 通过，包含新事务授权路径的原有撤销/隔离回归。
- 合同生成与检查通过。故障注入覆盖写入正文、更新指针和清理历史之后出错，确认事务完整回滚。

实施细化：修订事实保存在 `game_save_revisions`，正文放入 `game_save_payloads`。清理只移除历史 payload，不破坏 append-only 修订。首期只落地 PostgreSQL bytea；对象存储迁移、recovery 保护和账号删除保留策略在后续阶段实现。

S0 完成时尚未实现的 handler/SDK 已在下述 S1 切片接入。当前仍未完成：持久 outbox、冲突 UI 与独立 recovery 预算、用户管理/导入导出、定时对账清理、容量门禁、备份恢复演练和 Competition。策略审批目前保留数据库审计入口，没有对创作者开放写 API。这里的运行 API 会在发布撤下后拒绝旧会话；作品撤下后仍可管理自己的存档，需要后续独立账号管理入口。

复验存档专项：

```powershell
$env:GAMEHUB_GAME_SAVE_DATABASE_URL = '<dedicated-test-database-url>'
node --test tests/platform/game-saves.test.cjs tests/platform/game-saves-postgres.test.cjs
```

## 第三阶段：Cloud Save S1 在线链路（2026-10-05）

已完成可信宿主与 SDK 的在线链路实现及内部自动化验证，**尚未完成 S1 的实际游戏适配与双宿主人工验收**。没有新增迁移，继续使用 0046；生产能力保持关闭。

已落地：

- 默认通用宿主注册 cloudSave handler，SDK 提供策略、列表、元数据、JSON/二进制读写、删除、历史分页、恢复与状态事件；接入说明见 [SDK 文档](../packages/web-game-sdk/README.md)。
- 16 KiB 分片上传及下载共用连接级传输边界；上传前查批准策略，commit 绑定 begin 的槽、正文摘要、schema、CAS 和幂等键。提交等待期间保留传输占用；旧游标不能跨重连或账号继续使用。
- 元数据和正文下载使用 If-Match 绑定同一修订，流式限制实际下载字节数，并校验摘要、长度与类型。空二进制正文与墓碑读取均可往返。
- 服务端成功 ACK 才显示云端确认；冲突、未确认与不可用分别提示。不同槽的成功不会隐藏另一槽的未解决问题；尚无冲突选择/副本 UI。
- 新增只查询已提交结果的 write-receipt API。策略缩小或退休后，同一完整请求仍能取得原成功回执；修改正文、CAS 或幂等键不能绕过策略创建写入。
- 账号身份在请求及凭据重试前复核；新账号不会携带旧会话提交。桥只转发受限冲突元数据，不暴露 bearer、gameSessionId 或服务端私有字段。
- 多人模板改为完整模块打包并携带 SDK 依赖，避免新增存档模块导致已有模板失效；Cursor 的受版本管理客户端产物已重新构建。

验证证据：

- 全套测试分组复验：Legacy 74 通过/1 跳过、Platform 164 通过/7 跳过、Client 87 通过，共 325 通过、8 跳过、0 失败。旧 Cursor 产物测试的函数名断言已更新为通用宿主及两个领域处理器检查。
- SDK、存档单元与 PostgreSQL 专项组合 23 通过；其中 PostgreSQL 专项 12 通过，真实应用 0001–0046 迁移。
- MessageChannel → SDK → 默认宿主 → 真实 HTTP handler → PostgreSQL 链路覆盖 JSON、256 KiB 二进制、并发 CAS、提交后 ACK 丢失重试、原回执与较新修订共存、删除/恢复、策略缩小/退休，以及两个账号隔离。
- 合同检查、Harness/VS Code 扩展/Web 正式构建、多人模板构建通过。新增 SDK TypeScript 声明已提供，未运行独立 TypeScript 编译检查。

测试使用真实 MessageChannel、应用 HTTP 注入和 PostgreSQL；web/agent 为两个模拟宿主，不等于真实浏览器/Cursor 游玩。当前工作树未找到 A Dark Room 源码及三类黄金存档，因此尚无真实游戏 adapter、网页刷新续玩和跨宿主进度验收证据。

后续范围：S1 的实际游戏适配与验收；S2 本机缓存/outbox；S3 用户管理、recovery、容量门禁、对账及备份恢复。当前不能据此公开长流程游戏。

专项复验：

```powershell
$env:GAMEHUB_GAME_SAVE_DATABASE_URL = '<dedicated-test-database-url>'
node --test tests/client/cloud-save-sdk.test.cjs tests/platform/game-saves.test.cjs tests/platform/game-saves-postgres.test.cjs
```

### 推送前部署镜像验证

推送核对发现 Docker 构建阶段未包含 API 新增的 contracts 工作区依赖。已补齐 API、源码构建器、规则构建器、校验器的依赖清单，并将 contracts 正文加入 API 运行镜像。四个镜像均在本机实际构建成功；随后在断网临时容器中验证 API 和三个工具入口模块图可加载。

生产更新使用 `/www/gamehub/deploy/compose.prod.yml` 与 `.env.prod`。本次 API/Web 更新可仅构建 migrate、api、runtime、worker、source-worker、rule-worker、web，沿用现有隔离构建器及其固定摘要。更新前执行 `BACKUP_ROOT=/www/backup/gamehub sh backup.sh`，显式运行 migrate，再重启应用服务；完成后 `/ready` 应显示 46/46。

0044–0046 上线后，只有 43 份迁移文件的旧代码会因 unexpected_version 无法通过 readiness。应用回退必须使用保留已应用迁移文件的兼容版本；不能仅切回旧提交并宣称已完成回滚。本轮只推送功能分支，没有执行生产部署。

## 第四阶段：A Dark Room S1 参考适配（2026-10-06）

真实参考游戏适配及本机浏览器/Cursor 开发宿主验收已落地，见 [示例、复验命令与验收边界](../samples/adarkroom/README.md)。没有新增迁移，线上能力仍关闭。

- 固定上游提交 1fada4620b6c66bd07bf15a3f1eb8223df8bc1d7，保留 MPL-2.0、中文与音频；校验源码摘要并构建内部 ZIP。
- 替换 localStorage 与 eval 状态路径，在原 runtime CSP/sandbox 下等云端读取成功后启动；保留原状态格式和手动导出码。
- 合并周期保存、明确 ACK、冻结原请求重试；发生冲突时展示物资/建筑摘要与双方导出码，明确选择后仍以 CAS 更新。
- 真实 Chromium 浏览器和 Cursor 3.22.12 开发 Webview 完成中期双向接续；Cursor 增加陷阱后，旧浏览器被阻止覆盖，选择云端恢复新进度。
- 独立 PostgreSQL 的 A/B 账号隔离、网页刷新、61×61 世界地图不重生成、飞船参数及分数保留通过。
- 三个阶段起点及三份原游戏引擎实际导出的回归快照已保留；起点是人工构造，不能称为从零完整通关的黄金样本。
- 全套 338 通过/8 跳过/0 失败；真实 PostgreSQL 专项 12 子测试及总套件通过；适配器专项 13 通过。内含真实 SDK/HTTP/PG 的阶段保存与提交后丢 ACK 重试。
- 补齐 FLAC MIME，窄窗口保存栏及底部菜单不再互相覆盖。原有能力审批、账号边界、CSP 未放宽。

这里的 Cursor 是实际原生 Webview，使用正式 PlayerCore/host/SDK，但登录和目录由本机验收壳替代；正式安装版 VSIX、真实身份、线上审批和全程游玩仍需独立验证。测试库使用 production 协议频道以覆盖非作者账号，未改线上审批。S2 持久 outbox、S3 recovery/管理/容量与备份恢复尚未实现，不可据此公开长期进度游戏。

## 第五阶段：安装版入口与真实身份验收（2026-10-06）

已建立独立 Cursor 配置/扩展目录、正式 VSIX 和本机 PostgreSQL/Redis 验收环境。修复安装版连接 loopback API 时误拒合法 HTTP runtime 的问题；生产来源限制不变。

- 真实 OTP、设备授权、目录、资源清单、SDK/HTTP/PG 链路五组复验通过；覆盖令牌自动刷新、跨设备续玩、CAS 冲突、账号隔离及设备撤销。
- 正式网页客户端经邮箱登录与目录入口完成点火、保存和刷新续玩。客户端 102 项测试及 Web/Harness/VSIX 构建通过；本机 readiness 为 46/46。
- 完整客户端实测发现并修复游戏透明背景造成的深色平台黑字不可读；浅色、夜间模式和菜单通过检查。测试作品连续发布新 release 后仍继承原存档，未改写已发布资源清单。
- VSIX 0.3.23 在 Cursor 3.23.23 专用 IDE 窗口完成真实邮箱登录、正式侧栏目录启动和双向续玩。Cursor 建造陷阱后旧网页保存被 CAS 阻止，比较确认 0/1 后读取云端；网页再建造第二个陷阱，重开 Cursor 编辑器后自动恢复同一设备授权并读到 2 个陷阱，继续保存成功。验证覆盖编辑器/扩展宿主重建，未关闭仍在运行的 Cursor Agents 进程。
- 本地脚本只为随机测试作品返回 cloudSave；正式 catalog/ZIP 能力开关、生产审批和数据库均未修改。没有新增迁移或线上部署。

[环境、命令、边界与清理](../samples/adarkroom/README.md#安装包与真实身份验收环境)。

## 权限与兼容合同

当前平台身份接口使用父宿主持有的 bearer。游戏会话在此之上缩小作用域，不改变既有登录协议，也不把 bearer 或 gameSessionId 交给 iframe。

`game_release_service_scopes` 是平台审批记录，与 ZIP 清单分离。当前没有创作者写入该表的 API；后续领域服务必须验证 policy/mode 状态和 release 绑定后才可批准 scope。仅有 manifest 声明不能获得私有服务权限。

首次会话由可信宿主在首次服务 RPC 前创建；业务 handler 执行前必须成功完成授权。匿名本机存档将在持久缓存阶段单独接入，不能通过创建匿名云会话模拟。

新能力在共享合同中为可选字段。当前生产 catalog 和 ZIP 校验仍不开放新能力；持久缓存、控制面与实际验收完成后再启用。S1 的默认存档 handler 已接真实 API/数据库；模拟宿主验证不能当作实际游戏已经接入的证据。

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

存档 S0 已使用 0046；0047 继续预留给竞赛。提交前再次核对远端 main 仍为 e6ec421，未出现编号冲突。与 G4 的生产演练、Skill/MCP 控制面保持分工；共用授权边界。

## 后续实施清单

- Cloud Save S1：在线 handler/SDK、A Dark Room 参考适配、本机浏览器/Cursor 开发宿主接续已完成；正式安装版的本机真实身份、双向续玩和编辑器重开恢复已验收；线上身份/审批及全程游玩样本仍待验证。
- 持久缓存：Browser IndexedDB、Agent/Windows adapter；confirmed/inFlight/pending 原子 outbox；匿名导入、多设备冲突与 recovery。
- 用户/运营：导出、导入、恢复、删除、容量/写频率门禁、对账清理、break-glass 审计与真实备份恢复演练。
- Competition：模式/规则、赛季 closing、run/submission/decision/result-set/participants、租约验证器、代际榜单与水位追赶。
- 跨域后台资源门禁及实时对局、存档、验证、构建、备份的混合负载验收。
- 宿主现有“暂停或恢复”按钮调用 PlayerCore.hide/resume，仅隐藏 iframe，游戏计时仍继续；需要单独明确隐藏/暂停语义。本次不宣称已验证真正暂停计时。
- 2048 确定性规则与回放验证、第二款不同结构存档游戏、迷阵权威终局适配；Web/Agent/Windows 跨端验收。
- 短期会话票据交换与 Agent/Windows 的受控本机凭据存储；目前复用已存在的宿主账号 bearer，不宣称原生票据流程完成。

已完成切片的自动化验证不能替代上述实际游戏与运营验收。
