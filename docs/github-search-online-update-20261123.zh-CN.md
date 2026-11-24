# GitHub 通用搜索：已授权线上镜像更新交接

用户在本地功能验收后明确要求直接线上更新测试。本轮授权范围仅为生产 API 与共享交互执行服务，不提高预算，不重试旧失败任务，不重启调度、QQ worker、登录网关、数据库或桌面服务。两套论文保持持久关闭。此前本地真实模型验收目标已由用户暂停，不启动其停用容器，不重置其累计用量。

用户现场只读回执确认：生产 schema 166，无 queued/running/waiting 交互，无非终态 run；20条待通知事件均不阻塞。调度协议1，下一次计划为2026-11-24 10:00上海时间，计划保持启用。API 与 agent-interactions 均为基础镜像 `sha256:b67910da86d687e0485b14b583ce31ac814a89f9421069abe125ce36b69c7abe`；原生产和桌面论文 worker 均停止且 restart=no。

## 交付内容与本地验证

候选镜像 `sha256:8f72cb8afcbfe2fb33730c467668f007b6cdc23a8a1a3f9c70851155efcab1e2`，标签 `mooyu-github-search:20261123-r1`。在现有不可变基础镜像上仅复制本轮9个API源码文件，运行配置完全保留。逐文件SHA在实际镜像中验证；没有新增迁移或复制任何本地.env、账号、登录卷或凭据。

本地实际候选镜像（没有以源码挂载覆盖应用）通过14项断网PostgreSQL检查，包括新增搜索完整链路、原文章/源码追问与维护SELECT契约；4项维护流程/窗口/配置/专用QQ库引用测试通过。新的内网合成Compose项目实际演练两服务切换与镜像回退，环境、命令、网络别名和数据卷保留，第三服务未重启，测试资源清理完成。模型与Github响应在数据库测试中为合成数据，真实模型验收仍待线上小范围完成。

本地交付目录：`E:\CodexData\build\Right\agent-server-preflight\20261123\github-search-release-r1`。

## 服务器执行顺序

将包与同名.sha256上传到新的私有目录 `/www/backup/gamehub/github-search-release-20261123-r1`，然后执行本地生成的 `server-update-api-and-executor.txt`。命令验证外包SHA、逐文件SHA和导入后镜像ID，取得共享运维锁后调用限定双服务更新器。目录已有额外内容、镜像标签冲突或任何校验失败即停止，不盲目重复执行命令。

更新器先读取当前各服务完整Compose链、当前API环境引用和Web下载挂载，验证解析后的镜像及全部环境与实容器一致。新操作记录使用 `/www/backup/gamehub/github-search-operation-20261123-随机后缀`，原三份锁定记录的文件、SHA、权限和执行锁逐项保护，不修改旧记录。

核对schema166、真实空闲及距原计划至少45分钟后，正常停止共享交互执行服务和API，再复核。创建新的API/QQ库保护备份，验证文件大小、SHA、归档目录与完整解码；保留owner与ACL。其他服务继续运行，因此不宣称全库停写或跨库原子快照；本轮不进行迁移或数据恢复。

两个服务各自在原完整Compose链最后追加仅含该服务image字段的新覆盖，使用 `up -d --no-deps --no-build --pull never`。先重建API并验证健康，再用新API内的bootstrap CLI登记新增工具和搜索工作流（不发起模型调用、不修改授权、计划或预算），最后重建执行服务。

前后比较全部其他容器、两套论文关闭状态、原配置文件、锁记录、权限/策略/预算/计划/QQ设置及历史行指纹。比较排除调度器正常变化的worker心跳，不清空或派发已完成通知。成功标志 `GITHUB_SEARCH_UPDATE_VERIFIED`；只完成部署与保留验证，不能当作真实搜索质量验收已通过。

执行期间先不要发送新机器人任务。成功后再发一条明确的多条件搜索，核对实际工具调用、规划是否保留全部要求、来源与逐项结论、最终群回执及无重复。

## 回退和异常

每次新操作记录生成 `rollback.sh`。它以同一双服务范围执行新的受控回退记录，正常停止两服务、验证新的保护备份，再恢复原基础镜像；保留所有新旧历史、用量、权限和新登记的可兼容工具/工作流元数据，不恢复数据库、不删除新记录、不重启其他服务。支持审核过的原/新镜像混合或已停止状态，但配置漂移、未完成任务或窗口不足仍拒绝继续。

