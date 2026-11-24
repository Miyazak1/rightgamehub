# 原调度镜像验收与部署前剩余阻断

## 最新结论：原镜像本体验收已通过

### 2026-11-23 13:26：兼容调度切换成功，真实搜索验收未完成

后续只读现场确认：切换后 05:26:22Z 的 message b907cb0c-20bb-5fd4-86a3-8d893dfabcbc 已完成，但没有子任务；最近唯一 github-search 子任务 db86450c-667e-5ae7-88de-b5d6672cbf28 创建于 04:05:22Z，仍为切换前旧失败。调度心跳 06:34:14Z、protocol=1、waiting、enabled=true。故不能将最近群回复引用的旧错误当成兼容切换后新检索失败；尚需自然语言明确发起一次新搜索并跟踪对应新 taskId。元数据不包含最近用户消息正文，不能据此断言当轮已明确要求搜索，也不能直接认定模型路由存在确定性缺陷。代码检查发现对话允许直接文字回答，只有实际 tools.execute 后才 attachTask；不应以关键词强制重试历史失败或放宽权限作为修复。

用户现场回执为 SCHEDULER_COMPAT_SWITCH_VERIFIED，兼容镜像 99f6306de9c83f444eb5a07b2fa78562171d49394c2a98b5dc9743f879f0872f；13:25:35 上海时间心跳 waiting、protocol=1。只重建调度服务，其他服务、权限、计划、登录、历史、outbox 和旧锁记录均保留，两套论文保持关闭。failedTaskRetried=false，不代表原搜索已重试。

13:26 群回复仍引用旧 AGENT_INTERACTION_SCHEDULER_UPGRADE_REQUIRED 并询问是否重试，尚不能据此认定新搜索失败或成功。新增 server-qq-search-after-switch-readonly.txt，仅查最近五条消息与实际子任务对应关系及真实调度心跳，不输出消息正文、工具参数或秘密，不修改数据、不重试、不重启。等待现场结果区分未调用 GitHub 工具和新工具任务失败；禁止因此再次盲目部署调度器。

### 2026-11-23：预检异常定位并修复，沿用原授权交付修正命令

用户只读插桩回执：操作锁不存在、上传原工具SHA匹配；在idle-ledgers步骤JSON.parse抛SyntaxError，后续record/stop/up均未执行。直接原因已定位为工具把psql -At的普通多列行（t|时间|时区|JSON）当成JSON数组解析。检查同类调用还发现切换前后心跳查询返回裸worker对象，却按[0].worker取值，会在修复前者后导致心跳验证永远失败。这两处属于运维脚本结果契约错误，不是数据库数据故障或兼容镜像失败。

switch-scheduler-interaction-compat.mjs现使用显式JSON聚合的SCHEDULER_PLANS_SQL和SCHEDULER_HEARTBEAT_SQL，统一返回数组并严格验证形状；切换前后共享同一心跳契约。回退工具从当前实际修正版import.meta.url复制，避免重新带入已上传旧脚本的缺陷。新增预检子阶段及安全的原生错误代码，不输出原始错误或秘密，全部原门禁和单服务范围保留。

真实本地PG16经原Cutover.sql的psql -At复现两种旧问题，并验证计划、前后心跳、新实例新鲜协议、空结果数组和只读不修改行，scheduler-switch-json-contract-r1/result.json PASSED，专属测试容器已清理。5项SQL契约/心跳/单服务范围/配置比较/失败停止单测通过。修正版引导另经模拟文件系统验证：只在新目录写两文件、保留旧脚本、校验源码SHA、回执可解析、仅一次switch调用；原脚本校验不符时零写入零执行。

修正命令：E:\CodexData\build\Right\agent-server-preflight\20261123\scheduler-switch-hotfix-command-r1\server-corrected-switch-only-scheduler-command.txt，修正工具SHA256 331120f8ef110a7c04925bea8d1b2c514020da538d6e57a5e42c7a97c8853e44。Node/Git Bash语法通过。无需重传镜像、解包或覆盖旧上传脚本；在新的agent-scheduler-compat-hotfix-20261123-私有目录保存修正工具后调用原授权switch范围，原计划/权限/登录/历史、其他容器和旧锁记录继续保护。未在本机执行服务器命令；现场成功仍需SCHEDULER_COMPAT_SWITCH_VERIFIED，随后原GitHub问题以新消息验收。

### 2026-11-23：候选已加载，切换在预检异常处停止，尚未换调度器

用户宝塔回执包与各文件SHA全部OK、COMPAT_CANDIDATE_IMAGE_VERIFIED；随后SCHEDULER_SWITCH_STOPPED_REVIEW_REQUIRED，directory=null、phase=preflight、code=OPERATION_FAILED，automaticRetry/automaticRollback均false。维护记录及stop/up尚未执行。该错误是脚本将非显式异常过度简化为通用码，不能据此认定某项安全门禁或服务本身故障。

用户后续QQ截图仍引用AGENT_INTERACTION_SCHEDULER_UPGRADE_REQUIRED，与调度器未切换一致；不是新的检索成功，不要求用户换项目链接或重复发任务。旧失败历史保留。

新增diagnose-scheduler-switch-preflight.mjs及server-scheduler-switch-preflight-readonly-command-v2.txt：先核对上传脚本冻结SHA，只在内存加入步骤追踪和异常类型/原生代码/缺失符号/栈行号，重放check()后即返回，绝不进入record/stop/up；检查原操作锁是否存在但不创建/删除锁。文件写API强制拒绝，Docker只允许metadata和带只读PGOPTIONS的SELECT，原脚本文件不改写。不输出原始错误/环境/凭据或Data URL源码。Docker拒写、异常脱敏、所有插桩锚点及生成模块语法已本地验证通过。现场异常步骤仍待回执；不盲目重跑已解包的旧命令或清理锁。

### 2026-11-23：仅切换日调度服务已获授权，交付已准备

用户明确授权仅换日调度服务兼容镜像，其他服务不重启，计划/权限/登录/历史保留、两套论文关闭，并继续验收原GitHub请求。新增独立switch-scheduler-interaction-compat.mjs，原正式部署state及旧锁记录不改；维护目录记录原配置摘要/有序链/回退覆盖，真实任务空闲和45分钟窗口门禁，前后验证其他容器/权限/参与者/预算/历史/outbox未变。具体范围见scheduler-compat-authorized-switch-20261123.zh-CN.md。

3项单测通过；scheduler-compat-switch-compose-r3/result.json实际Compose切换与回退PASSED，旁路服务/卷历史保留，专属资源已清理。r1/r2发现Compose --wait对禁用镜像健康检查的兼容问题，正式工具改用真实协议心跳+running验证就绪，不伪造健康状态。新版r2交付复用原images.tar，仅新增维护工具和证明。尚无上传或服务器切换回执，成功必须观察SCHEDULER_COMPAT_SWITCH_VERIFIED；下一步应交付具体宝塔命令，不再请求同范围重复授权。

交付E:\CodexData\build\Right\agent-server-preflight\20261123\scheduler-interaction-compat-release-r2，archive scheduler-interaction-compat-20261123-r2.tar.gz，233974775字节，SHA256 e34538d85f3ffa3051f99433520e80539e9e1f89ac4c5544a3dd7c2148247216；维护工具SHA256 18cbbdbf5fa741c1b96e45c4ca8ad099f845127e2e1713eede05fab244440939。Node与Git Bash语法通过，归档目录回读及内部SHA清单已生成。服务器新上传目录agent-scheduler-compat-20261123-r1，只上传r2归档与其.sha256，再执行server-switch-only-scheduler-command.txt；本地未执行该服务器命令。

### 2026-11-23：GitHub协议阻断现场确认；最小兼容候选已本地验收

用户现场error_code明确为AGENT_INTERACTION_SCHEDULER_UPGRADE_REQUIRED，子任务github-search failed且run_id=null；父聊天completed，原调度心跳waiting但interaction_protocol=null，相关原授权均active。已确认这是兼容验收漏项，不是能力边界或权限缺失。

仅本地从原ee818f…派生候选99f6306de9c83f444eb5a07b2fa78562171d49394c2a98b5dc9743f879f0872f：排除旧pending扫描中的agent-interaction-v1检查点，并由对应真实调度器心跳声明协议。70模块仅2模块变化，68原样，运行配置/入口不变。合成PG166实际验收PASSED（scheduler-interaction-compat-acceptance-r1/result.json）：复现旧失败与旧接管风险、真实候选隔离waiting/过期交互请求、保留旧任务恢复、真实新版执行器协议准入、原CLI启用/暂停计划及重启保留，0真实模型调用、0额外自动fire；2项补丁边界测试通过。本次修复不伪造数据库标记、不删除协议检查。

详细复核与拟切换/回退范围见scheduler-interaction-compat-review-20261123.zh-CN.md。仅准备候选发布物，线上未上传/切换；未来需明确授权仅更换日调度服务镜像，QQ网关/API/worker/执行器/数据库/桌面服务不动，登录/权限/计划/历史及两套论文关闭保留。完整GitHub检索还需切换后新请求真实验收，旧失败不自动重试。

### 2026-11-23：上线后GitHub任务失败，发现旧调度协议兼容验收漏项

用户已确认扫码后上线，并回传普通QQ消息可回复；“有没有最新的开源生图模型？github上开源的”先收到任务保存回执，后收到通用失败回执。不能把执行失败解释为正常能力边界或要求用户强制指定工具名。

