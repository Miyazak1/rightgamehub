# 服务器只读预检：接入与采集范围

2026-11-22。分支 `codex/agent-server-preflight`，基线为发布准备提交 `926c5101`。已收到操作者在服务器执行只读命令的两批截图；以下结论仅覆盖截图显示的字段，其余检查仍待完成。

## 当前接入状态

没有直接服务器连接，采用操作者执行只读命令并返回输出的方式。原始截图为 `codex-clipboard-b0a77903-fd59-422d-850f-6d26625ced6e.png` 与 `codex-clipboard-c9c2b879-abfb-499b-a017-46768cfc4c0d.png`，位于 `E:\CodexData\temp`。无需发送密码、验证码或私钥。

## 已取得的现场证据

- Compose v5.5.1；服务器 Git 分支 `codex/agent-blog-draft-mvp-next`，提交 `9f98c06f8be98f990724a3b7427d9dd93ffc7e5a`。唯一显示的工作树变更是未跟踪目录 `deploy/qq/__pycache__/`，保留不清理。
- API 镜像 `sha256:c8243f37ac13b05c4417d7816241cf5997e7fa5be2f917ec65346ba035fd6a96`；Web 镜像 `sha256:7fbb48835dc0e46cabd7d4ed6ea8211fadf4fb35e0d15d8ae8dd64e8c0bfbf59`；QQ worker 镜像 `sha256:346abcd2cac94d98212aed8b7a844dd2f411a2c229de582e3e2d31007519411e`。与已准备发布包的兼容旧基线相符，仍须核对挂载是否覆盖镜像代码。
- 通用 `gamehub-production-worker-1` 实际执行 `apps/api/src/validation-worker-cli.mjs`，不能将它视为共享 Agent 交互执行器。目前检查范围内未确认共享执行器。
- 定时文章容器执行 `apps/api/src/agent-blog-public-schedule-worker-cli.mjs`，`AGENT_BLOG_PUBLIC_SCHEDULE_ENABLED=true`；API 也有此标志。保留该状态，具体数据库计划、预算及未完成任务仍待核对。
- **论文关闭要求与现场存在差异**：独立论文容器执行 `apps/api/src/agent-paper-research-worker-cli.mjs`，`AGENT_PAPER_RESEARCH_WORKER_ENABLED=true`。此容器的四个 `PAPER_STUDY_*` 及 `AGENT_PAPER_SEMANTIC_ENABLED` 未设置；API、QQ worker 的四个 `PAPER_STUDY_*` 为 false 并不能替代独立容器的开关。尚未检查是否有在途论文任务，不据此断言已发生论文研究或模型调用。作为升级阻断项记录，本轮未停止容器、修改开关或数据。
- 尚未取得完整 Compose 链、网络/登录卷、Agent 与密钥引用一致性、数据库状态、备份有效性；未执行线上变更。

### 第三批：Compose、持久卷与网络

操作者截图 `E:\CodexData\temp\codex-clipboard-aace2bdc-737f-40ed-b45c-ed223983b134.png` 已显示 API、QQ worker 和网关的原始有序 Compose 链。后续命令必须按各自链执行，不可仅用基础 compose 文件；最终 site/qq 覆盖来自 `/www/backup/gamehub/qq-compatible-55b2f7e8/cutover-20261120T080032Z-088f12/`。完整文件路径以原截图为证据，尚待逐文件存在性/指纹/解析核对。

