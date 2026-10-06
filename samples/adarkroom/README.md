# A Dark Room：在线存档参考适配

本目录是 Cloud Save S1 的内部参考游戏。使用固定上游源码、正式 SDK/PlayerCore/通用宿主和 API/数据库实现；没有开启线上发布权限，也没有持久离线 outbox。

## 源码与构建

上游：[doublespeakgames/adarkroom](https://github.com/doublespeakgames/adarkroom/tree/1fada4620b6c66bd07bf15a3f1eb8223df8bc1d7)，提交 `1fada4620b6c66bd07bf15a3f1eb8223df8bc1d7`。页面版本 1.4，原引擎仍使用状态版本 1.3。137 个运行资源、中文翻译及许可原文保存在 `upstream/`；`upstream.lock.json` 逐文件记录 SHA-256。下载时另校验了 Git blob SHA-1。上游文件不做编辑，Git attributes 保留原始字节，构建时验证摘要并执行有锚点的补丁。

- 原游戏：MPL-2.0，见 `upstream/LICENSE.md`。
- 修改后的 Engine/StateManager 源码随包位于 `script/`，适配器源码位于 `source/`。完整可构建源码以本仓库为准，适配器依赖仓库内 SDK。
- 本地保留原音频，补齐平台 FLAC MIME 类型；移除外部统计和 Dropbox 接入。
- 保持 runtime CSP 和无同源权限的 iframe sandbox；不启用 JS unsafe-eval、外部网络或 localStorage。
- 首次读取成功后才初始化游戏，读取失败/不支持版本均禁止静默新建覆盖。
- 状态变更合并为每分钟一次保存，玩家可立即保存。只有服务端 ACK 才标记云端确认。
- 未确认写入保留正文、时间、CAS、幂等键，重试先确认原操作；新的游戏进度随后提交。
- 冲突展示双方摘要和导出码；明确选择保留本页或读取云端，更新仍需通过 CAS。
- 原生存档菜单可导出/导入；导入先验证格式、确认当前保存，再提交替换，ACK 后重载。重开沿用相同机制。
- 断网或关闭前未确认的数据仅在本页内存中；导出码是人工保留方式，不是自动离线保障。

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

尚待：正式安装版目录和真实身份流程验收、全程游玩样本、S2 持久本机缓存/outbox、S3 用户存档管理与 recovery、备份恢复/容量演练。线上 cloudSave 仍关闭。

## 安装包与真实身份验收环境

新增 `npm run start:adarkroom-installed-acceptance`，使用完整平台客户端、真实邮箱 OTP/令牌/设备授权、PostgreSQL 目录与 runtime 资源清单。邮件仅写入本机 mailbox，不调用外部邮箱/OAuth；只允许下面两个测试邮箱。数据库仍必须是 loopback、以 `_test` 结尾的专用库。

```powershell
docker run --detach --rm --name gamehub-adr-installed-test --publish 127.0.0.1:55439:5432 --env POSTGRES_USER=gamehub_test --env POSTGRES_PASSWORD=gamehub_local_test --env POSTGRES_DB=gamehub_installed_test postgres:16.10-alpine
docker run --detach --rm --name gamehub-adr-installed-redis --publish 127.0.0.1:55440:6379 redis:7.4-alpine
$env:GAMEHUB_ADR_DATABASE_URL = 'postgres://gamehub_test:gamehub_local_test@127.0.0.1:55439/gamehub_installed_test'
npm run start:adarkroom-installed-acceptance
```

API/网页为 http://127.0.0.1:3086 ，runtime 为 3092。不能与前一节的服务同时运行。生产目录仍不返回 cloudSave；只有此启动脚本为本次随机作品的启动描述注入能力，测试库中的 scope/policy 审批仍由真实游戏会话服务检查。不是线上发布审批验收。每次启动新建测试作品，重启脚本不会沿用上次作品的存档；不要在同一次续玩验收中重启服务。

脚本写入 `.runtime/adarkroom-installed/session.json`，含当前作品 ID、VSIX 路径及独立 Cursor 目录。保持服务运行，在另一终端执行：

```powershell
$adrSession = Get-Content .runtime/adarkroom-installed/session.json -Raw | ConvertFrom-Json
cursor --user-data-dir $adrSession.profilePath --extensions-dir $adrSession.extensionsPath --install-extension $adrSession.vsixPath --force
cursor --user-data-dir $adrSession.profilePath --extensions-dir $adrSession.extensionsPath --list-extensions --show-versions
cursor --user-data-dir $adrSession.profilePath --extensions-dir $adrSession.extensionsPath --new-window
```

使用真实 VSIX 安装，不带 `--extensionDevelopmentPath`。仅专用配置关闭扩展自动更新，避免测试时被线上旧包替换；日常 Cursor 配置与扩展目录不变。首次启动 Cursor 自身如需登录，由操作者完成；进入编辑器后运行命令 `GameHub: 打开游戏平台`。

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

2026-10-06 已通过上述五组验证，客户端 102 项通过；Web、Harness 与 VSIX 构建通过。本机 readiness 为 46/46、database/realtime 均正常。实际网页经邮箱登录、目录进入游戏、点火保存、刷新续玩通过。VSIX 0.3.23 已安装到独立目录；正式安装版 UI、SecretStorage 重启续用与双向游玩仍待完成，不能用 API 模拟宿主结果代替。

本轮另修复安装版连接本机 API 时误拒 HTTP runtime 的问题：仅当可信宿主的 API 为 loopback 且运行域配置为 localhost 时允许本机游戏。生产 HTTPS/release 主机校验和 iframe sandbox 保持原边界。

验收完成后先关闭游戏，再停止 Node 服务，最后停止这两个专用可丢弃容器：

```powershell
docker stop gamehub-adr-installed-test gamehub-adr-installed-redis
```