本地源码agent-interaction-github.mjs在新GitHub查找/文章任务开始前，要求原日计划config_json.worker.interactionProtocolVersion=1且心跳新鲜，否则抛AGENT_INTERACTION_SCHEDULER_UPGRADE_REQUIRED。对实际保留的原不可变调度镜像ee818f…仅做本地无网络只读源码检查，原CLI及agent-blog-public-runtime.mjs均无interactionProtocolVersion标记。此前原镜像在166下原业务与重启验收通过，未覆盖此新版交互协议前置条件，是部署兼容验收漏项；不应声称所有线上GitHub任务已验收。

这种不匹配与聊天正常、GitHub任务保存后失败高度吻合，仍需关联本条线上error_code确认直接失败原因。新增server-qq-github-failure-readonly-command.txt读取指定Agent/群最近8条交互元数据、错误码、阶段和调度协议/心跳以及原授权状态；强制只读事务，不输出消息/文章正文、凭据，不重试任务、不改协议标记、不扩大预算/权限、不触碰QQ登录。主程序和容器片段语法通过，字段与0164/0123迁移核对。尚待线上回执；不通过手写interactionProtocolVersion=1或删除检查来绕过防并发门禁。

### 2026-11-23：一次性网关恢复已获授权，命令与备份本地验证完成

用户对“备份后仅重启现有登录网关一次、不重建/换镜像/清理登录卷、其他服务不重启”的具体范围明确回复授权。新增recover-qq-gateway-once.mjs及server-qq-gateway-recovery-once-command.txt，无需上传新文件，复用既有Node和已审只读校验工具；命令尚待用户宝塔执行。

固定网关mooyu-qq-napcat-1、卷mooyu-qq-compatible-55b2f7e8-088f12。共享flock与操作锁下核对唯一成功部署记录及当前配置、原锁记录、磁盘容量，拒绝sending中的投递；queued/ready/needs-review等保留原样不清除、不假定已投递。停前检查独立online，若已自然恢复则拒绝不必要的重启。先用docker cp -a生成并完整读取校验保护tar，再检查现场未变，docker stop --timeout -1等待正常停止（CLI超时90秒即停止流程，不强杀），补充停止状态下的冷tar及SHA后，只docker start原容器一次。备份失败或正常停止失败不跳过步骤、不重试启动。

前后确认同容器ID、镜像、配置、卷和其他服务/原锁记录/正式部署state字节不变。只读轮询登录至约一分钟，分别报告LOGIN_READY / SCAN_REQUIRED / LOGIN_PENDING；不自动扫码、刷新二维码或第二次重启。原正式部署记录的网关StartedAt是重启前快照，刻意不修改；恢复记录保留新时间，未来升级/回退需另行审核该已授权时间变化，不能手改原锁记录获得放行。

3项失败/顺序/活跃投递测试通过。独立合成本地容器和卷qq-login-backup-r1/result.json PASSED：运行及停止状态归档、全量解码、合成历史保留、拒绝覆盖、同容器/镜像/卷重启均通过，仅清理本次带标签测试资源；没有使用真实QQ会话。正式命令Node和Git Bash语法通过，当前尚无服务器恢复回执，不能宣称已恢复在线。

### 2026-11-23：独立QQ内核确认离线，恢复网关需另行授权

用户最新回执：independentCore.online=false、expectedBotMatches=true、onlineButLoginFlagFalse=false，排除“内核已在线但仅管理登录标志过期”这一情况。reasonMarkers.present=false，其余离线原因标记均false；singleProcess=true、workerProcess=false、限定目录logs=[]。不能据此认定被踢、网络故障、账号风控或插件导致掉线，也不能把未找到限定日志解释成整个系统无日志。

在原网关不可变镜像ac32edd…中仅使用无网络只读临时容器、源码提取及假的计时器/登录对象做分支复现（不加载QQ内核、不挂载会话）。napcat.mjs SHA256=7967149b1c4f3d30e0506c842f84b7b925c2d361e3c9c75ebf0d4ff24dbdedaa：单进程跳过子Worker管理；离线监视器恢复回调失败时最终转offline；刷新二维码若MSF状态为2则置reconnecting并抛QQ_LOGIN_SERVICE_RESTARTING。这证明持续等待不能保证恢复，且仅凭reconnecting不能归因于某个具体触发分支；本次现场初始掉线原因仍无证据。

当前可操作故障范围为“QQ内核实际离线且登录服务未恢复”，问答WebSocket/DNS/worker健康仍正常。建议恢复方案为：先核对现有网关镜像/卷/配置及QQ未完成投递并在新私有目录保护备份，再仅重启原网关容器一次，不重建、不换镜像、不删或替换登录卷；其他API/worker/调度器/数据库/桌面服务不重启，权限/计划/历史/论文状态不变。随后检查登录；若原会话不能恢复，由用户为原机器人扫码，不收取密码。不自动重复重启或清空会话。此动作超出用户此前“不重启登录网关”的部署范围，必须取得单独明确授权后才给执行命令并推进，当前未执行。

### 2026-11-23：QQ通道已连通，登录状态层异常待独立内核标志确认

用户只读诊断回执：gateway运行、restarts=0、StartedAt仍2026-11-20T08:02:02Z；新worker/API healthy，均restarts=0。worker健康connected=true，gateway→worker健康200且connected=true，双向DNS正常且worker解析含当前worker。worker日志gateway-connected。因此不应通过改反向WebSocket地址/token、重复部署、重建网关来处理该截图。

CheckLoginStatus实际isLogin=false、isOffline=false、coreReady=false、phase=reconnecting；inspect available=true。GetConfig失败与原镜像接口依赖内部登录标志的实现一致，不足以证明配置错误。容器stdout近30分钟无离线/崩溃标记不等于文件日志无记录。

本地仅用原不可变网关镜像ac32edd…的无网络只读临时容器检查napcat.mjs，未挂载任何会话：状态接口将isLogin与isOffline均与内部QQLoginStatus相与，内部标志false时两者同时false，coreReady也同受影响。GetQQLoginInfo另返回独立selfInfo.online；可区分真实离线与状态标志未恢复。离线监视器监听KickedOffLine/SelfOffline，将标志置false并phase=reconnecting；定时检查或子进程恢复未完成时可能持续该状态，但尚未从现场证明具体分支。

新增server-qq-login-state-readonly-command.txt，仅查询独立online、预期机器人匹配、离线原因关键词、单进程模式及两个限定日志目录中最近两文件的有界尾部标记计数，不输出原始loginError、日志正文或凭据，不调用登录/刷新/重启/SetConfig。3个Node片段语法通过。仍待用户回执才能判断账号确实离线还是管理状态卡住；不据此修改线上或请求网关重启。

### 2026-11-23：部署成功，QQ登录重连状态待补验

用户截图实际结果AUTHORIZED_PLUGIN_UPGRADE_VERIFIED，schema=166，正式记录位于agent-authorized-upgrade-20261123-随机目录/record（完整路径以截图/主机目录为准，避免手抄误差）；新的api.dump约6824975字节、qq.dump21052字节，两份quiesced=true。originalLockedRecordsUnchanged、loginGatewayDatabasesDesktopUnchanged、bothPapersClosed、permissionsAndSchedulesPreserved、qqBothLegacyActorsRetained、budgetUsagePreserved均true，databaseRestored=false；realQQAcceptanceStillRequired=true。

后台截图显示“正在恢复连接”。源码qqRuntimeView仅在runtime.phase=reconnecting时显示此文本；这是网关登录层状态，和问答WebSocket断开时显示的“问答连接恢复中”不同。部署健康通过不代表QQ实际在线；原部署检查没有将QQ在线纳入成功条件，不能以成功回执否认该问题。仅凭截图尚不能断言底层重连原因或会话失效。

已准备server-qq-post-upgrade-readonly-command.txt，仅读取三容器状态、网关CheckLoginStatus与只读账户/群信息、worker健康/反向WebSocket配置及双方DNS/可达性、脱敏日志标记计数；认证仅WebUI状态读取，不发起QQ登录，不调用maintain/SetConfig/刷新二维码，不打印token/密码/原始日志。主程序和两个容器内片段语法通过。网关不重启、会话/权限/历史不清理；现场诊断回执尚待用户执行。

### 2026-11-23：已获正式部署授权，命令已准备，尚待实际执行

用户明确授权按已审范围正式部署、迁移前创建并校验新停写窗口备份，保留原锁定记录，不重启登录网关/数据库/桌面服务，两套论文保持关闭。新增 authorized-agent-upgrade.mjs及宝塔正式命令，复用已审SHA固定工具，创建随机私有正式记录，原三份锁定记录逐文件和权限比较不变。共享flock与操作锁、距计划45分钟门禁、停止执行角色后的新鲜双库归档验证、目标迁移及回退条件保留。

最后检查所有排除容器、两套论文/桌面ready、166目录、原权限和计划、参与者逐行保留及仅两白名单新增、预算及API健康，成功标志AUTHORIZED_PLUGIN_UPGRADE_VERIFIED。失败仅保存状态停止，不自动重试/删锁/恢复库。新增3项授权入口测试及关联共7项通过，Node和Git Bash语法通过。完整交接见agent-authorized-deployment-20261123.zh-CN.md；目前未收到服务器执行回执，不能宣称已部署。下一步应执行该具体命令，不再询问重复升级授权。

### 2026-11-23：新锁定记录终审通过，待明确部署授权

用户截图FINAL为READONLY_REVIEW_PASSED_EXECUTION_STILL_LOCKED，时间2026-11-23T03:32:21.215Z（上海11:32:21），对象 /www/backup/gamehub/agent-cutover-files-post-paper-20261123-r2。checks全部true、errors=[]、executionLockVerified=true、pluginUpgradeAuthorized=false；服务器文件/服务/恢复数据库/执行锁修改均false。这是新工具/新记录终审，不是沿用旧记录结论。