- API Compose 工作目录 `/www/gamehub/deploy`；QQ worker 与网关工作目录 `/www/mooyu-qq`。worker 与网关显示同一配置链。
- **当前登录卷**：`mooyu-qq-compatible-55b2f7e8-088f12`，挂载到网关 `/data`，来源 `/var/lib/docker/volumes/mooyu-qq-compatible-55b2f7e8-088f12/_data`，可写。旧资料中的 `mooyu-qq_qq-napcat-fresh` 不是本次现场当前登录卷，不可据此替换。
- API 与 QQ worker 共享网络 `mooyu-qq-admin-control`，API 别名 `api`，worker 别名包含 `qq-control`。网关在 `mooyu-qq_default`，别名 `napcat`；worker 同时接入该网络。
- API 与 QQ worker 均只读挂载 `/www/mooyu-qq/admin/shared.secret` 到 `/run/secrets/qq-admin-shared`。只确认挂载引用相同，未读取密钥，也未核对应用实际使用该引用。
- API 保留现有头像、社区媒体/处理器、封面、隔离、运行资产、校验器持久卷；`/www/gamehub/rules` 只读绑定到 `/app/rules`。截图未显示覆盖 API 应用代码的挂载。
- QQ worker 与网关均只读绑定 `/www/mooyu-qq/config.json` 到 `/config/config.json`。未读取其内容。
- 数据库、授权/预算/计划、未完成任务与投递、现有备份有效性仍待核对。论文开关差异仍为阻断项，未执行线上变更。

### 第四批：网站数据库版本与运行状态

操作者截图 `E:\CodexData\temp\codex-clipboard-d05ace2d-8f22-4956-b0e9-4d783f4aed6c.png`：数据库 `gamehub`，事务 `read_only=on`；迁移数 163，最新 `0163`。尚未采集各迁移 checksum，不能仅以数量判定目录完全相同。

- `agent_runs`：failed 20、succeeded 33。
- `agent_blog_runs`：failed 1、published 7。
- `agent_schedule_fires`：failed 8、succeeded 8。
- `agent_interactions` 不存在；结合当前 API 旧基线，后续应准备首次接入共享执行器的方案，不能直接按已有插件版滚动升级。
- 上述三张状态汇总表在该事务快照内没有排队或执行中记录；不等于 QQ 待投递、运行 outbox、预算占用或论文独立队列已空闲，切换前仍需重新检查。
- 已列出论文研究执行/队列及旧 paper_study 表名，尚未读取其状态统计。历史失败记录保留，不重试、不删除。

### 第五批：Agent、计划、授权与论文队列

证据截图 `E:\CodexData\temp\codex-clipboard-657ef981-9142-43f1-8d8f-bfc93428f481.png`。

- 现有 Agent `c98abda1-d115-4e05-9c2e-43f68119386a`，status active，旧账户 capabilities 为 `blog:auto-publish`。新接入必须绑定此既有 Agent，不能用本地测试 Agent 替换。
- `agent_schedules` 有启用的 `blog.project.discovery-shadow`，Asia/Shanghai 每日 10:00，截图 next_fire_at 为 `2026-11-23T02:00:00Z`；未暂停。旧 `agent_blog_automation_settings.enabled=false`、interval_hours 24、monthly_article_limit 31、next_run_at null。这是两套不同机制，不能将旧设置的 false 当作所有定时计划关闭，也不能顺手启用旧自动化。
- 已存在 GitHub 发现/读取、文章草稿/发布、文本生成及论文读取/分析/追问等 active 能力授权；保持原授权及其范围。授权存在不等于相应功能已启用。
- 当前策略版本 1，policy_sha256 `330c84396cbcb952012faad675843a05156878896e2eba955e6a9a78833ba110`，所查询的 `policy_json.budgets` 为 null，尚未确认完整预算约束，不能推断无预算或将本地验收策略套到线上。
- 预算结算汇总只有 settled：59 条、charged_provider_calls 59、charged_output_tokens 175000、charged_cost_microusd 3215000；该快照中未显示 reserved 或 uncertain 占用。累计用量保留。
- 论文执行记录 cancelled 1、failed 4、succeeded 1；研究队列仅 completed 1；`paper_study_tasks` 无记录。该快照未显示论文待执行项，但独立论文 worker 的启用开关仍是关闭要求的差异，不能因当前队列空闲就忽略。
- QQ 待投递/图片状态、预算真实字段、配置引用及备份检查仍待完成。本轮未触发研究、发送消息或线上写入。

### 第六批：QQ 消息与设置保留指纹