任何失败打印 `GITHUB_SEARCH_UPDATE_STOPPED_REVIEW_REQUIRED`、phase、directory和脱敏错误码；没有自动重试或自动回退。先回传实际阶段，由新记录决定恢复路径。不要绕过门禁、清空任务或通知、手动改旧锁。

## 现场中断及受限续接

用户现场已执行更新，停在 recreate-only-api / RECREATED_CONFIGURATION_MISMATCH。镜像和包校验通过、双库保护备份已完成。后续只读回执确认API healthy、新镜像正确、关键运行指纹及原Compose追加链均匹配；解析模型除image外没有变化、全部环境相等、镜像Config保留；其他容器未变化。原执行器仍停止、尚未登记新增搜索工作流。完整原始Docker配置hash不匹配的具体字段未能定位，原记录只保存了该hash而没有完整原始结构；不能宣称完整字段逐字节相等，也不推测某个字段就是原因。

新增 github-search-runtime-verification.mjs 以原冻结Compose模型验证用户可配置的运行语义，包括健康检查、内存/CPU、日志、用户、工作目录、标签、权限、能力、已发布端口、重启策略等；原已审captureRole继续逐项验证环境、挂载、网络、命令，并要求原关键指纹和有序Compose链匹配。未知服务字段、任何已审核项差异均拒绝继续。Linux的自动附着元数据及等价绑定字符串顺序不再作为业务配置相等的唯一依据；不回填或篡改原hash。

resume-github-search-update.mjs 只允许从当前API引用的该失败记录续接；保持API健康且不再重建API。在新续接记录中保留验证证明，重新核对原备份、包与记录SHA、旧锁、任务空闲、计划窗口、权限/预算/历史和其他容器状态。然后登记新增工作流并只启动交互执行器，再逐项验证新执行器；不重试任务、不恢复数据库、不改原包或原失败记录。

新检查器3项漂移拒绝/边界测试通过；新内网合成Compose项目的实际切换、回退及逐项模型验证通过。续接命令：`E:\CodexData\build\Right\agent-server-preflight\20261123\github-search-resume-command-r1\server-resume-without-api-restart.txt`。无需重传镜像或解包；命令仅在新的私有工具目录保存两个SHA固定的续接模块。

服务器续接已由用户执行并回传 GITHUB_SEARCH_UPDATE_RESUMED_VERIFIED：API healthy、没有再次重启；executorUpdated、declaredRuntimeChecksVerified、originalReleaseAndOperationUnchanged、permissionsBudgetPlansLoginAndHistoryPreserved、otherServicesUnchanged、papersStillClosed 全为true；databaseMigrated、databaseRestored、tasksRetried 为false。新续接记录前缀 github-search-resume-20261123-，原失败记录保持原样。真实模型/QQ群搜索质量尚未验收，不能将成功部署当作质量通过。

## QQ管理状态读取受限

用户随后报告后台“登录服务不可用”。只读回执：API→qq-control HTTP200、共享管理密钥一致、DNS指向原worker；worker和网关均未重启，OneBot连接connected=true，但新建管理鉴权探针返回QQ_GATEWAY_RATE_LIMITED。不能将此当作账号掉线，也不能因connected=true就认定原生QQ在线。

直接读取与现场相同的不可变网关镜像ac32edd...的编译代码，确认管理凭据有效期3600秒、login_rate按来源IP记录，首次设置60秒删除计时器。该版本缓存set只是更新Map，后续不传TTL不会取消已有删除计时器，不能套用早期版本“计数永久不清除”的解释。限流阈值不改、不清计数，不重新扫码或重启网关；停止新建鉴权探针，允许原worker按已有60秒退避恢复。

本地NapCatControl优化：50分钟内复用一小时有效凭据；普通核心接口失败/超时不清凭据，仅明确Unauthorized触发清除及5秒退避，旧请求不能清除更新后的凭据；原60秒限流退避与并发鉴权合并保留。6项本地鉴权测试通过。此优化仅在本地，未构建或部署到QQ worker，不属于已完成的GitHub镜像更新，也没有重启其他服务。

冷却后状态复查命令server-qq-status-reuse-existing-client.txt只经过现有worker管理客户端，不额外新建NapCatControl鉴权客户端；不调用QQ登录、刷新二维码、修改配置或重启。真实搜索验收等待管理状态恢复。