163目录checksum正确、目标166，原调度兼容证明、全部目标与回退模型、两套论文关闭/桌面ready、登录卷/数据库保护、权限/计划/密钥引用与业务指纹均通过。任务窗口仅保留11条成功通知，blocking=0；所有其他已查未完成计数零、必需表无缺失。三库在线保护备份仍完整，但年龄约751分钟且非quiesced，正式迁移前必须在停写窗口创建新的双库备份。

准备工作已完成，不再重复同一只读检查。剩余动作涉及上线变更，必须取得agent-final-upgrade-scope-20261123.zh-CN.md所列具体范围的明确执行授权：网站API/Web/QQ worker重建、共享执行器新增、原调度器窗口停启、163→166追加迁移和白名单渠道资格采用；说明生产论文惰性覆盖重申可能重建已关闭容器、桌面不变。不得把用户回传截图、终审通过或一般“继续”解释为解除当前限制。授权后仍不手改旧锁记录，使用新正式操作记录与新鲜停写备份；未获授权前不发可直接切换线上入口。

### 2026-11-23：服务器新版工具及新锁定记录已生成

用户宝塔截图确认包及4文件SHA均OK；/www/backup/gamehub/agent-cutover-files-post-paper-20261123-r2已生成26文件，POST_CLOSURE_FILES_GENERATED_ONLY之后最终NEW_LOCKED_RECORD_PREPARED_ONLY。sourceRecordsUnchanged=true、newExecutionLock=true、serverServicesChanged=false、databaseMigrated=false、pluginUpgraded=false、oldLocksModified=false；双论文仍关闭、桌面入口关闭且业务ready、关闭证明已关联。未创建新备份，未执行升级。

本地新增v4只读终审命令针对这份新记录并使用新工具目录，先验证导入工具的已审SHA且等于记录副本，再运行原完整只读检查。Node语法检查通过，旧v3命令不覆盖；尚待新记录终审回执，不将旧记录的终审结果挪用于新记录。仍不解锁、不更改审核开关或运行新记录脚本。

### 2026-11-23：新版工具与新锁定记录的交付包已本地生成

新增 build-locked-cutover-handoff.mjs，复用已验证的只读生成器和关闭证明关联。新目录 /www/backup/gamehub/agent-locked-tools-20261123-r1；新记录 /www/backup/gamehub/agent-cutover-files-post-paper-20261123-r2。入口先验证两份旧记录executionLocked=true、文件清单SHA，完成后逐文件/模式比较旧记录保持原样，新记录必须executionLocked=true。仅generationOnly；命令禁止目录混有其他文件，拒绝覆盖既有新记录；不备份、不迁移、不解锁、不变更服务。生成仍使用已校验原staging及原调度证明，不复制业务镜像。

交付采用E:\CodexData\build\Right\agent-server-preflight\20261123\locked-handoff-r2，archive agent-locked-tools-20261123-r1.tar，68096字节，SHA256 e9c9901fec2bfd6f9b8064482773a73d144b2285140198d414421f9ff5160e72；另含.sha256和宝塔命令。Node入口语法、Git Bash语法、4文件与SHA256SUMS归档逐字回读通过；5项相关单测通过，后续扩展源记录预先损坏拒绝断言亦通过。R1曾因系统bash指向WSL无法完成语法检查，保留为历史，不采用；r2显式Git Bash成功。服务器尚未上传或执行，不能记录为新锁定记录已在服务器生成。

### 2026-11-23：最终执行范围已在本地整理，未部署

新增 agent-final-upgrade-scope-20261123.zh-CN.md，明确API/Web/QQ worker目标重建、共享执行器新增、原调度器窗口停启及原白名单资格采用；说明现有工具paperClose会重申生产论文惰性覆盖，可能重建已关闭生产论文容器，桌面API/论文worker不再变更。列出网关/登录卷/数据库/其他worker排除范围、迁移前恢复/部分迁移前向补齐/166兼容回退、不得跨10:00触发窗口及无差别项目操作禁止。冻结当前本地运维工具SHA，并明确服务器旧工具未被新版v3只读命令更新，后续必须新目录/新记录，不能运行旧锁记录或手改解锁。尚无上传、生成正式可执行记录或部署动作。

### 2026-11-23：服务器新版只读终审通过，执行仍锁定

用户宝塔截图FINAL为READONLY_REVIEW_PASSED_EXECUTION_STILL_LOCKED，时间2026-11-23T03:21:31.629Z（上海11:21:31），记录为 /www/backup/gamehub/agent-cutover-files-post-paper-20261122-r1。checks全部true、errors=[]，executionLockVerified=true，pluginUpgradeAuthorized=false。

任务窗口：outbox total=11、retainedCompleted=11、blocking=0、eventsModified=false；其他必需任务/投递与全部非终态阶段计数为零，missingRequiredTables=[]。可选插件表仍未安装，符合现有163基线。身份/密钥及只读共享秘密引用匹配、changedBusinessDomains=[]；群与两个旧白名单账号、revision=3保留；原日计划enabled、Asia/Shanghai 10:00、waiting，下一次为2026-11-24T02:00:00Z。预算62次、185000输出tokens、3395000微美元均settled，未重置或调整。

关闭证明、两套论文关闭与桌面业务ready、原源文件/有序链/镜像、登录网关与卷、两生产数据库、冻结文件、目标/回退模型及原调度证明均通过。三库保护备份SHA和完整解码仍通过，但年龄约740分钟、quiesced=false，不能用于迁移停写窗口。containersUnchanged=true、serverFilesWritten=false、servicesChanged=false、databaseRestored=false、executionLocksModified=false。

剩余执行条件未获本回执自动授权：REVIEW_EXECUTION_INVENTORY、REVIEW_LEGACY_QQ_PARTICIPANT_ADOPTION、FRESH_QUIESCED_BACKUPS_AND_IDLE_WINDOW、EXPLICIT_PLUGIN_UPGRADE_AUTHORIZATION。本地代码及方案复核通过不能替代服务器新正式记录审核；现有锁记录不手改，不执行其upgrade/rollback入口。后续应先将复核结论整理为具体变更范围，再取得明确升级授权；停写窗口备份在获准后的流程中创建。当前无须清理11条通知或再重复相同只读检查。

### 2026-11-23：本地门禁与升级回退/权限继承复核

本地共用通知证明将已成功终态通知保留原样，其余非delivered事件继续阻断；仅允许已审两个GitHub工作流，严格核对成功状态、结束时间、零重试、无租约和三项载荷绑定。升级/回退补查全部未完成阶段。合成PG16通过26种拒绝场景及真实QQ继承SQL：两旧账号覆盖、已有撤销/revision不覆盖、重复执行幂等、disabled不授权；无线上写入。Linux隔离22项流程与边界测试通过，本机6项关联测试通过。完整复核见 agent-local-gates-and-qq-review-20261123.zh-CN.md。

只读终审v3本地命令已准备，未在服务器执行；服务器旧工具、26文件冻结记录和executionLocked未改。正式升级仍需未来新审核记录、停写窗口备份及明确授权，不得手工解除旧锁。两套论文保持关闭，登录网关/数据、权限、定时计划和全部历史保留。

### 2026-11-23：紧凑只读补查完成，11条通知已定性

用户新截图末尾为READONLY_DIAGNOSTIC_COMPLETE，errors=[]，11/11上下文完整。截图顶部的SOURCE_FILE_READ_FAILED是上次命令的历史输出，本次两个原调度源码文件均读取成功，SHA与本地原不可变镜像一致。

身份/权限/计划补查：agentIdsMatch=true、keysMatchWithoutValues=true、changedDomains=[]；QQ渠道仍enabled，群905757031、白名单495469022及52399347均保留。原日计划enabled、Asia/Shanghai、10:00，workerState=waiting，nextFireAt为2026-11-24T02:00:00Z（上海10:00）。预算仅有settled状态，累计62次/3395000微美元；未调整预算或重置用量。

11条全部为pending、attempts=0的stage.available；分属2个成功run，blog.project.discovery-shadow共4条、blog.project.single共7条；各stage和run均succeeded，全部payload绑定匹配，分类为PENDING_NOTIFICATION_FOR_TERMINAL_STAGE。结合原镜像定向worker跳过全局outbox分发的源码，确认这些为已执行阶段保留的内部通知，不是未完成的QQ投递。近期runtime worker为空不等于日调度器离线，其计划状态为waiting。没有消费、补发、标记delivered或删除任何通知。

本次补查解决身份SQL读失败及通知归属不明；不等于先前完整终审已自动通过。现有完整门禁仍把非delivered事件计入非空闲，尚未引入“严格证明已成功终态通知可保留”的区分，不得手改记录、清空队列或绕过该门禁。后续先在本地审核这种区分及失败/活跃/绑定不符等拒绝条件，再准备新的只读门禁；执行入口清单、旧QQ参与者采用审核、停写窗口新鲜备份与明确插件升级授权仍保留。执行锁true，服务器文件/事件状态/服务无改动，两套论文继续关闭。

### 2026-11-23：补查截图尾部与原调度入口核对

最新截图仅包含11条事件明细尾部：可见两条pending stage.available关联succeeded阶段与succeeded run，attempts=0、无租约；全部11条已读取，但截图未显示上方身份/权限/定时计划结果及完整事件分布，不能据此宣称全部通过。近期runtime worker列表为空。探针读取agent-blog-public-runtime-compat.mjs失败是新旧版本文件路径差异，原调度镜像使用agent-blog-public-runtime.mjs，不代表调度服务文件损坏。