证据截图 `E:\CodexData\temp\codex-clipboard-a4af8a4a-ee0b-46d2-a3fa-b594280d3d22.png`。QQ 数据库 `mooyu_qq_local_server`，事务 `read_only=on`。

- `mooyu_qq.messages` 只有 delivered 10；此快照无 queued/generating/ready/sending/needs-review/failed 消息。切换前仍须复查，不能把本轮结果当作永久空闲保证。
- 频道 `3922489710:905757031` 的 settings 行 MD5 为 `8d798a632ecbd2aea9f5a26170d32b78`；control_settings 行 MD5 为 `78926d94a1294219eb0a8f693de27b3a`。仅作为保留状态比较指纹，未读取或输出控制口令/策略正文。
- `mooyu_qq.agent_links`、`agent_deliveries`、`agent_image_pages` 均不存在；符合旧版未安装共享交互/文章图片投递表的状态，不将缺表误判为消息丢失。
- 登录卷仍以第三批现场结果为准。未读取登录文件、发消息、刷新二维码或创建新会话。

### 第七批：Compose 文件指纹与备份候选

证据截图 `E:\CodexData\temp\codex-clipboard-d9016eaa-02ac-41e4-a441-068ac013ae90.png`。所有采集到的有序 Compose 引用均 exists=true，文件 SHA256 已在截图输出；API、Web、定时文章与论文 worker 的公共链及各自最后覆盖层均有据。尚未验证 Compose 合并结果、隐式/显式 env_file 或应用密钥绑定。

- QQ 最近两份候选均在 `/www/backup/gamehub/qq-database/`，截图 UTC 修改时间分别为 2026-11-21 20:21:04、20:20:11，大小 8269、8266 字节，附 SHA256 文件。历史切换目录另有未压缩 `qq-before.sql`。当前只确认文件存在，未确认内容可恢复或覆盖当前 10 条消息。
- 网站库候选 `/www/backup/gamehub/unified-20261119T032844Z/database.dump`，大小 6173022 字节，UTC 修改时间 2026-11-19 03:30:20；未发现相邻 SHA256 文件。需要只读识别备份目录，并确认其库/表覆盖；不能凭文件名断言有效。
- 扫描输出的 `rollback-build/migrations/*.sql` 是迁移源码，不是数据库数据备份，必须排除。
- 旧备份不能当作未来切换时的新鲜备份。正式升级前仍需另行获得变更授权并生成/校验当时的两库备份；本轮不创建备份或执行恢复。

### 第八批：已有备份初步校验

证据截图 `E:\CodexData\temp\codex-clipboard-eb7ad277-ccfd-4411-9934-41e753fca2f7.png`。

- 最新 QQ 压缩备份 `qq-20261121T202103Z-3476750.sql.gz`：SHA256 文件检查通过，gzip 完整性通过；未恢复到数据库，未确认包含当前全部 10 条消息。
- 网站 `unified-20261119T032844Z/database.dump`：现算 SHA256 已输出在截图，但没有历史校验值可比较。通过现有 Postgres 容器执行 `pg_restore --list` 可识别；目录含 `schema_migrations`、`agent_accounts`、`agent_schedules`、`agent_capability_grants`、`agent_budget_reservations` 表。
- 网站检查仅验证备份目录可读及列出相关表，不证明数据段全部可解码、恢复成功或包含最新状态。没有创建临时库、写入数据库或执行恢复。正式升级仍需新鲜双库备份及部署前空闲复查。

### 第九批：身份与凭据一致性

成功输出证据 `E:\CodexData\temp\codex-clipboard-a9cbeea0-da55-41d3-bd61-406d02978c96.png`。另一个截图 `codex-clipboard-9ea183f0-e3c2-4018-8139-fd84c29638a4.png` 是误执行多余错误示例后的 Node 语法错误：未运行检查主体，不作为服务故障证据。

