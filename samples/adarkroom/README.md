> 当前默认构建为仅本机存档包 artifacts/adarkroom-local-save.zip，声明 localSave，不自动上传。下面云存档验收仅用于隔离测试，需 node scripts/build-adarkroom.mjs --cloud-test；生产更新说明见 docs/game-save-local-only-release.zh-CN.md。

# A Dark Room：云端与本机存档参考适配

本目录是 Cloud Save S1/S2 的内部参考游戏。使用固定上游源码、正式 SDK/PlayerCore/通用宿主和 API/数据库实现；没有开启线上发布权限。支持本机存储的宿主使用 S2 持久队列，旧宿主继续使用 S1 在线接口。

## 源码与构建

上游：[doublespeakgames/adarkroom](https://github.com/doublespeakgames/adarkroom/tree/1fada4620b6c66bd07bf15a3f1eb8223df8bc1d7)，提交 `1fada4620b6c66bd07bf15a3f1eb8223df8bc1d7`。页面版本 1.4，原引擎仍使用状态版本 1.3。137 个运行资源、中文翻译及许可原文保存在 `upstream/`；`upstream.lock.json` 逐文件记录 SHA-256。下载时另校验了 Git blob SHA-1。上游文件不做编辑，Git attributes 保留原始字节，构建时验证摘要并执行有锚点的补丁。

- 原游戏：MPL-2.0，见 `upstream/LICENSE.md`。
- 修改后的 Engine/StateManager 源码随包位于 `script/`，适配器源码位于 `source/`。完整可构建源码以本仓库为准，适配器依赖仓库内 SDK。
- 本地保留原音频，补齐平台 FLAC MIME 类型；移除外部统计和 Dropbox 接入。
- 保持 runtime CSP 和无同源权限的 iframe sandbox；不启用 JS unsafe-eval、外部网络或 localStorage。
- 首次读取成功后才初始化游戏，读取失败/不支持版本均禁止静默新建覆盖。
- S2 状态变更先提交本机事务，云同步按分钟合并；S1 状态仅在内存合并。玩家可立即保存，只有服务端 ACK 才标记云端确认。
- 未确认写入保留正文、时间、CAS、幂等键，重试先确认原操作；新的游戏进度随后提交。
- 冲突展示双方摘要和导出码；明确选择保留本页或读取云端，更新仍需通过 CAS。
- 原生存档菜单可导出/导入；导入先验证格式、确认当前保存，再提交替换，ACK 后重载。重开沿用相同机制。
- S2 已获本机确认的进度可在断网或页面重开后恢复；尚未本机提交的进度仍只在内存。S1 断网数据只在本页，导出码用于人工保留。

在已安装仓库依赖的根目录运行（Node.js 22）：

```powershell
pnpm install --frozen-lockfile
npm run build:adarkroom
npm run test:adarkroom
```

输出：`.runtime/adarkroom-web/` 和 `artifacts/adarkroom-cloud-save-internal.zip`。产物被忽略，不提交仓库。`platform.json` 声明 cloudSave；通用 ZIP 发布校验仍拒绝未开放能力，不能把本包直接作为已批准线上游戏。原布局需要横向空间，窄窗口保留横向滚动；保存栏和菜单避免覆盖游戏顶部和语言选项。

## 本机双端验收

只接受 loopback PostgreSQL URL，数据库名必须以 `_test` 结尾。脚本会应用迁移并插入专用测试用户/作品/审批，必须使用可丢弃数据库。示例凭据仅用于本机测试：

```powershell
docker run --detach --rm --name gamehub-adarkroom-test --publish 127.0.0.1:55439:5432 --env POSTGRES_USER=gamehub_test --env POSTGRES_PASSWORD=gamehub_local_test --env POSTGRES_DB=gamehub_services_test postgres:16.10-alpine
$env:GAMEHUB_ADR_DATABASE_URL = 'postgres://gamehub_test:gamehub_local_test@127.0.0.1:55439/gamehub_services_test'
npm run start:adarkroom-acceptance
```

浏览器打开 http://127.0.0.1:3086 。服务端口为 3086/3096，只监听本机；游戏从 `r-<release-id>.localhost:3096` 运行。修改资源后停止并重启验收服务，重新建立资源清单；不要在服务运行时一边修改文件一边判断加载错误。

同一仓库目录另开终端运行：

```powershell
cursor --new-window --disable-extensions --extensionDevelopmentPath "$PWD/.runtime/adarkroom-cursor-acceptance"
```

这会打开 Cursor 开发宿主和 A Dark Room Webview，**不安装扩展**。开发壳和浏览器复用正式 PlayerCore、host、SDK。它替代目录/登录入口，发放进程内的临时测试 bearer；不代表已验证真实账号登录、安装版 VSIX、目录审批或跨机器网络。临时禁用扩展只作用于这个开发窗口。

两个账号各有 web/cursor grant，运行同一个测试作品。为允许非作者的 B 账号正常游玩，测试库使用 `production` **协议频道**；这与线上数据库无关。`preview` 频道的作者限制保持原样。API/存档/权限/CAS 均使用真实实现，runtime edge 保留正式 CSP。测试账号切换即时关闭旧桥，旧请求不能转交新账号。

验收动作：

1. A 预置中期，保存后刷新，核对人口/建筑/物资；在 Cursor 重新打开，应读到同一进度。
2. Cursor 建造陷阱并保存，旧浏览器页保存应冲突；比较应看到本页 3、云端 4 个陷阱；选择云端后恢复为 4。
3. 切 B，应是空白新游戏；切回 A，应保留 A 的进度。
4. 预置通关前，保存、刷新、比较世界地图及飞船 hull=20/thrusters=4、score=98765；不应重新生成地图。
5. 原游戏“保存 → 导入”输入已导出的进度，确认云端提交后再重载。
6. 在独立数据库运行下面专项测试，验证提交后丢响应重试仅增加一次修订。

```powershell
$env:GAMEHUB_GAME_SAVE_DATABASE_URL = $env:GAMEHUB_ADR_DATABASE_URL
node --test tests/platform/game-saves-postgres.test.cjs
```

验收后先关闭页面和开发窗口，再停止 Node 服务，最后 `docker stop gamehub-adarkroom-test`。容器使用 --rm，会删除本次可丢弃数据库。

## 样本与证据（2026-10-06）

`fixtures/{new,mid,pre-ending}.json` 是人为构造的阶段起点；`fixtures/observed/` 是这些起点在真实浏览器中的原游戏引擎初始化/运行后，通过页面导出码采集的稳定回归快照。后期快照包含实际生成的 61×61 世界地图。**这些不是玩家从零完整通关录制的存档**，不能证明全剧情/全玩法已验收。

本次实际验证：

- Codex 内置 Chromium 浏览器和 Cursor 3.22.12 原生开发 Webview，独立 PostgreSQL 16.10。
- 中期网页 → Cursor，Cursor 建造后 → 浏览器冲突比较/选择云端，均通过。两端使用不同 grant。
- A/B 账号隔离、网页重载、通关前地图逐项一致与飞船/分数保留通过。
- 原生导入菜单、中文界面、可复制导出码通过检查。末尾的完整太空通关动画、音乐听感未做全程验收。
- 适配器 13 项测试通过：合并节流、不可变重试、晚 ACK、并发点击、CAS 冲突、墓碑、读取失败、导入确认、账号关闭、路径安全及六个样本往返。
- 全套回归：Legacy 74 通过/1 跳过、Platform 164 通过/7 跳过、Client 100 通过；合计 338 通过、8 跳过、0 失败。
- 真实 PostgreSQL 存档专项：12 个子测试及总套件通过（Node TAP 计数 13）；新增真实 adapter → SDK → MessageChannel → HTTP → PostgreSQL 的阶段快照和丢 ACK 重试。
- 后续界面布局/样本变更重新执行适配器专项；FLAC 通过 ZIP 校验测试。

正式安装版目录和真实身份的后续验收见下一节。尚待：全程游玩样本、S2 持久本机缓存/outbox、S3 用户存档管理与 recovery、备份恢复/容量演练。线上 cloudSave 仍关闭。

## 安装包与真实身份验收环境

新增 `npm run start:adarkroom-installed-acceptance`，使用完整平台客户端、真实邮箱 OTP/令牌/设备授权、PostgreSQL 目录与 runtime 资源清单。邮件仅写入本机 mailbox，不调用外部邮箱/OAuth；只允许下面两个测试邮箱。数据库仍必须是 loopback、以 `_test` 结尾的专用库。

```powershell
docker run --detach --rm --name gamehub-adr-installed-test --publish 127.0.0.1:55439:5432 --env POSTGRES_USER=gamehub_test --env POSTGRES_PASSWORD=gamehub_local_test --env POSTGRES_DB=gamehub_installed_test postgres:16.10-alpine
docker run --detach --rm --name gamehub-adr-installed-redis --publish 127.0.0.1:55440:6379 redis:7.4-alpine
$env:GAMEHUB_ADR_DATABASE_URL = 'postgres://gamehub_test:gamehub_local_test@127.0.0.1:55439/gamehub_installed_test'
npm run start:adarkroom-installed-acceptance
```

API/网页为 http://127.0.0.1:3086 ，runtime 为 3092。不能与前一节的服务同时运行。生产目录仍不返回 cloudSave；只有此启动脚本为本次随机作品的启动描述注入能力，测试库中的 scope/policy 审批仍由真实游戏会话服务检查。不是线上发布审批验收。同一测试库和 session.json 下重启会为当前测试作品发布一个新 release，保留作品级云存档；换新数据库时创建新作品。构建产物通过新的资源清单发布，不在运行中修改已发布资源。

脚本写入 `.runtime/adarkroom-installed/session.json`，含当前作品 ID、VSIX 路径及独立 Cursor 目录。保持服务运行，在另一终端执行：

```powershell
$adrSession = Get-Content .runtime/adarkroom-installed/session.json -Raw | ConvertFrom-Json
cursor --user-data-dir $adrSession.profilePath --extensions-dir $adrSession.extensionsPath --install-extension $adrSession.vsixPath --force
cursor --user-data-dir $adrSession.profilePath --extensions-dir $adrSession.extensionsPath --list-extensions --show-versions
cursor --user-data-dir $adrSession.profilePath --extensions-dir $adrSession.extensionsPath --new-window
```

使用真实 VSIX 安装，不带 `--extensionDevelopmentPath`。仅专用配置关闭扩展自动更新，避免测试时被线上旧包替换；日常 Cursor 配置与扩展目录不变。首次启动 Cursor 自身如需登录，由操作者完成。Cursor 3.23.23 可能先显示独立 Agents 窗口；点击右上角 `IDE` 进入标题为“GameHub ADR 安装版验收”的编辑器窗口，再运行命令 `GameHub: 打开游戏平台`。Agents 窗口不显示编辑器扩展侧栏。Cursor 自身登录与 GameHub 测试账号登录是两个独立步骤。

GameHub 测试账号是 `adr-a@gamehub.test`、`adr-b@gamehub.test`。在网页或扩展中选择邮箱登录，点击发送验证码，再从本机文件读取当次验证码：

```powershell
Get-Content .runtime/adarkroom-installed/mailbox.json
```

验证码十分钟有效，相同邮箱一分钟只能请求一次。这里只替代邮件投递，验证码校验、令牌刷新和设备撤销都走真实服务。不要把测试邮箱用于线上，也不要把 mailbox、Cursor profile 或 token 内容提交仓库。

真实身份的自动化复验（服务运行期间）：

```powershell
npm run verify:adarkroom-installed
```

该脚本使用独立槽位，不覆盖游戏 autosave；完成后删除测试槽并退出它创建的设备。可能等待一次真实 OTP 频控窗口。结果写入 `.runtime/adarkroom-installed/verification.json`，包括：

- 真实 OTP、目录与发布启动描述；
- 真实 SDK/MessageChannel/HTTP/PG 分片读写及 A/B 隔离；
- 访问令牌失效后的自动刷新不改变原 grant；
- 同账号不同设备接续、旧 ETag 冲突；
- 撤销设备后旧桥失败，另一设备正常。

2026-10-06 已通过上述五组验证，客户端 102 项通过；Web、Harness 与 VSIX 构建通过。本机 readiness 为 46/46、database/realtime 均正常。实际网页经邮箱登录、目录进入游戏、点火保存、刷新续玩通过。随后发布两个新 release，原作品 autosave 持续继承、修订递增；浅色/夜间模式及菜单均已截图复验。VSIX 0.3.23 已安装到独立目录；随后在 Cursor 3.23.23 的实际 IDE 窗口完成以下验证，使用真实安装包，未使用开发宿主：

- 操作者通过本机测试邮箱完成 GameHub 登录；账号页显示 Cursor SecretStorage，网页与 Cursor 是两个设备。
- 从正式侧栏目录进入 A Dark Room，读取网页已有进度；Cursor 建造第一个陷阱并保存后，云端修订为 19。
- 保留旧网页再保存，正确触发冲突；比较页显示本页陷阱 0、云端陷阱 1。选择云端后恢复为 1。
- 网页建造第二个陷阱，保存确认修订 21。关闭专用 Cursor 编辑器窗口，再以同一 profile/extensions 目录重开，无需再次登录即可读到 2 个陷阱。
- 重开前后仍为同一 Cursor 设备授权，没有新增登录；恢复后继续保存成功，实际观察到修订 24 的云端确认。

此处的重启验证覆盖编辑器窗口和扩展宿主重建；Cursor Agents 窗口保持开启，不等同于整台机器或所有 Cursor 进程重启。邮件仍只投递本地 mailbox；没有验证线上邮件、OAuth、跨机器网络、线上能力审批或完整通关。实际 UI 结果与前述自动化五组结果分别记录，不互相替代。

本轮另修复安装版连接本机 API 时误拒 HTTP runtime 的问题：仅当可信宿主的 API 为 loopback 且运行域配置为 localhost 时允许本机游戏。生产 HTTPS/release 主机校验和 iframe sandbox 保持原边界。完整客户端还暴露出原游戏透明背景导致深色平台上黑字不可读；适配层显式设置浅色底，原生夜间模式仍可覆盖。

验收完成后先关闭游戏，再停止 Node 服务，最后停止这两个专用可丢弃容器：

```powershell
docker stop gamehub-adr-installed-test gamehub-adr-installed-redis
```

## S2 本机持久化与离线恢复（2026-10-06）

已接入可信宿主的 IndexedDB（浏览器）和 SQLite WAL/FULL（编辑器扩展、Harness），使用独立的 cloudSave.local SDK 接口。旧在线接口的 ACK 语义不变。本机事务成功后才显示“已存本机”，云端确认单独显示；自动本机检查点约 750 ms，后台云同步按槽位一分钟节流，点击立即保存可以主动同步。

本轮证据与之前的 S1 安装版验收分别计算：

- 实际 Chromium + 原版游戏 + IndexedDB + API/PostgreSQL：中期陷阱 3 → 断网建造为 4 → 本机保存 → 关闭整个页签 → 断网重新打开，恢复 4 个陷阱及木头 329；恢复网络后云端确认修订 5。
- SQLite 实际终止子进程后重新打开，已提交正文仍可恢复。丢 ACK 后继续更新，旧操作先按原 key/body/base 重试，再提交最新 pending。
- 双连接本机 CAS、不同账号/作品/origin/channel 隔离、云冲突冻结及 recovery、显式匿名导入、配额失败、延迟读取竞态、已知撤销授权后的重开均有专项测试。
- 真实 SQLite → SDK → MessageChannel → API → PostgreSQL 的断网、丢响应、宿主重开测试通过；云端只生成两个预期修订。整个 PostgreSQL 专项 TAP 计数 14，通过且没有跳过。
- Cursor 自带 Node 24.18.1 可运行 SQLite；在该运行时执行了 outbox 与 SDK 桥测试，17 项全部通过。此项是运行时测试，不能替代新 S2 VSIX 的实际安装界面验收。
- 全套回归 359 通过、8 跳过、0 失败；宿主版本与打包变更后另有 24 项接入回归通过。候选 VSIX 0.3.24 / Harness 0.1.6 已重新构建，最终生产 Web Docker 镜像构建通过；版本递增用于避免自更新跳过新存储接口。生产 cloudSave 未开放。

浏览器复验入口：前述内部测试服务加查询参数 http://127.0.0.1:3086/?local=1 。测试工具栏提供“模拟断网/恢复网络”，只切断该游戏 API 请求；页面与游戏资源仍来自本机测试服务。关闭后使用 ?local=1&offline=1 可以验证已加载存档的离线恢复。这不代表无需网络即可安装、下载或从生产目录启动游戏。

匿名存档不会自动上传。完整平台宿主提供“查看本机匿名存档 → 确认导入此存档”，已有目标进度时另存恢复槽，原匿名副本保留。新 S2 安装版真实界面和匿名导入 UI 仍需专门验收；之前记录的 S1 安装版验收不覆盖这些新增路径。

边界与后续：同步器在已打开游戏的宿主中运行，不提供关闭应用后的后台同步；浏览器清理站点数据会删除本机副本；S3 的存档管理、历史与 recovery 导出/移除、备份恢复演练尚未完成。恢复副本满额时明确阻止继续解决冲突，不能悄悄淘汰正文。完整 Windows EXE 启动票据/SDK 接入不在本次网页游戏适配范围内。详见 packages/save-cache/README.md。


### 安装版 S2 与本机存档管理验收（2026-10-06）

本轮使用实际 Cursor 安装包 0.3.24 → 0.3.25、独立测试配置、真实 SecretStorage 登录、SQLite、HTTP API 与 PostgreSQL。本机测试库重建后，旧 refresh token 明确报错，未覆盖存档；手工完成邮箱登录后继续验收。

- 初始云端修订 1。通过脚本的 .runtime/adarkroom-installed/network-fault.json 设置 {"offline":true}，仅令本机游戏会话/存档接口返回 503；目录和游戏资源仍可用。实际点击生火，继续游戏后，本机落盘森林解锁、木头 4、火堆 value 3 与 builder level 1；界面明确显示已存本机、联网后重试。
- 关闭专用编辑器窗口，安装 0.3.25 后重开同一配置，在接口仍断线时恢复了森林、4 个木头和燃烧中的火堆，无需再次登录。另一个 Cursor Agents 窗口仍在运行，因此这是专用编辑器窗口/游戏宿主重建验收，不是所有 Cursor 进程退出或系统断电演练。
- 实际点击“存档管理 → 导出 / 使用此存档 → 用这份备份恢复 → 预览恢复 → 确认恢复并重新加载游戏”。本机持久化了 restore 收据和 before-restore 副本，游戏重载成功；原 in-flight operation UUID 跨窗口重开与恢复保持不变。
- 恢复网络后原队列上传确认，观察到修订 3，继续游戏后 UI 确认修订 5。数据库核对同一 autosave 后续修订 6、木头 50，说明新进度持续同步。
- 匿名导入 UI 使用从上述本机检查点准备的专用匿名 fixture（木头 4），不是从新匿名游戏游玩起步的测试。实际点击“查看匿名存档 → 确认导入”，另建 recovery-anon-* 槽，真实 PostgreSQL 确认其修订 1、木头 4；账号 autosave 木头 50 保留，原匿名副本仍在本机。
- 备份损坏、跨作品/区域/渠道导入、旧预览 CAS、账号切换、保留旧进度、丢 ACK 重试、恢复空间满额及精确副本移除均有自动回归。可信管理控制器通过实际 MessageChannel 接入验证；游戏 iframe 无权调用恢复、删除副本或匿名导入方法。副本移除本轮以自动测试验收，未通过安装版 UI 点击删除。
- 全套回归 365 通过、8 跳过、0 失败，契约生成检查通过。候选 VSIX 0.3.25 / Harness 0.1.7 与 Web 构建成功。安装界面中的导出文本已检查，原生文件下载对话框不计入已验收能力。

本机故障开关仅存在于专用安装版验收脚本，启动时默认恢复网络，不进入生产 runtime。截图证据：adr-installed-s2-offline.png、adr-installed-s2-reopened.png、adr-installed-s3-import.png（本次聊天的本地可视化目录）。生产 cloudSave 仍关闭；本轮提供 S3 本机用户管理入口，不能代替全账号云历史管理、运营治理、容量门禁及真实备份恢复演练。

补充验证：真实 PostgreSQL 存档事务专项在另一独立测试库执行，14 项全部通过、0 跳过；覆盖 SQLite → SDK → MessageChannel → HTTP → PostgreSQL 的断线、丢 ACK 与重开。

### S3 云端历史与恢复演练验收（2026-10-06）

VSIX 0.3.26 / Harness 0.1.8 增加个人设置中的“管理云端存档”。本轮实际 Cursor 安装版沿用 ADR Test A 登录，列出 autosave 和匿名导入恢复槽；导出 autosave #32 校验成功，预览 #31 后确认恢复得到 #33。数据库验证 source_kind=restore、restored_from_revision 指向 #31，正文 SHA-256 相同，回执与用户事件均存在。另一槽仍是 #1。截图为本机可视化目录中的 adr-cloud-history-restored.jpg；现场数据库核验记录保留在 .runtime/adarkroom-installed/cloud-library-acceptance.json。

恢复演练命令（在本仓库根目录执行，连接已有的专用本地测试容器）：

```powershell
$env:GAMEHUB_GAME_SAVE_DATABASE_URL = 'postgres://gamehub_test:gamehub_local_test@127.0.0.1:55439/gamehub_installed_test'
$env:GAMEHUB_REHEARSAL_CONTAINER = 'gamehub-adr-s2-installed-test'
node scripts/rehearse-save-database-restore.mjs
```

脚本只接受 loopback 的 gamehub_*_test 数据库和 gamehub-*-test 容器，并核对端口映射。每次创建独立随机测试库，绝不清理或覆盖已有库；备份、SHA256SUMS 和只含统计/摘要的 report.json 保留在 .runtime/restore-rehearsals/<时间戳>/。这些备份含测试账号资料，不能提交仓库。测试容器与恢复库保留供复核，后续由操作者按具体名字清理。

最终验收源库 gamehub_installed_test → gamehub_restore_20261006151544635_7c3b44_test，77 张表摘要一致，六类存档不变量异常均为零；从已落盘备份文件恢复约 44.7 秒。备份 SHA-256：6a069bb48ff07510ae622a9fa28459007bb12ecec7402003db497c1885400669。这是本机数据库恢复演练，不包含 avatars/covers/runtime-assets 卷、不覆盖生产恢复、异地备份或生产容量目标。


### S3 运营与容量回归（2026-10-06）

候选 VSIX 0.3.27 / Harness 0.1.9 增加创作者存档健康页与管理员存档运营页。本轮浏览器验收使用回归库中的临时测试管理员，实际点击 namespace 暂停、恢复和用量检查；生产不受影响，测试完成后撤销临时 grant。截图：save-operations-verified.png（本次聊天的本地可视化目录）。未重新安装这两个候选包；原 ADR 安装版会话、登录及存档保持原状。

专项回归：

```powershell
$env:GAMEHUB_GAME_SAVE_DATABASE_URL = 'postgres://gamehub_test:gamehub_local_test@127.0.0.1:55439/gamehub_s3_regression_test'
node --test tests/platform/game-saves-postgres.test.cjs
node --test tests/platform/save-operations.test.cjs
```

真实 PG 专项 26 通过，HTTP/采样/API 客户端边界 3 通过；完整回归 371 通过、8 跳过。容量关停时读取、导出、删除与成功回执仍可用；并发写入总量计数、对账修复、清理不删当前正文及版本事实、异常摘要只报警都有验收。生产 cloudSave 继续关闭，逻辑正文门限不等于实际 PG 数据盘剩余空间保护。

同一恢复脚本在 0048 后再次验收回归库：80 张表指纹一致，七项异常为零（包含容量计数与实际正文总字节相等）。恢复库 gamehub_restore_20261006155337628_172278_test，备份 3576792 字节，恢复 34.056 秒，SHA-256 为 aca8583f621a608e013169a146ed4ee78a2f525e5b1ce43ef2f4463e8adaad22。备份和完整报告仍在忽略目录 .runtime/restore-rehearsals/20261006155337628_172278/，不提交仓库。


### 2026-10-07：周期维护、PG 磁盘保护验收

隔离工作树 game-services 新增迁移 0049；完整回归 372 通过、8 跳过，专用 PG 28 通过。测试容器 gamehub-save-storage-test 仅绑定 127.0.0.1:55439，最终源库 gamehub_storage_v2_test。原 ADR 临时容器在本轮开始时已不存在；本轮没有重建用户安装版登录或把新候选包装进 Cursor。

磁盘保护使用真实只读 PGDATA 探针，验证正确卷采样、错误集群拒绝；过期采样和磁盘/WAL/inode 门限由受控测试注入。并发写入不能重复消费同一磁盘余量；已有回执、本人导出和删除仍通过准入。周期维护验证忙时让出、异常退避、清理超时回滚、摘要损坏保留，以及提交成功但响应丢失时不重复记审计。

本地运营页显示 PROBE_STALE 后恢复 OK，维护 CLI 心跳及成功批次可见。候选 Web / VSIX 0.3.28 / Harness 0.1.10 构建通过；Cursor/Harness 安装交互验收未重复。真实探针、服务进程和临时 UI 管理员在验收后关闭/撤销；保留独立测试数据库及备份供复查。

复验命令使用独立数据库：
- GAMEHUB_GAME_SAVE_DATABASE_URL 指向上述 loopback 测试库，执行 node --test tests/platform/game-saves-postgres.test.cjs。
- 普通测试：npm test；契约：npm run contracts:check。
- 磁盘探针：以 postgres:16.10-alpine / postgres 用户、只读根文件系统和数据卷运行 deploy/save-storage-probe.sh --once；数据库必须与被挂载 PGDATA 属于同一集群，不可对生产随意复用测试注入。
- 维护进程：DATABASE_URL 指向测试库，node apps/api/src/save-maintenance-worker-cli.mjs；--health 仅检查心跳。
- 备份恢复：GAMEHUB_REHEARSAL_CONTAINER=gamehub-save-storage-test，执行 node scripts/rehearse-save-database-restore.mjs；始终恢复至随机命名新库。

日志保留于隔离工作树 .runtime/save-storage-{all,pg-final,unit,web,vsix,harness,probe-wrong,restore}.log，截图为 save-storage-maintenance-verified.png。生产 cloudSave 未开放，仍需设计文档所列混合负载、治理和生产备份验收。

0049 后落盘备份恢复至 gamehub_restore_20261007125006698_a15d76_test：83 张表指纹一致，7 项异常计数均为 0；备份 1314803 字节，restore 35078 ms。SHA-256：1432b6d81319c2f528a257960555365fbdbacf98cdac8ae68e075b7c031953c0。仅代表本机小型回归库，不能推导生产 RTO。


### S3 混合负载门禁（2026-10-07）

新增独立 Compose、固定节拍压测、Realtime 事件循环指标及恢复核对，使用真实签名迷阵、16 个存档账号、4 场权威对局与并发 pg_dump。CPU 配额合计 2 核，内存上限合计 1568 MiB；宿主本身是 20 核，不能视为等价生产机器。

完整复测未通过延迟门槛：默认备份期间读取/对局 ACK P99 为 723.1/768.1 ms，超过预声明的 500 ms；停止后台任务后回落。关闭压缩对照也失败，并有 11 次调度漏发。497 份存档成功回执、709 个对局动作与源库精确匹配，第一份备份开始前已确认的操作全部在恢复库，源库/恢复库 7 项异常均为 0。完整回归 375 通过、8 跳过，合同校验通过。

实现与实测证据见 [混合负载验收记录](../../docs/game-save-mixed-load-acceptance.zh-CN.md)。生产 cloudSave 继续关闭，无新迁移、无生产部署。备份资源隔离和共享后台任务准入仍是明确阻塞；真实竞赛 verifier、构建任务及生产异地恢复尚未覆盖。