本地对原不可变镜像ee818f213525…做隔离只读源码检查：agent-runtime-worker.mjs SHA256为e303d9068453d5412a9237114bc4a53ca4d9f3d98013dfca447ead1d1e36d887，与服务器回执一致；旧主工厂agent-blog-public-runtime.mjs SHA256为dd43c81458d8e2a1fb8db631e76eeba16e82185ab311ca8b30fbb4aeddecbcb8，显式使用targetRunId:runId。源码确认定向执行跳过全局outbox分发，解释终态阶段仍留通知的机制，但不授权清空、消费或改写事件，也未放宽部署门禁。

新增紧凑只读补查server-final-audit-compact-readonly-command-v2.txt，修正旧主工厂路径，按工作流/阶段状态/run状态/载荷绑定分组全部事件，只输出绑定真假而不输出载荷。原身份/密钥/权限/计划核对保留。PG16合成库r2检查通过：11条终态通知关联、载荷绑定、敏感正文不输出、源行不变、测试资源已清理。实际全量分组和身份计划回执仍待用户返回；执行锁和双论文关闭要求保持。

### 2026-11-23只读终审返回两项阻断，未放行

用户截图 FINAL=READONLY_REVIEW_HAS_BLOCKERS（2026-11-23T02:45:33.861Z/上海10:45）。26文件、冻结校验、全部角色/有序链/模型、7镜像及原调度证明、163迁移校验、目标与回退闭论文策略、当前双论文和桌面业务ready、关闭证明/源文件、登录卷与数据库保护、执行器隔离、备份校验及终审前后容器不变均通过。保护备份年龄约704分钟，仍有效但不是迁移窗口备份。执行锁保持true，执行审核标志未改，插件未获执行授权。

阻断1：agent_runtime_outbox非delivered=11；其他已查任务/阶段/QQ消息/图页/子任务计数0。此为内部运行时事件队列，不应误称QQ群消息漏发。阻断2：identityKeysPermissionsSchedules读失败。源码/0123迁移确认采集SQL错用不存在的agent_schedules.suspended_at，实际暂停标志是config_json.suspendedAt。这是本地脚本错误，不是服务器数据故障，也没有源库修改。已修正SCHEDULE_AUDIT_SQL并保留旧命令作为历史，完整只读v2命令另存；未将失败项冒充通过。

新增补充诊断 server-final-audit-blockers-readonly-command.txt：修正身份/权限/计划读取，输出各业务域指纹变化，按类型/状态/重试和时间统计11事件，关联stage/run元数据，检查实际调度镜像中target-run/outbox跳过分支的源码哈希/标记，以及近期worker状态。最多50条，不输出payload_json、消息/文章正文、密码、密钥值或原错误消息。只读SELECT与固定镜像源码文本读取，无事件消费/补发/标记/队列清空，无文件写入/服务重启/锁修改。

本地新的PG16合成库复现不存在列的错误并验证修正，11条终态阶段通知关联及敏感载荷不输出测试通过，源行哈希未变、资源已清理（20261123/final-audit-sql-r1/result.json）。4项关联单测通过。代码显示targetRunId/scopeRecoveryToHandlers模式跳过全局outbox分发，可能解释已处理阶段仍有pending通知，但在真实11事件及镜像标记回执前只视为假设；不据此放宽部署门禁或改投递状态。

### 2026-11-23：关闭后新记录的只读终审命令已交付

用户明确授权仅对 /www/backup/gamehub/agent-cutover-files-post-paper-20261122-r1 做部署前只读终审，不解除锁、不升级或重启，两套论文保持关闭。新增 scripts/final-post-paper-readonly-audit.mjs 及 deploy/agent-plugins/server-final-post-paper-readonly-command.txt，复用服务器已有Node与纯内置模块运维库，无需上传文件。

终审覆盖：26文件清单/私有权限与冻结文件；角色指纹/完整有序Compose链/实际合并模型；7目标及回退/原镜像ID和标签、原调度166证明；网站163迁移目录校验；模拟保留论文关闭覆盖后的目标/回退模型（仅内存设置paper策略，不写原记录），核对端口、挂载、网络、进程和非论文配置；双论文worker与桌面入口实际关闭、HTTP业务就绪、关闭证明及关闭时源文件哈希；登录卷/网关/数据库保护状态；Agent/密钥及只读共享秘密引用/权限策略/完整QQ白名单/计划/预算；全部任务、执行阶段及投递计数；执行器隔离和审核标志；关闭时引用的三库保护归档SHA、目录/关键表及完整解码到/dev/null，展示备份年龄且不刷新，不将其视为停写窗口备份。若计划因正常定时执行而推进，会如实列出变化，不停止计划或改写快照。

只读Docker白名单拒绝服务变更、pg_dump、执行恢复、迁移及非限定HTTP代码；只允许元数据、Compose config、强制只读SELECT、归档读取/解码及固定只读健康检查。工具无服务器文件写入调用，不执行生成的.sh，不修改任何执行门禁。快照前后比较实际容器，完整错误列表避免把查询失败当空闲。3项新单元测试及生成命令语法检查通过；实际现场终审结果尚待用户运行返回。

通过结果定义为 READONLY_REVIEW_PASSED_EXECUTION_STILL_LOCKED，不是可执行升级放行。两项历史审核标志只展示，论文物理关闭状态与generation-time paperClosed=false分开解释；仍明确列出执行入口/旧QQ参与者采用审核、新鲜停写备份与空闲窗口、明确插件升级授权。存在变化或读失败时输出 READONLY_REVIEW_HAS_BLOCKERS / READONLY_REVIEW_FAILED，不解锁、不修复服务器现场。

### 服务器实际关闭成功：PAPER_ONLY_CLOSED_VERIFIED

用户最新截图已确认关闭成功，独立操作目录为 /www/backup/gamehub/agent-paper-only-close-20261122-随机后缀（完整路径以回执及容器Compose标签为准）。仅改变桌面business-api、生产论文worker、桌面论文worker三个容器。bothPaperWorkersExitedSuccessfully/restartPoliciesDisabled/desktopPaperAdmissionClosed/desktopNonPaperReady/originalImagesAndMountsPreserved/productionApiQQDatabasesAndGithubSchedulerUnchanged/permissionsSchedulesLoginAndHistoryPreserved/oldExecutionLocksPreserved 均true；pluginUpgraded/databaseMigrated/databaseRestored/forcedKillUsed均false。新Compose标签含关闭覆盖，今后同项目部署必须保留覆盖链。

关闭前自动刷新三库保护备份已通过：api.dump 6685409字节、qq.dump21052字节、desktop.dump2809561字节，三份目录/完整解码/关键表/校验哈希均通过，保留owner/ACL。时间2026-11-22T15:01:17Z至15:01:20Z（上海23:01:17至23:01:20）。仍是在线保护备份，不是停写迁移备份。所有“尚未关闭/等待关闭回执”段落为历史状态，以本段为准。

实际关闭改变了论文角色的运行状态和Compose链，旧插件文件记录即使保留执行锁，也不能当作关闭后的现场快照直接执行。已准备只生成入口 deploy/agent-plugins/server-post-paper-generate-only-command.txt：先只读验证两worker退出0/restart=no/关闭开关/惰性入口、桌面专用开关false及业务ready，再生成新的 /www/backup/gamehub/agent-cutover-files-post-paper-20261122-r1；链接实际关闭证明，旧记录不改。生成器按Compose服务身份继续识别惰性worker，并采用挂载规范化快照避免误报。3项相关单元测试通过，包含新元数据JSON及清单哈希一致性，输入命令语法验证通过。尚未收到 POST_CLOSURE_FILES_GENERATED_ONLY 回执，不宣称新的后续部署文件已在服务器生成；本入口不重启、不迁移、不升级，也不再次关闭论文。

### 已收到实际论文关闭授权，执行包待宝塔运行

用户明确授权“仅重建桌面测试 API、正常停止并惰性重建两个论文 worker，保留全部数据、权限、定时计划、登录和历史，不升级插件，不重启生产 API、QQ或数据库”。此次授权覆盖固定三容器，旧插件执行锁不解除，也不授权数据库迁移/恢复或插件变更。

新增 execute-paper-only-close.mjs：校验旧锁定记录与两套方案、实际源Compose链/镜像/环境/挂载/数据库引用，复核两套任务空闲和三库备份；备份超过30分钟或缺失则先在新私有目录自动更新已授权三库保护备份并完整解码。独立操作目录、共享flock、私有操作锁和命令白名单限定变更；桌面API纸论文入口关闭并验证其他入口ready后才SIGTERM两个worker，最多等300秒，禁止强杀。原镜像惰性重建后验证退出码0、restart=no、关闭开关、数据挂载、原业务指纹及所有其他容器不变，旧记录保持逐字节不变。仅在新操作目录存储关闭覆盖和操作状态，未来Compose需保留关闭覆盖链。

7项关联单元测试通过。真实本地隔离服务验收 paper-only-close-local-r1/result.json PASSED：Compose/HTTP、两个worker的SIGTERM和惰性重建、业务ready、合成登录/历史标记及挂载保留、保护服务不重启、原本地容器不变，测试资源清理。已打包 E:\CodexData\build\Right\agent-server-preflight\20261122\paper-only-close-tools-r1\paper-only-close-tools-r1.tar（77312字节，SHA256 0d15c6f7e0c0f81d89defd4234f65a37e1f88f9fc12caf8dd71ddb2fec139b52），6个内容文件回读校验通过。配套 server-execute-paper-only-close-command.txt 将在新私有executor目录解包后运行明确scope；没有默认自动执行入口。

当前尚未收到服务器 PAPER_ONLY_CLOSED_VERIFIED 回执，不能声称论文已经关闭或目标完成。变更后失败会保留私有操作锁/记录，禁止自动重试、解锁、清理任务或回滚；需先读具体phase和状态再处理。生产API/QQ/数据库/调度器未在本机操作，本轮仍使用用户宝塔执行通道。