- API 的公开文章运行身份、QQ 管理身份、独立定时文章运行身份、QQ worker 管理身份均为既有 Agent `c98abda1-d115-4e05-9c2e-43f68119386a`；新共享身份应继续绑定此值。
- API 与定时文章容器均有非空 `AGENT_SECRET_ENCRYPTION_KEY`，非空值集合大小为 1；`AGENT_GITHUB_RESEARCH_TOKEN` 同样均存在且集合大小为 1。只在诊断进程内比较，没有输出值或密钥指纹。
- QQ worker 未持有上述主密钥或 GitHub token，应继续通过 API 调用能力，不能为便利把凭据复制到 QQ worker。
- API 与定时文章的 `AGENT_BLOG_PUBLIC_RUNTIME_ENABLED=true`；API 与 QQ worker 的 `QQ_ADMIN_ENABLED=true`；三个容器均未设置共享交互开关，符合首次安装路径。
- 完整 Compose 链虽然文件齐全，但尚未比较解析环境与运行环境；不猜测隐式 `.env` 或 `--env-file` 参数。预算默认值也不能只按本地源码推定线上实际值。

### 第十批：原 Compose 重解析

证据截图 `E:\CodexData\temp\codex-clipboard-75e45b5e-828f-41bc-96f5-37ccd7f0cfdc.png`。

- API、Web 与定时文章容器标签明确指定 `--env-file /www/gamehub/deploy/.env.prod`。按各自完整原文件链、项目名和目录执行 `docker compose config --format json` 均失败；原始错误因可能包含凭据而未输出，目前原因未知。文件全部存在不等于配置可重建，**不得执行网站 up/recreate**，不能猜测参数或删除旧覆盖文件绕过。
- QQ worker 明确指定 `--env-file /www/mooyu-qq/.env`。完整链解析成功，解析镜像与当前实际镜像相同，渲染环境叠加镜像默认环境与当前 Config.Env 完全一致，差异字段为空。
- QQ worker 未设置公开文章的四项数字限制（DAILY_RUN_LIMIT、MONTHLY_PROVIDER_CALL_LIMIT、MONTHLY_COST_MICROUSD_LIMIT、FAILURE_THRESHOLD），这符合职责分离，不能用来推断 API/调度角色的额度。网站角色在前置解析失败后未输出其数字配置，仍待采集。

### 第十一批：网站 Compose 解析失败原因

证据截图 `E:\CodexData\temp\codex-clipboard-9697e240-482f-479f-b5c2-cfd61edf8844.png`。显式环境文件 `/www/gamehub/deploy/.env.prod` 存在；普通 config 退出码 1，required variable 涉及 `AGENT_DOWNLOADS_DIR`、`DESKTOP_DOWNLOADS_DIR`，字段为 Web volumes；加 `--no-interpolate` 的 config 退出码 0。

当前已定位到缺少必填下载目录插值变量，不证明其他配置项已经一致。下一步应根据未展开配置的 Web 绑定目标，与当前 Web 实际绑定源逐项反推这两个目录；只在诊断子进程环境临时提供，不编辑 `.env.prod` 或 Compose 文件，不猜默认路径。若挂载映射不唯一或还有未知插值，停止并保留现场。此前部署是否依赖临时 shell 环境尚未确认。

第十二批截图 `E:\CodexData\temp\codex-clipboard-6cce9ee2-791a-42b4-867f-bcaa5ead4bc2.png`：自动目录映射脚本以“两项目录未能唯一对应，未继续解析”退出。该脚本仅匹配 source 以单一目录变量开头的模板，尚未取得实际模板文本；可能是模板格式未覆盖或目标映射不满足条件，不能将其等同于挂载损坏。未执行带临时变量的后续解析，没有线上修改。下一步仅输出 Web 的相关绑定模板、目标及当前 bind 源路径进行人工核对。

第十三批截图 `E:\CodexData\temp\codex-clipboard-4155b59a-a3d4-48da-9958-0b7bc8502144.png`：未展开的 source 被 Compose 加上 `/www/gamehub/deploy/` 前缀，随后才是 `${DESKTOP_DOWNLOADS_DIR:?...}` / `${AGENT_DOWNLOADS_DIR:?...}`，解释了上一版锚定开头正则不匹配。

