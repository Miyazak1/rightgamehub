# 上线 GitHub 任务失败：调度协议兼容修复

## 已确认原因与范围

用户现场只读回执显示：github-search 子任务 failed，error_code=AGENT_INTERACTION_SCHEDULER_UPGRADE_REQUIRED、run_id=null、attempts=1；父message任务completed。日调度enabled=true、state=waiting、心跳新鲜，但interaction_protocol=null。GitHub discover/read、provider.text.generate、blog.article.draft授权均active。

因此直接失败原因是新版任务执行前的调度协议检查，不是这条问题超出GitHub能力、QQ离线、GitHub关键词、用户未授权或模型不会回答；本条研究运行尚未创建。旧调度镜像在166下原定时业务可运行，不能推导新版交互兼容，此前验收漏了该条件。

旧版的pending恢复查询还可能选中agent-interaction-v1的交互检查点。不能通过手写config_json.worker.interactionProtocolVersion=1、删除新执行器检查或给用户加权限来解除阻断；那会留下旧调度器与新任务执行器互相接管的风险。

## 最小候选与差异

从原不可变镜像ee818f213525cb81a984c4c7dba8c4b4096a85e7d22da3c98df06dcb1bce2843派生；新候选为sha256:99f6306de9c83f444eb5a07b2fa78562171d49394c2a98b5dc9743f879f0872f，本地标签mooyu-agent-scheduler:20261123-interaction-compat-r1。

70个调度源模块中68个完全不变，只有两处严格锚定原文件SHA的替换：

1. agent-blog-public-request-repository.mjs：pending查询排除snapshot_json.executionSource=agent-interaction-v1；原定时文章/旧手动文章恢复路径保留。旧fallback查询已有检查点NOT EXISTS约束，新交互先建检查点再建run，因此不会经该fallback被接管。
2. agent-blog-public-schedule.mjs：由真实运行的兼容调度器心跳声明interactionProtocolVersion=1。不在运维脚本中修改数据库标记。

原入口、运行配置、依赖及原镜像层前缀完全一致，无源码挂载，无重新构建API或QQ worker。原图谱SHA为72cb11e1d230bfa0627ae36d2accfdc5a3d92b460e41e694544d024c63b93ec8；兼容图谱为c187427db31175317a60daca7bf6e3909f6fc2141b7f2f42dfe8a9f84664d943。验证拒绝未知原文件、非两模块修改和二次打补丁。首次BuildKit把FROM sha256:ID误解为仓库名而失败，旧输出保留；采用经过ID核对的新本地别名后r2构建成功，原标签未改。

## 实际本地验收

证据：E:\CodexData\build\Right\agent-server-preflight\20261123\scheduler-interaction-compat-acceptance-r1\result.json，实际进程退出码0，PASSED，scope=original-image-interaction-compat。

- 新建带专属标签的内部网络与合成PG166，不连接线上、真实QQ或外部模型。
- 用原镜像实际repository复现会选中交互检查点；用真实新版GitHub执行器复现AGENT_INTERACTION_SCHEDULER_UPGRADE_REQUIRED。
- 兼容镜像实际repository排除waiting及running且租约过期的交互检查点，仍能返回正常旧公开任务；事务回滚保留测试基线。
- 由候选真实heartbeat写入协议后，真实新版执行器通过该检查并进入输入快照步骤（用合成LOCAL_AFTER_PROTOCOL哨兵停止，未创建研究运行或调用模型）。这证明已解除本次前置条件，**不冒称完整GitHub查找已经成功**。
- 两个真实原CLI实例分别保留启用与暂停计划，正常激活，在候选容器重启后心跳实例更新；时区、规则、计划时间、权限、策略、合成历史均不变。
- 原repository claim/renew/finish流程通过；真实providerCalls=0、额外自动fires=0；只有本次带标签资源被清理。
- 两项补丁边界单元测试通过，实际原源码作为测试输入，无跳过。

## 拟线上范围与仍需授权

仅切换gamehub-production-agent-blog-public-scheduler-1到该候选镜像。保留当前同一Agent、环境/密钥引用、完整有序Compose链、网络、挂载、限额和日计划；两套论文继续关闭。不重启QQ登录网关、API、QQ worker、共享执行器、数据库或桌面服务，不清理/迁移任何数据，不扩大权限/预算，不修改旧锁记录。

前置仍需真实任务与调度空闲、避开10点触发窗口、记录新维护快照与可回退镜像。切换后由调度器自身生成新鲜协议心跳，再由用户新发一次查找请求验收。原失败记录保留，不能改回queued自动重试或重复投递。原“最新开源生图模型”的时效性和结果质量也应通过真实检索验收，不能仅凭协议通过声称满足。

回退仅在交互任务/旧日任务安全空闲后恢复原调度镜像；不恢复数据库或撤销schema，QQ登录不受影响。回退后GitHub交互前置条件重新不满足，应明确提示暂不可用，不能伪造标记。切换和回退均必须在新的私有维护记录下进行，不能修改此前锁定发布记录。

此前授权保留原调度镜像，本次会替换该服务镜像，因此上线前需对上述新范围明确授权。当前只完成本地候选与验证，未上传、未更改任何线上服务。