### 仅论文关闭的执行审核材料已准备，等待新范围授权

当前用户最新授权仍仅三库备份，明确禁止关闭论文或重启；恢复goal active不能替代执行授权。本轮继续本地准备，新增 docs/paper-only-close-execution-review-20261122.zh-CN.md 与纯函数 scripts/paper-close-command-plan.mjs，给出固定三容器范围、原有完整Compose链及关闭覆盖、桌面API准入关闭与ready检查、两套论文新鲜空闲检查、SIGTERM/不强杀、惰性重建、最终数据/登录/权限/计划/非论文服务保留检查，以及失败时停止而不自动恢复DB或重置任务。生产API/QQ/数据库/GitHub调度器不在操作范围。

四项关联本地检查通过：纯命令构造器保留顺序链和锁、拒绝越界目标及已拼入变更动作的链；桌面关闭覆盖和非论文入口策略仍通过。实际服务器持久启动入口审核仍为前提，未因backup成功或本地检查自动放行。已就该具体三容器范围向用户询问单独执行授权；等待答复，未执行线上关闭、重建、迁移或解锁，也未把总目标标记完成。

### 三库在线备份实际创建并校验通过

用户截图回执 THREE_LIVE_BACKUPS_VERIFIED，目录 /www/backup/gamehub/agent-live-three-db-20261122-随机后缀（完整路径以服务器 backup-receipt.private.json 实际值为准）。网站 api.dump 6676518字节、QQ qq.dump 21052字节、独立桌面 desktop.dump 2809563字节。三份均 archiveListPassed=true、fullDecodePassed=true、requiredTablesVerified完整、ownerAndACLMetadataRetained=true，均记录SHA256与起止时间；归档校验文件和完整私有回执在同目录。备份时点为2026-11-22T13:22:53Z至13:22:57Z（上海21:22:53至21:22:57）。

allExecutionLocksPreserved=true、containersUnchanged=true、sourceConfigurationChanged=false、servicesRestarted=false、paperClosed=false、databaseRestored=false。quiesced=false、crossDatabaseAtomic=false、notMigrationWindowBackups=true：只能记为已验证在线保护备份，不能当作停止写入后的迁移窗口备份。此前“备份尚未创建/等待回执”文字为历史状态，已被本段取代。

本次获准三库在线备份工作已完成。仍未授权执行论文关闭、停写、迁移、升级或回退，旧执行锁继续保留。下一步若进入实际变更，须先形成具体执行范围和可审阅命令，再获明确授权；不因备份成功自动运行既有脚本或手改锁。

### 用户已授权三库在线备份，命令待服务器执行

最新明确授权为创建并校验网站/QQ/独立桌面三库备份，不关闭论文、不切换、不重启。独立入口 create-three-live-backups.mjs 不调用原锁定记录的 backup.sh，也不解除锁；读取并校验已有清单、冻结配置、数据库身份/源应用连接引用及网络，在 /www/backup/gamehub/agent-live-three-db-20261122-随机后缀 新700目录写入600文件。不会改旧记录。运行中数据库使用pg_dump自带一致性快照，三库顺序备份，quiesced=false/crossDatabaseAtomic=false，不冒充停写迁移窗口备份。

每库custom归档保留owner/ACL元数据，先写partial，校验PGDMP、pg_restore --list、完整解码到/dev/null及关键表存在，再形成正式dump、TOC、SHA256和字节数；没有对任何现有库执行restore。备份Docker白名单只允许ps/inspect、强制只读psql SELECT、固定参数pg_dump和pg_restore目录/输出SQL到null。前后校验冻结文件、源容器配置、挂载、运行状态、启动时间和重启数；保持两个方案执行锁不变。

本地验收 three-live-backups-local-r3/result.json PASSED：全新无网络PG16.10与17实例，三份合成库导出/完整解码、恢复到全新合成库、历史/ACL比较、损坏归档拒绝均通过；原本地容器不变，测试资源已清理。两项命令边界/快照变更检测单元测试通过。R1曾有短/全ID比较清理断言问题，R2发现Docker挂载枚举顺序变化导致误报；均未触及原容器，历史输出保留、不采用其结果。R3按挂载目标排序并递归规范对象键，同时仍检查源、RW、镜像、启动时间等实际变化。旧服务器工具/包不改写，新备份命令自带修订后的快照比较。

交付 deploy/agent-plugins/server-three-live-backups-command.txt，无需上传新包。成功回执应为 THREE_LIVE_BACKUPS_VERIFIED、三项 archiveListPassed/fullDecodePassed true、containersUnchanged=true、allExecutionLocksPreserved=true，并明确servicesRestarted/paperClosed/databaseRestored=false。现场执行及回执尚未取得，不能记录为已创建线上备份。

### 两套论文补充方案服务器生成成功

用户返回 ALL_PAPER_PLAN_GENERATED_ONLY：directory=/www/backup/gamehub/agent-all-paper-plan-20261122-r1、executionLocked=true、productionAndDesktopPaperCovered=true、desktopRequestAdmissionCovered=true、actualDesktopComposeMergeVerified=true、desktopPointInTimeIdle=true、backupDatabaseCount=3、containersUnchanged=true。独立库 documents1/tasks1、unassignedTasks0/tasksWithoutCheckpoint0/activeRuns0/activeStages0。servicesRestarted=false、paperClosed=false、backupsCreated=false。旧“补充方案等待生成”记录已被本段取代。

本次只读预检与文件生成阶段已得到实际服务器证明：原镜像兼容验收、7镜像准备、25个原升级回退/生产论文文件生成及审核、独立论文库任务核对，以及两套论文/API入口关闭覆盖和三库备份清单生成均有回执。仍不能将论文记为已关闭：现场明确paperClosed=false，当前授权仍禁止切换/重启和实际关闭。新鲜三库备份未创建；执行入口完整审核与正式执行授权仍未放行。未来进入实际变更阶段，必须先按具体动作获得授权，对最新现场生成新的可执行记录并重做空闲/备份门禁，保留现有锁定记录、历史和登录数据，禁止手改旧executionLocked。

### 独立桌面现场回执已取得，两套论文补充方案待生成

用户最新截图确认 desktop_business_test 库/同名用户、readOnly=on。paperDocuments imported=1；paperTasks count1、withoutRuntime0、withoutCheckpoint0；paperRuns succeeded1、paperStages succeeded1；desktop-paper-study-worker 注册idle1。当前API和worker的DESKTOP_BUSINESS_TEST_PAPER_ENABLED均true，符合源码专用开关判断；不是靠常规PAPER_STUDY_ENABLED控制。实际镜像worker检查settings.paperStudyEnabled，policy检查专用开关；两文件均完成只读指纹采集。生产和隔离项目均未变更，paperStopped=false。此前“缺现场回执/不能判断独立库”阻断已经解除；该空闲证据只适用于采集时点。

新增 generate-all-paper-plan.mjs，读取原锁定记录及桌面实际Compose链，在新的 /www/backup/gamehub/agent-all-paper-plan-20261122-r1 生成补充文件，不改旧记录：production-paper-off.json、desktop-paper-off.json（包含business-api专用入口及worker/prepare惰性退出）、三库备份命令清单、两套关闭顺序及前提。原两库备份清单补入独立desktop_business_test库，仍只生成命令，不创建备份。真实Compose合并须保留其他服务、环境、依赖、端口、网络和卷；前后容器及原业务指纹须一致。

4项本地测试通过，包含只读Docker边界、专用开关与路由、完整模型保留；使用本机真实Compose解析合成配置及相同保留检查再验通过，证据 desktop-paper-close-compose-r2/result.json。交付 deploy/agent-plugins/server-all-paper-plan-generate-only-command.txt，无需新上传文件。只读查询与配置解析均使用现有生成器的命令白名单；新增写入仅新私有方案目录。尚未收到 ALL_PAPER_PLAN_GENERATED_ONLY 现场结果，不能宣称补充文件已生成或论文已关闭。

### 桌面论文关闭方案本地 Compose 验证通过

新增 verify-desktop-paper-close-compose.mjs，使用本机真实 Docker Compose 对全新合成配置只做 config 解析。结果 E:\CodexData\build\Right\agent-server-preflight\20261122\desktop-paper-close-compose-r1\result.json 为 PASSED：关闭覆盖合并后，默认服务集合不含 business-paper-worker/business-paper-prepare，business-api 与 gateway 仍在；API 的其他依赖、GitHub配置、数据库引用、端口、网络与数据卷保持，论文健康依赖变为可选成功退出依赖。没有创建容器或改变现有服务。此为合成配置解析证明，不能替代实际服务器该项目的合并与任务空闲检查。

desktop-paper-close-plan.test.mjs 两项通过，额外直接调用原桌面请求策略验证：关闭专用论文开关后，论文创建/读取入口拒绝，health/works/blog/auth refresh/session 入口仍允许。没有写业务代码或开启论文运行环境。前一轮为实质进展（发现专用开关并补充计划及只读采集）；本轮继续完善并验证真实Compose语义。独立测试库现场回执仍未取得，不将其记为空闲，也不声称目标已完成。

### 全部论文关闭范围已确定，补齐桌面测试专用入口

用户同意由助手判断论文仍在开发时的关闭范围，已选择生产及独立测试论文均纳入方案；最新限制仍是只准备、不执行。此前 outsidePaper applyAuthorized=false 代表当时的执行范围，不应直接手改旧记录。旧生成文件和锁保留。

