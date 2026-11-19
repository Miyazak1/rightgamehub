# 小墨鱼 QQ 文字问答：本地验证版

## 范围

独立应用 `apps/qq-channel`，不进入网站 API 启动、线上 Compose 或统一发布流程。默认关闭。只允许一个专用 QQ 号、一个测试群、明确列出的测试用户；必须收到结构化的 @自身消息段，且仅包含文字及 @。不接收私聊、图片、文件、语音、普通未 @ 群消息，不根据群主头衔授予网站权限。

模型仅能返回文字，没有工具接口。不能发布文章、修改网站、读取其他用户数据或执行本地命令。论文继续关闭。人格默认复用现有小墨鱼的核心配置定义，也可在私有配置中提供运营者审阅的 core 快照；不读取或迁移网站的私有历史记忆。

参考 DotCraft 的通道分层、结构化 @、反向 WebSocket 和显式白名单，自行实现存储、预算及恢复。没有复制 DotCraft 源码。参考固定提交：`d2cfa5910af05bcd012d2901b141ace7e8d8dec2`。

- QQ 说明：https://www.dotcraft.net/guide/channels/qq
- 适配器：https://github.com/DotHarness/dotcraft/tree/d2cfa5910af05bcd012d2901b141ace7e8d8dec2/sdk/typescript/packages/channel-qq

## 分步准备

1. 用手机 QQ 登录专用账号，确认正常收发。
2. 建立只有运营者和专用账号的测试群，确认手动发消息。
3. 安装原作者发布的 QQ 网关。DotCraft 使用 NapCat 或兼容 OneBot v11 的网关。调研时 NapCat 原仓库已不提供发行包；LLBot v8.3.2 原作者发行版明确支持 OneBot 11，可作为互通验证对象。必须完成真实收发验证后才认定兼容，不使用来历不明的网关镜像或一键脚本。
4. 配置本地 PostgreSQL 和私有配置，启动本应用。
5. 网关配置反向 WebSocket：`ws://127.0.0.1:6700/onebot/v11`，消息格式 `array`。Access Token 必须与本应用相同，网关需要发送标准 `X-Self-ID` 和 `Authorization: Bearer ...` 握手头。首版监听仅绑定本机回环地址；不支持从远端或默认桥接容器直连。
6. 白名单用户在测试群 @小墨鱼提问，确认回复原消息。跨群、非白名单、未 @、图片消息应被忽略。

QQ群是第三方账号协议接入，登录和账号状态仍取决于网关及 QQ；本应用不能保证账号不会掉线。网关 WebUI Token 与 OneBot Access Token 是不同用途的凭据，均不应发到聊天或日志中。

## 私有配置与启动

把 `apps/qq-channel/config.example.json` 复制到 `.runtime/qq-local/config.json`，填写真实的 `botId`、`groupId` 和 `allowedUsers`（全部使用字符串），联调时设置 `enabled:true`。其余字段有严格上限，未知字段拒绝启动。`allowedUsers` 不能为空，群内成员也必须在用户白名单中。

复制 `.env.example` 到同目录的 `.env`，在本机填写模型密钥、OneBot 随机令牌和独立数据库连接。数据库必须在 `127.0.0.1` / `localhost` / `::1`，名字必须以 `mooyu_qq_local_` 开头。拒绝 `gamehub`、`postgres` 和远程数据库。不要复用生产配置或把 .env 提交 Git。

Node.js 22 或更新版本，安装仓库锁定依赖后运行（以下为 PowerShell，项目根目录）：

```powershell
node --env-file=.runtime/qq-local/.env apps/qq-channel/src/cli.mjs .runtime/qq-local/config.json --init
node --env-file=.runtime/qq-local/.env apps/qq-channel/src/cli.mjs .runtime/qq-local/config.json --status
node --env-file=.runtime/qq-local/.env apps/qq-channel/src/cli.mjs .runtime/qq-local/config.json --run
```

`--init` 是本应用独立数据库内的显式初始化/配置确认。它创建 `mooyu_qq` 命名空间，写入策略摘要及审计，不删除已有消息或历史。策略修改后须先停止 worker，再重新执行 `--init`；不会自动迁移或修改网站的 migration inventory。