- 当前 `/srv/agent-downloads` 的 bind 源为 `/www/gamehub-downloads/agent`，只读。
- 当前 `/srv/desktop-downloads` 的 bind 源为 `/www/gamehub-downloads/desktop`，只读。
- 后续诊断仅对子进程临时设置上述绝对源路径为对应变量，并检查渲染后的绑定与现场一致；不能把未展开模型的项目目录前缀直接拼到这些绝对路径，也不编辑线上环境文件。完整重解析对齐仍待验证。

### 第十四批：网站重建参数对齐成功

证据截图 `E:\CodexData\temp\codex-clipboard-884bd0fc-95df-4bbb-a5fb-7029118c5c5d.png`。仅在诊断子进程临时提供已核实的两个下载目录后，API、Web、独立定时文章服务的完整原 Compose 链全部解析成功；每个角色的镜像、完整环境、bind 挂载都与当前容器一致，环境差异字段为空。此结论不包含命名卷/网络的全部声明一致性，也不证明已具备升级空闲窗口。

- API 与定时文章实际环境相同：DAILY_RUN_LIMIT=1、MONTHLY_PROVIDER_CALL_LIMIT=120、MONTHLY_COST_MICROUSD_LIMIT=10000000、FAILURE_THRESHOLD=2；Web 未设置这些变量。费用单位为微美元，10000000 即 10 美元。保留额度，不复用本地临时验收的额度。
- 网站原命令需显式使用 `.env.prod` 与上述两个下载目录进程变量；QQ 使用 `.env`。不能遗漏这些参数或更改原文件以简化命令。
- 已完成此前配置解析失败的定位与只读对齐；尚需迁移 checksum、完整执行角色/事件与租约、调度回退兼容性、新鲜备份及变更授权。论文 worker 开关差异仍未改变。

### 第十五批：迁移 checksum 与运行尾项

证据截图 `E:\CodexData\temp\codex-clipboard-22d656bb-0000-4490-991f-dbbb0e965502.png`。

- 数据库 163 条迁移的有序 `[version,checksum_sha256]` 数组 SHA256 为 `56665e97159bbe06f24c465fad262a235ef3d6f0efbf23e0329dc39094903134`，与本地前 163 条迁移按 LF 归一化计算的目录完全一致，核对通过。
- `agent_runtime_outbox`：delivered 230，没有显示 pending/dispatching/failed。
- `agent_provider_calls`：failed 1、succeeded 58，未显示 reserved/sending/acknowledged/uncertain。
- 活跃或 uncertain 父运行关联阶段，以及 leased/running/uncertain 阶段的联合检查返回空数组。当前快照无该类租约/未决阶段；切换前仍须实时复查。
- 这些检查没有触发调用、重试或发送消息。定时文章仍运行，后续窗口不能复用旧快照作为空闲保证。

### 第十六批：旧调度源码与本地兼容测试

服务器截图 `E:\CodexData\temp\codex-clipboard-c8582b52-90f0-4198-8d04-54795e9e7c8b.png`：静态相对模块依赖共 70 个，按路径排序后的源码指纹为 `72cb11e1d230bfa0627ae36d2accfdc5a3d92b460e41e694544d024c63b93ec8`，与本地 Git 历史 `3b79276f6aa9435a` 一致。扫描未发现 migrationStatus/applyMigrations/loadMigrations 引用；此为静态检查，不覆盖动态加载或所有外部依赖。

本地使用已有目标 API 镜像依赖、已核对的旧 70 个模块和新建 Postgres 16.10 内存库，应用完整 0166 schema。合成两个 Agent，分别建立启用和暂停的每日计划，验证旧 ensureDaily(preserveExisting=true) 保留 enabled、next_fire_at、工作流、时区、计划规格及配置；对尚未到期/暂停的计划 claimDue 均返回 null，fire 数为零。未使用真实身份、密钥、原数据库、登录卷或供应商网络。