代码复核发现桌面 worker 使用 desktopBusinessTestConfig 与 DESKTOP_BUSINESS_TEST_PAPER_ENABLED 专用开关；business-api 也用它暴露论文创建入口。常规六开关不能替代该开关。新增纯函数 desktop-paper-close-plan.mjs：为worker/prepare保留原不可变镜像并生成惰性退出、restart=no/profile覆盖，同时为业务API设置专用开关false，避免继续接收论文任务；仅调整论文依赖为可选成功退出，不覆盖登录/GitHub配置、其他依赖、网络、挂载、端口和数据。单元测试通过；覆盖尚未在服务器生成或应用，也未宣称已关闭论文。

补充只读命令 deploy/agent-plugins/server-desktop-paper-readonly-command.txt，将核对桌面项目实际角色/专用开关/卷、隔离数据库身份及论文文档/任务/运行/阶段/worker注册聚合计数，并只读核对实际镜像中worker/policy文件的指纹与开关代码标记。使用已运行独立数据库容器中的psql，default_transaction_read_only=on、超时；不输出论文正文、PDF、密码或完整环境，不导入应用，不执行停机或初始化。现场回执尚待用户提供，不能将独立项目队列视为空。

### 生成文件只读复核结果（用户最新截图）

25个文件中的23个清单覆盖项全部校验/私有权限通过，无未记录文件；全部冻结文件哈希匹配，无 changedFrozenFiles。API/Web/QQworker/原调度/生产论文worker的 configurationMatches 与 runningMatches 均true；原Compose链文件存在且校验一致。网关配置及启动时间、原登录卷、两个数据库容器配置与启动时间均匹配。7个生成脚本均引用记录内工具，均未执行。

目标API/QQ镜像、兼容回退API及原调度镜像正确；共享执行器为目标API镜像，无发布端口，两网仅agent-interactions别名，六论文开关false，继承环境使用引用。生产paper-4.json惰性关闭覆盖验证true。部分original/target-web覆盖paperFlagsAllOff=false表示该覆盖没有显式六开关，不代表线上开关均为true；需按合并配置/角色解释，不能据此自动修改Web或历史原镜像定义。

另一个候选已识别：mooyu-desktop-business-test-business-paper-worker-1，project=mooyu-desktop-business-test，Compose目录 /www/backup/gamehub/desktop-paper-f2959a6c-20261103T114056Z，文件 candidate.compose.json。当前运行、镜像匹配、单独禁用覆盖验证true，applyAuthorized=false。与已保护生产容器共享命名卷=[]，共同API网络=[]，DATABASE_URL端点比较false；这些只代表已检查的直接关联，不排除其他HTTP/代理引用。最新输出PAPER_STUDY_ENABLED与PAPER_STUDY_WORKER_ENABLED均unset，MODELS/PUBLISH=false，其他两开关unset；更正早期截图被记录为PAPER_STUDY_ENABLED=true的判断，不能据env unset推定功能关闭或启用。

执行锁仍true，完整入口审核与旧QQ参与者采用审核标志仍false；未执行任何脚本、备份、迁移、停机或论文关闭。已向用户询问独立测试论文是否纳入后续关闭范围，该问题仅确定方案范围，不构成执行授权。原生产权限与两名QQ允许者应完整保留，后续正式记录仍需基于最新现场和新鲜备份，不手改现记录解锁。

### 生成后只读审核命令已准备

本轮继续范围为只读审核，不是执行授权。交付 deploy/agent-plugins/server-generated-files-readonly-command.txt：读取生成清单并校验私有文件/冻结文件哈希，核对当前角色配置、登录卷及网关/数据库启动时间，检查执行器私有别名与环境引用、生产论文惰性关闭覆盖，并输出另一个项目论文worker的Compose路径及共享卷/网络/数据库引用比较（不输出凭据）。不导入应用或生成的运维模块，不执行脚本，不执行数据库查询，不写服务器文件或解锁。检查逻辑语法验证及论文六开关/原镜像/退出入口检查单元测试通过。现场输出尚待用户返回。

### 服务器仅生成回执：FILES_GENERATED_ONLY

用户返回成功截图：record=/www/backup/gamehub/agent-cutover-files-20261122-r1、filesGenerated=25、executionLocked=true、outsidePaperProjectsRequireReview=1、containersUnchanged=true、servicesRestarted=false、databaseMigrated=false、paperClosureExecuted=false、backupsCreated=false。本次获准的升级、回退和论文关闭文件生成已完成；不表示执行审核已放行。此前“等待服务器生成回执”的描述已被本段结果取代。

服务器保留已有 stage、generator 和新 record 目录；不覆盖或删除旧历史。下一阶段应先只读复核生成清单、覆盖和冻结链的摘要，以及其他项目论文入口归属，形成具体执行范围。双库新备份、论文持久关闭、停写、迁移和服务切换均未执行且不在本次授权内。不得直接运行生成目录中的 upgrade/rollback/close-paper/backup 脚本或手改 executionLocked；未来完成审核及明确执行授权后，按最新现场另生成可执行记录。

### 已交付仅生成入口，等待服务器回执

用户进一步授权生成最终升级、回退和论文关闭文件，明确不执行。新增独立只读命令白名单包装器及 generationOnly 模式：保留两项审核开关原值，生成现场真实覆盖及脚本，但记录 executionLocked=true；加载该记录执行任何运维命令都会拒绝，不提供修改状态解锁途径。生产论文与其他测试项目论文分别生成覆盖/审核文件，均不应用。读取和生成前后核对所有既有容器与保护业务指纹。

本地无网络 Linux 16项回归测试通过；生成器小包5个内容文件回读校验通过。交付 `E:\CodexData\build\Right\agent-server-preflight\20261122\final-file-generator-r1\agent-final-file-generator-r1.tar`，SHA256 `fbac7930b4694ae43ba621d26c14bc39c010b6fb1891df557c9933520bd81644`，大小54272字节，命令同目录 server-generate-only-command.txt。用户需上传到既有私有stage目录，命令仅校验并解包到新 generator目录，在新record目录生成文件；不导入镜像、不创建备份、不关闭论文、不变更原配置。尚未收到 FILES_GENERATED_ONLY 真实服务器回执，不能标记生成已完成。

### 服务器准备回执：STAGED_ONLY

用户已返回准备成功截图：imagesVerified=7、containersUnchanged=true、servicesRestarted=false、databaseMigrated=false、paperClosureExecuted=false、cutoverPrepared=false、remainingReviewRequired=true。服务器新私有目录 /www/backup/gamehub/agent-plugins-stage-20261122-r3 的发布文件与7镜像已准备并校验，解除“目标/回退镜像未就绪”阻断。现有容器配置指纹和启动状态在导入前后匹配。截图 at=2026-11-22T12:05:17.253Z（上海20:05:17）。

尚未完成正式切换记录与覆盖文件生成，也没有执行双库新备份、关闭论文、服务切换或数据库迁移。下文关于未收到准备回执及镜像缺失的文字为此前状态，以本段为准。现有功能、权限、计划、登录卷和历史未在准备操作中改动；论文worker仍需在未来获准执行阶段按明确范围持久关闭。

### 已获准的下一步：服务器文件与镜像准备，不切换

用户授权仅在新私有目录准备发布文件及导入镜像。已生成独立小工具包 `E:\CodexData\build\Right\agent-server-preflight\20261122\server-staging-r3\agent-staging-tools-r3.tar`，SHA256 `8cce76f8258020c817bc93dd31e4995f88a055fabcfe2e32a7f1d8df5387fcb1`，及配套宝塔命令。沿用原 delivery/images.tar，不重复复制镜像大包；26 个发布文件校验通过，7 个镜像索引/标签集合准确。工具包8个内容文件回读校验通过。

准备命令只在 /www/backup/gamehub/agent-plugins-stage-20261122-r3 解包，读取旧 API 容器的 Node 二进制，检查归档校验、现存同名标签冲突、剩余磁盘、原调度镜像身份，再 docker image load 并核对7个镜像。记录现有所有容器的配置指纹及启动状态，导入后对比。不会运行 cutover prepare/backup/close-paper/upgrade/rollback 或 Compose，不执行数据库命令。server-cutover-spec.draft.json 带真实原镜像证明，但入口完整审核/QQ采用审核仍 false，不能直接用作正式部署放行。现阶段尚未收到服务器执行结果，不能记录为镜像已导入。

### 最新双库只读快照（用户截图）

补查结果：`agent_paper_research_queue_items` 按正确的 state 列统计，仅 completed=1，无 queued/paused/blocked/rejected 记录。本次采集列名错误已解决，不能继续将其列为现场阻断。该结果仅说明采集时队列无待处理项，不等于论文 worker 已关闭，也不能替代切换当时的空闲门禁。

当前收口：原调度镜像本体 0166 兼容验收通过；两库快照及原 QQ 允许列表已取得；本批启动任务静态分类未发现项目重启动作。仍未放行部署：四个目标/回退镜像服务器缓存均未就绪；正式私有部署记录及覆盖文件尚未在服务器准备；新鲜双库备份尚未创建；生产论文 worker 与另一测试项目论文 worker 的持久关闭范围及实际控制入口仍须落实。备份命令和升级/回退工具已本地验证，任何服务器准备写入、关闭论文、重启或迁移均未在本轮执行。进入未来准备阶段前先以具体交付文件和动作清单请求授权，切换时重读现场并使用空闲/备份门禁，不沿用当前快照充当永久放行证据。

网站库仍为 163 / 0163，事务 read_only=on。Agent active；计划 enabled=true、未暂停、每日上海 10:00，workflow_version=4，last_fire_at=2026-11-22T02:00Z、next_fire_at=2026-11-23T02:00Z。账户、9 条授权、旧自动化设置及策略哈希与此前一致；旧自动化 enabled=false，不能据此关闭独立已启用计划。当前 catalog_hash 使用 JSONB/MD5，为 9ffc6905524cf5d091ecacb59aed05ff，与此前按规范序列算 SHA256 的算法不同，不能直接比较为迁移漂移。