日志仅包含状态、消息编号和错误码；不打印正文、QQ Token、模型密钥或数据库 URL。运行时可通过本机 `http://127.0.0.1:6700/health` 查看网关连接状态。没有模型密钥时不会生成模拟回答。

## 配额、上下文和恢复

- 上海时间每天默认最多 20 次模型调用、100000 个预留 token，每用户最多 10 次。每用户每分钟最多接纳 3 条、群每分钟 10 条，最多 50 个未完成任务。每日消息接纳量另限制为调用额度的两倍（默认全群 40 条、每人 20 条），避免预算用完后仍无限发送提示消息；重复投递不重复计数。
- 每次调用前，数据库事务按完整输入的 UTF-8 字节数加上额外协议余量及输出上限预留 token；这是一种保守的调用/token 预算，不是人民币账单。预留不自动退回；中断及结果未知的调用也计入，防止重启绕过预算。若回执中的实际 token 更大则上调账本。
- 默认每条消息最多两次模型尝试，每次输出最多 512 token、等待 30 秒；失败不会无限调用。只自动重试标记为暂时失败的模型调用。到达预算或尝试上限时发送明确的未生成提示。
- 会话按测试群和 QQ 用户隔离，只使用该用户最近三条已送达对话；不混用其他用户或网站后台记忆。预算/错误提示不作为成功问答带入模型。
- 入站唯一键是“账号＋群＋消息 ID”。重复投递复用任务，ID 相同但正文不同会记冲突，不再调用模型。
- worker 用数据库会话锁互斥，任务状态持久化，更新含执行令牌。未发出的任务与已保存回答会在重启后继续；模型调用中断时按预算和尝试上限恢复。
- 发送意图先提交数据库，再请求 OneBot。已确认的发送保存远端消息 ID；尚未发出的失败可稍后继续。若请求可能已发送但回执丢失，或进程在发送阶段退出，则进入 `needs-review`。不盲目重发，也不阻塞其他消息。
- 从白名单移除的用户，其排队任务终止并留审计，不堵塞其他用户。数据库暂时故障进入等待，恢复后继续，不依赖反复重启。
- 网关入站协议没有本应用的持久化确认/重放保证。**恢复承诺从消息成功写入本地数据库开始**；数据库故障期间尚未保存的 QQ 消息不能宣称必然恢复，需要用户稍后重新 @。

## 人工核对不确定发送

先停止 worker，用 `--status` 取得待核对消息编号，再在真实 QQ 群中确认。已经发出时提供远端消息 ID；确认未发出时才允许重新排队。两种操作都保留审计。

```powershell
node --env-file=.runtime/qq-local/.env apps/qq-channel/src/cli.mjs .runtime/qq-local/config.json --resolve MESSAGE_ID --sent REMOTE_MESSAGE_ID
node --env-file=.runtime/qq-local/.env apps/qq-channel/src/cli.mjs .runtime/qq-local/config.json --resolve MESSAGE_ID --not-sent
```

不要两条都执行。首次联调时逐步核对，无需现在填写这些命令。

## 测试边界

`tests/platform/qq-channel.test.mjs` 覆盖配置、真实 @、白名单、模型输出边界和实际本机 WebSocket。

`tests/platform/agent-qq-channel-db.test.cjs` 在一次性 PostgreSQL 中覆盖持久去重、预算、用户隔离、网关离线、模型失败、真实子进程退出、数据库连接终止、发送结果不确定和白名单变更。

真实 QQ 网关/账号登录、真实群收发及实际模型验证必须单独完成，不能用本地网关夹具宣称已通过 QQ 联调。当前阶段不合并、不推送发布分支、不提供线上执行命令。

2026-11-19 本地结果：全量 378 个测试文件，1646 项通过、0 失败、103 项条件跳过，报告 `.runtime/qq-full/result.json`；QQ 真实 PostgreSQL 故障矩阵单独执行 16 项全部通过，日志 `.runtime/public-resilience-db-bNbywS/agent-qq-channel-db.test.cjs.log`；配置/模型契约及真实本机 WebSocket 4 项通过，日志 `.runtime/qq-unit.log`。现有契约生成检查通过。模型响应使用明确的隔离测试夹具，尚未宣称真实 QQ 或实际模型验收通过。