结果 `E:\CodexData\build\Right\agent-server-preflight\20261122\scheduler-schema166-c\result.json` 为 PASSED。可复用脚本 `scripts/verify-agent-legacy-scheduler.cjs`。本次独立容器及内部网络结束后清理；先前停止的本地容器没有恢复。前两次合成夹具初始化因 Agent 延迟约束及自动发布归属触发器失败，修正夹具后在全新内存库通过，未改产品代码或绕过约束。

**范围限制**：这是旧源码在目标镜像依赖上的调度数据库操作兼容测试，不是原服务器调度镜像本体的完整启动/发布测试。原镜像未在本机准备；不能声称完整镜像级回退验收已完成。

### 本地运维文件补齐（没有线上执行）

用户后续授权补齐可执行门禁、升级/回退文件及双库备份命令，并将论文持久关闭纳入未来方案。实现、具体命令、保留边界及现场审核条件见 `agent-server-cutover-tools-20261122.zh-CN.md`。

最终 12 项门禁/故障注入测试通过；真实独立 PG16.10/0166 双库备份、完整归档解码、恢复到新库并比对合成历史/QQ 消息通过；损坏备份拒绝。真实合成论文容器关闭后重启策略 no、六开关 false，显式再次启动仍正常退出。证据为 `E:\CodexData\build\Right\agent-server-preflight\20261122\cutover-real-c\verification.json`。没有恢复先前停止的本地环境，没有创建线上备份或关闭线上论文。

原服务器调度镜像本体验收及全部执行入口审核仍未完成，示例 spec 的对应审核字段保留 false；现有 QQ 白名单迁移需显式审核，不能自行新增用户或覆盖撤销记录。线上私有参数/覆盖文件需未来获准准备服务器后根据当时现场生成，而不是把本地测试记录用于生产。

## 只读边界

- 仅读取现有容器、镜像、网络、卷、Compose 标签与配置链；不执行 up、stop、restart、run、迁移、bootstrap、备份创建或安装。
- 用已经运行的 API 容器自带 Node 执行内存中的采集代码，不落盘远端脚本。
- `scripts/agent-server-readonly-probe.cjs` 的 metadata 模式将 Docker inspect 原始数据在服务器内部脱敏，仅返回部署引用、指纹、开关、资源及状态；不返回原始环境、口令、token、命令行私密参数或带凭据 URL。
- api-db 模式只创建一个现有数据库连接，强制 `default_transaction_read_only=on`，使用可重复读只读事务和语句／锁超时；各段失败用 savepoint 隔离，结束 ROLLBACK。SQL 防写检查先于查询，不读取历史对话正文或供应商密钥明文。
- 不加载应用 runtime，不调用模型、研究、发送消息或变更登录状态的接口；不恢复原先停止的进程。

## 需要取得的实际证据

1. `gamehub-production`、`mooyu-qq` 当前容器版本、运行状态、角色及原始完整 Compose 顺序，确认是否已有共享交互执行器。
2. API／worker／调度角色的 Agent 绑定、密钥引用是否对齐，网络 DNS 别名及只读／持久挂载，登录卷实际名称与来源。
3. 数据库迁移版本、Agent／操作者、既有授权和策略、预算、启用及暂停的计划、未完成运行与 fire、未结算最终结果及图片页。
4. 已有两库备份的路径、时间、大小和校验结果；本轮不创建备份。过期或不能验证的备份作为后续部署阻断项。
5. 六个论文开关、论文相关在途运行及调度状态，确保本轮不启用论文。

采集后只在本地生成脱敏证据与按现场参数填写的升级／回退命令。缺少执行器时，结合已验证的首次接入模板准备具体方案；不猜造原服务参数，也不将未知项标为通过。

本地验证：`node --test tests/platform/agent-server-readonly-probe.test.cjs` 两项通过，覆盖真实格式环境字段的脱敏、凭据 URL 清理、Compose 顺序，以及写入／多语句拒绝。实际数据库查询等待后续只读采集。