agent_runs failed20/succeeded33；blog_runs failed1/published7；schedule_fires failed8/succeeded8。run_stages cancelled72/failed20/succeeded207，无非终态；执行租约空。runtime_outbox delivered230；预算 settled59，累计 calls59/input393333/output175000/cost3215000microUSD；provider_calls failed1/succeeded58。论文 executions cancelled1/failed4/succeeded1。论文队列表存在，但采集错用 status 列，错误42703；已依据0150迁移核对正确列为 state，待补查该一项，不把查询失败当作空队列。

QQ 库 read_only=on，messages delivered10，settings/control_settings 指纹与此前一致。control revision3、login_revision14、enabled=true，群905757031，既有 allowedUsers 为495469022和52399347。此为保留现有访问范围的证据，不能只迁移第一个测试用户，也不能增添其他用户。新 Agent participants 与 QQ agent_links/deliveries/image_pages 表尚不存在；后续迁移采用现有允许者仍须通过审核，不改当前权限。尚未迁移、备份或修改任何线上数据。

### 用户返回的服务器启动入口截图复核

后续详情截图：采集 errors=[]、queueTruncated=false。mooyu-qq-backup.service 引用 /www/mooyu-qq/backup.sh；timer 每日 04:20、Persistent=true，当前 active/waiting。backup.sh 匹配 pg_dump 和命令替换，未匹配 Docker start/restart/run、Compose up/start/restart、systemctl start/restart/enable、pg_restore 或论文引用。两条宝塔任务引用 acme_v2.py、log_task_analyzer.py，未匹配上述项目启动动作。结论仅为静态模式检查未发现项目重启命令；不能把命令替换、变量命令、间接调用均视为已证明安全，也不据此自动开启完整入口审核门禁。备份与宝塔任务保持原样，不应因部署关闭。

本次截图中原 API、Web、QQ worker、网关和调度镜像与此前基线一致；Git 分支及提交仍为 codex/agent-blog-draft-mvp-next / 9f98c06f…，仅 deploy/qq/__pycache__/ 未跟踪项。四个目标 API、worker、Web 和回退 API 镜像缓存查询均为 false，因此发布及回退镜像尚未在服务器就绪，不能进入升级。

论文研究 worker 仍运行、restart=unless-stopped、AGENT_PAPER_RESEARCH_WORKER_ENABLED=true。额外发现 mooyu-desktop-business-test 项目的 business-paper-worker（desktop-paper-study-worker.mjs）在运行，restart=no，PAPER_STUDY_ENABLED=true。不能修改与本次业务不同的测试项目；先识别其所属范围，再决定是否需单独纳入论文关闭方案。API 和 QQ 四开关为 false 不能证明这些独立 worker 已关闭。

扫描未报告非 Docker 候选进程，错误及超大跳过文件为空，但这只是本批扫描范围内结果，不是完整入口审核通过。发现 mooyu-qq-backup.timer 已启用及关联 service、root crontab 和两条宝塔任务候选；需进一步分清备份只读/写归档动作与服务重启动作。systemd 的 pcr/machine 等系统单元因文本匹配进程管理关键字进入候选，不能据此认定它们是项目调度服务。Docker 服务本身的开机启动保持原状。

2026-11-22 已取得用户授权导出的原镜像，下载文件 SHA256 与服务器回执及校验文件一致：`84ebc76206235a1e6d05a74e9ba9f06c9522af183fe0d90d169852aa12b764f6`，大小 234950144 字节。只读归档检查通过，34 个 OCI 内容块及引用完整，linux/amd64 运行镜像为原 ee818f…，28 层，无导出标签冲突。

已在本地导入该镜像本体，使用原入口和镜像自带源码，在全新内部网络、PG16.10 合成 0166 双身份测试库上验收通过：领取/续租/结算、真实调度 CLI 激活、重启、启用及暂停计划、权限、策略和合成历史均正常；模型调用与新增自动任务均为 0。没有接触现有本地容器或线上服务。本轮测试资源已清理。

结果与可供门禁读取的证明位于 `E:\CodexData\build\Right\agent-server-preflight\20261122\original-image-acceptance-r1\result.json`、同目录 `scheduler-original-image.acceptance.json`。证明 SHA256：`3899c04f1ab05e3e839924ae50b7d9165447100792e9a115c7030b41ba69abdb`。这解除原镜像兼容性阻断，不代表允许部署。

剩余待现场确认：主机及容器启动入口、当前镜像缓存和 Git 状态、最新配置与双库业务状态、旧 QQ 白名单绑定。新鲜双库备份及实际论文持久关闭属于后续获准变更阶段；目前仅准备方案。`allExecutionServicesInventoried`、参与者采用审核开关仍保持 false。原镜像兼容性证明已具备，但示例配置不自动改写、证明不自动上传。

下一批只读命令由 `scripts/agent-server-execution-readonly.py` 生成，交付文件 `E:\CodexData\build\Right\agent-server-preflight\20261122\original-image-acceptance-r1\server-startup-readonly-command-v2.txt`。扫描 Docker/主机进程、systemd、cron、宝塔任务和进程管理器候选，不执行任务或输出完整命令与环境；服务器实际运行结果尚待用户反馈，不能声称入口已经清点完成。

下文保留此前排查过程；其中“原镜像未取得/未通过”均为本次验收之前的历史状态，以上述最新结论为准。

本轮范围：本地原镜像验收准备与服务器只读复核。不修改线上服务、配置、权限、计划、登录卷或数据库。用户确认继续宝塔终端输出方式；没有附加的服务器终端、SSH 或已知镜像仓库通道。

## 已确认和已修正

1. 本机 Docker 不包含原调度镜像 `sha256:ee818f213525cb81a984c4c7dba8c4b4096a85e7d22da3c98df06dcb1bce2843`。本地原发布 tag/未打标签缓存及现有 E 盘镜像归档未找到对应原镜像。本轮没有尝试从猜测仓库拉取，也没有创建远端导出文件。
2. 新增 `scripts/verify-original-scheduler-image.mjs`。默认只验收上述不可变原镜像；镜像缺失时在创建测试网络/数据库前报告 BLOCKED。若使用本地兼容旧 API 镜像开发验证，结果强制标为 `development-surrogate` 且 `productionImageEligible=false`，不冒充原镜像证据。
3. 该入口不挂载替换应用源码，使用镜像自带 Node、应用及依赖。先核对 70 模块源码指纹，在新的内部网络及 PG16.10/0166 合成库上验证计划保留、领取/续租/结算、暂停计划不领取、真实 CLI 激活及进程重启。身份和密钥完全合成，不调用真实模型或 GitHub。测试结束仅清理本轮标签所属资源。
4. **发现并修正 R1 的真实门禁误报**：调度器心跳写入 `agent_schedules.config_json.worker`。只排除 updated_at 仍会把正常心跳/进程实例变化误判为计划被修改。修订版仅从比较中排除 updated_at 与 config_json.worker，其他计划字段、enabled、next_fire_at、last_fire_at、暂停配置、时区、规格、权限及策略全部保留比较。
5. 完整开发验证已通过：使用不可变旧 API 镜像 c8243f…，实际调度 CLI 在合成 0166 上正常激活，两计划的启用/暂停及执行时间不变，重启后心跳实例变化但保护的计划不变；领取/续租/结算成功；没有新自动 fire、模型调用或文章。结果位于 `E:\CodexData\build\Right\agent-server-preflight\20261122\original-harness-development-d\result.json`。**此结果不是原调度镜像本体验收通过**。
6. 部署工具现在要求 scheduler 的 `schema166CompatibilityEvidence` 指向实际原镜像通过报告：scope 必须 original-image，productionImageEligible=true，imageId 与当前角色完全相同，schema=166，且真实 CLI 激活、重启保留计划、未挂载替换源码均通过。光改 schema166Compatible=true 不能放行；证据文件被替换也阻断。
7. 修订门禁 14 项本地测试通过，含开发替身/错误镜像/源码挂载证明拒绝及证明文件漂移拒绝。日志 `E:\CodexData\build\Right\agent-server-preflight\20261122\scheduler-gates-r2\local-tests-final.log`。

## 仍需现场证据

| 阻断 | 当前结论 | 只读解决途径 |
| --- | --- | --- |
| 原镜像本体验收 | 本机缺少 ee818f…，未通过 | 宝塔查询当前镜像完整 ID、平台、RepoDigests，并列出现有镜像归档；有现成归档时只读取得到本地，核对镜像 ID 后运行真实原镜像验收 |
| Docker / 非 Docker 执行入口 | 历史容器名单已核对；主机进程、systemd、cron 尚未完整复核 | 仅读取实际命令中的已识别脚本名称、单元状态与引用，不打印完整命令行或环境；所有候选都审清前 allExecutionServicesInventoried 维持 false |
| 当时现场变化 | 已有截图是较早快照 | 切换前重新核对镜像、完整 Compose 链、文件指纹、登录卷与网关启动时间、Agent/授权/计划指纹、队列/租约/回执/预算；旧截图不能当作永久空闲证据 |
| 新版镜像在服务器可用 | 本轮未导入，也没有新的现场查询证明 | 只读 image inspect 按统一发布包完整 ID 核对缓存；缺失时列为未来获准准备阶段的导入事项 |
| 新鲜双库备份 | 历史备份初检通过，本轮未创建线上新备份 | 备份命令与本地恢复已验收；获准进入变更准备后创建，迁移前再于停止相关写入进程后生成两份有效备份 |
| 论文持久关闭 | 旧现场独立 worker 开关 true，本轮未改变 | 保留已验证的 restart=no、六开关 false、退出入口与禁用 profile 方案；正式变更阶段才执行，不在本轮只读复核中擅自关闭 |
| QQ 原白名单参与者绑定 | 仅有原允许列表策略指纹，新表尚不存在 | 只读确认旧白名单、enabled 和撤销状态；迁移仅采用旧允许者，不新增用户或覆盖撤销，审核完成前 adoptLegacyQQParticipants 维持 false |

## 宝塔终端当前采集批次

```bash
scheduler_image=$(docker inspect --format '{{.Image}}' \
  gamehub-production-agent-blog-public-scheduler-1)
docker image inspect --format \
'ID={{.Id}}
平台={{.Os}}/{{.Architecture}}
仓库摘要={{json .RepoDigests}}
镜像标签={{json .RepoTags}}' "$scheduler_image"

find /www/backup/gamehub -maxdepth 3 -type f \
  \( -iname '*images*.tar' -o -iname '*images*.tar.gz' \
     -o -iname '*unified*.tar.gz' -o -iname '*release*.tar.gz' \
     -o -iname '*mooyu*.tar.gz' \) \
  -printf '%TY-%Tm-%Td %TH:%TM  %s 字节  %p\n' \
  | sort -r | head -n 15
```

这组仅查询元数据和现有文件，不导出新文件、不读取凭据、不加载镜像或重启服务。如果没有已发布摘要或现成归档，必须先明确获取原镜像的下一步方式，不能将源码替身结果升级为原镜像通过。

## 发布状态

R1 附加包保持原文件与历史，但发现的心跳误报使其不再作为正式部署候选；使用修订工具重新生成新私有记录，不能原地替换已冻结记录的工具文件。旧业务镜像发布包及原兼容回退镜像均未改变。当前没有生产原镜像 PASSED 证据、线上私有切换记录或部署授权，不得宣告所有阻断清除或执行上线。

## 新返回的镜像来源信息

证据截图 `E:\CodexData\temp\codex-clipboard-6a916475-178d-460e-949a-09b226c1b83e.png`：原调度镜像仍为上文 ee818f…，平台 linux/amd64。RepoDigests 显示 `mooyu-release@sha256:ee818f…`，未给出注册表主机，不能据此认定该镜像已发布到可拉取仓库。

服务器保留了多份现成归档：当前 QQ 兼容包 payload/images.tar、三个 update-qq-admin 包的 payload/images.tar、旧 paper-* 回退 images.tar，以及 mooyu-qq 和 incoming/mooyu-unified 的压缩包。**尚未核对其内容，不将“有镜像归档”当作“包含目标镜像”**。

下一步只读取裸 images.tar 的 manifest.json，并按 Config digest 与目标镜像 ID 精确比较；未知格式单独报告，不能当成不存在。压缩业务包先不全量解压、下载或导入。若裸归档不含目标，继续根据已有压缩包内的嵌套镜像位置查找，始终不创建远端新导出文件。此批证据没有刷新其他队列/权限/执行入口状态，也没有改变论文 worker。

后续截图 `E:\CodexData\temp\codex-clipboard-02a01082-18d4-4bfd-96c4-50c9484186db.png` 已确认 6 份裸镜像归档均 ABSENT：QQ 兼容包 4 个镜像、三个 QQ admin 更新包各 3 个镜像、两个旧论文回退包各 2 个镜像；没有 UNKNOWN，匹配路径为空。它们不作为原调度镜像来源，不下载或加载这些无关归档。

尚未排除 incoming 中 3 份 `mooyu-unified-20261116-*.tar.gz` 统一业务包。下一批以较低 CPU 优先级、每包时间上限，顺序读取压缩包中已有的嵌套镜像清单；只读流处理，不解压落盘、不创建远端文件、不重建服务。超时/格式不支持按 UNKNOWN 报告，不据此认定目标不存在。原镜像验收仍保持 BLOCKED。

再后续截图 `E:\CodexData\temp\codex-clipboard-888117fb-8a8b-41d8-921d-0c0bb2b0cec4.png`：三个统一压缩包均 UNKNOWN，nested 为空，只列出 agent/gamehub-dsh-plugin-*.tgz 与 latest.tgz 未检查成员；不是超时，也没有找到可用镜像。不能把 UNKNOWN 改为 ABSENT，不能当作镜像来源。

下一条低开销只读路线：查询原镜像 RootFS 完整有序层摘要和原始 image-config 内容地址文件是否已存在。与本机所有 Linux/amd64 缓存镜像的层序列前缀作精确摘要比较；只有序列完全匹配，并取得经原 imageId 校验的原始配置字节，才有可能从既有层恢复相同的不可变镜像。摘要不匹配时不得重编译源码或声称原镜像通过；未取得配置字节前也不执行镜像重组。仍不创建远端导出文件、不读取运行时 .env 或登录卷。

截图 `E:\CodexData\temp\codex-clipboard-9a6406e0-192b-4940-886b-77dbd0fe3958.png`：原镜像 linux/amd64、RootFS 28 层，完整层序列 SHA256 `0f4b52b5eae281b2a60c5f01ee940c91e71a55416854e766ba6dfdbf2c9ca864`；与本机 229 个镜像的序列前缀索引没有匹配。服务器存在 `/var/lib/containerd/io.containerd.content.v1.content/blobs/sha256/ee818f213525cb81a984c4c7dba8c4b4096a85e7d22da3c98df06dcb1bce2843`，856 字节，内容 SHA256 与 imageId 相同。该大小不支持直接假定是包含 28 层 diff_ids 的 config JSON；下一步辨认 mediaType、manifests/config/layers 描述符，禁止未经解析就称为原始配置。

**更正归档排除范围**：此前 6 个 ABSENT 仅代表 Docker 兼容 manifest.json 的 Config 摘要不等于目标；若目标 ID 实为 OCI index/manifest digest，该比较不能排除对应 OCI 描述符或 blob。需补查 OCI index/manifest 引用和实际 blob 摘要；原先“已排除 6 个镜像来源”的结论不再作为全面排除证据。至今没有导入、重组或放行任何原镜像。

## OCI 补查结果与受控导出准备

最新截图 `E:\CodexData\temp\codex-clipboard-d683b9b8-c417-48dd-8902-074fb887cac2.png` 确认 rootMediaType 为 `application/vnd.oci.image.index.v1+json`，已读取所有被列出的清单元数据，无 missingMetadata。两个旧 paper 回退包仅命中 config `44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a`；其余 4 个裸镜像包没有目标元数据匹配。

本机直接计算已确认 `44136f…` 是两字节空对象 `{}` 的 SHA256，是可复用的附属/证明配置，不能证明包含实际调度程序。不能将这两个 METADATA_MATCH 升级为原镜像 FOUND。非空运行配置摘要及原 OCI 索引/清单在本批归档均无命中；本机没有完整 28 层序列匹配。原镜像仍未取得。

准备了 `deploy/agent-plugins/export-original-scheduler-image.sh`，**尚未在服务器执行**。它要求源容器仍绑定同一个原镜像 ID、可用空间至少原逻辑大小的两倍再加 1 GiB，然后只在 `/www/backup/gamehub/scheduler-image-ee818f213525-随机目录/` 创建私有归档与校验文件。新目录 0700、文件 0600；低 CPU 优先级读取不可变镜像，验证导出包含原 OCI 根对象且摘要正确，检查源镜像未在过程中变化，最后生成整包 SHA256。失败保留新建 partial 文件，不清理历史备份。

命令不含停止/启动/重启容器、修改 restart 策略、加载/拉取/推送镜像、操作数据卷、配置改写或数据库恢复。只导出镜像本身，不导出运行中容器或挂载数据。取得并导入本地后仍须完整原镜像验收，不因导出成功就放行上线。

4 项本地测试通过：使用无网络、无 Docker 套接字的一次性容器及模拟 Docker/合成 OCI 文件，验证成功路径的私有权限与校验和、源镜像变化提前拒绝、磁盘不足提前拒绝、错误/共用对象不能变成完整导出。测试证明脚本保护逻辑，**不声称已执行真实服务器导出**。

由于当前约定为服务器只读复核，创建这个新归档目录属于需要单独授权的动作。已向用户异步请求仅导出该镜像的授权；收到明确答复前不提供为已获准执行、不创建远端导出文件。其他执行入口、最新队列及权限/计划状态仍需按只读方式复核，论文持久关闭仍是未来部署方案。

### 已授权的单镜像导出完成

用户明确授权：仅在新的私有目录导出此原调度镜像与校验文件，不重启服务、不修改原有配置、数据库、权限、计划或登录数据。已提供受控命令，由用户在宝塔执行。

截图 `E:\CodexData\temp\codex-clipboard-1af9da1e-0d30-4d23-a398-695ac7069e3f.png` 显示“导出及初检完成”，原 OCI 根对象摘要验证与 tar 目录读取通过；归档名 `original-scheduler-ee818f213525.tar`，234950144 字节，SHA256 `84ebc76206235a1e6d05a74e9ba9f06c9522af183fe0d90d169852aa12b764f6`。远端随机私有目录及两个文件路径以该截图的 Archive/Checksum 输出为准，不猜写随机目录名。

尚未取得本地归档，原镜像完整运行验收仍未通过；仅从“没有可取得的原镜像包”推进为“已有导出包，待下载并独立复核”。本地接收目录 `E:\CodexData\build\Right\agent-server-preflight\20261122\original-image-download`。用户通过现有宝塔文件管理下载 tar 与 sha256 后，需校验文件大小、完整 SHA、原 OCI index、引用完整性及本地 tag 冲突，再导入独立验收；不能只凭成功截图就置 schema166Compatible=true。

此授权不包括上线、服务器镜像导入、数据库/配置改写或关闭论文。后续仍按只读方式复核其他执行入口与最新现场；持久关闭论文仅保留方案。
