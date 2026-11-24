# 本地门禁、升级回退入口与旧 QQ 权限继承复核

范围：codex/agent-server-preflight。本次仅本地修改与隔离合成测试；不上传、不执行服务器命令，不改现有冻结发布记录或执行锁，不切换服务。两套论文关闭方案保留。

## 通知与任务门禁

`agent-server-cutover.mjs` 和只读终审共用 OUTBOX_WINDOW_SQL / assessOutboxWindow。单条 SELECT 在一个数据库语句快照内统计全部非 delivered 事件，不分页、不消费、不删除、不标记 delivered，也不输出载荷。

仅下列全部条件成立的记录计入 retainedCompleted：aggregate_type=stage；event_type=stage.available；pending；attempts=0；lease_token、lease_until 均空；关联阶段与任务均 succeeded；任务 finished_at 非空；工作流仅限已审的 blog.project.discovery-shadow / blog.project.single；载荷 stageId、runId、stageKey 与实际关联记录全部一致。其他事件均 blocking，包括失败、取消、skipped、未知工作流、缺失关联、载荷缺失或绑定错误、重试过、过期租约仍未释放、非阶段事件。统计缺失、非整数、负数或 retainedCompleted 超过 total 都拒绝。

counts 中 outbox 数为 blocking，报告另列 total / retainedCompleted / blocking，避免把保留事件伪装成已投递。原其他任务、预算占用、QQ最终消息、图片页、子任务门禁保留。升级与回退 checkWindow 补查所有 blocked/queued/leased/running/waiting/uncertain 阶段，不能靠根任务结束判空闲。

这些是时点检查，不构成并发停写保证。真正迁移前仍需授权后的停写、二次空闲复查和新鲜停写备份。不得因此停止定时计划、改快照或清理通知。

## 升级与回退入口

- 服务器现有 post-paper 记录仍 executionLocked=true；CLI load() 对所有入口拒绝执行锁记录。未改该判断、状态或现有脚本。
- prepare 的正式模式仍要求执行服务清单及旧 QQ 继承审核；generationOnly 不伪造通过。后续获准操作须使用复核后的工具与新的正式记录，禁止手改旧锁或覆盖冻结工具。
- upgrade 保留主机互斥、现场指纹、有序 Compose 链、不可变镜像、配置/权限/计划指纹；停止既定执行角色后二次检查与备份，迁移仅163→166，bootstrap 后再查业务指纹。网关和数据库不重建。
- abort-before-migration 仅允许完整未变163，使用原163镜像；部分迁移不能反向回退，必须先按既有流程前向补齐。
- rollback 复用相同任务/通知门禁和新鲜备份；166使用兼容回退API，保留新增表、预算、通知、参与者、消息与图片历史，不恢复旧数据库。原调度器按原启停状态恢复；论文关闭覆盖保留。
- 桌面论文 API/worker 属独立项目，本轮不纳入插件切换动作，仍由关闭证明与源链保护核对。两套论文不因回退重新启用。

## 旧 QQ 权限继承

现场群905757031、机器人3922489710，旧白名单495469022与52399347都必须保留。新渠道参与者只是调用资格，不是管理员角色或新的工具能力授权。

legacyQQParticipantStatements 校验唯一策略、显式布尔 enabled、非空且不重复的数字字符串白名单；不拼接不合法输入。只为原白名单生成 INSERT…ON CONFLICT DO NOTHING。已有禁用/撤销记录、can_invoke、revision 和更新人不覆盖；重复执行不新增重复行；原策略disabled时新增记录can_invoke=false。

API authorize 仍读取当前 QQ 策略，核对 Agent、机器人、群、enabled和白名单；GitHub等需要invoke的任务还检查参与者active/can_invoke。QQ身份保持external，后台管理仍需人类管理员及operator匹配。工具网关继续使用原Agent能力授权、风险与预算约束；bootstrap只注册契约/工作流，不新增工具授权、不改定时计划。这里没有将白名单继承为全站管理员或发布权限。

## 本地验证与交付

1. 新建合成PG16：outbox-window-r1已通过26种拒绝场景；outbox-and-qq-adoption-r2额外执行真实继承SQL，既有revoked及revision=7逐字不变、两账号覆盖、重复执行幂等、disabled策略不授予调用资格均通过。源事件哈希不变，无载荷正文输出；仅清理本次标签容器。
2. Linux隔离测试覆盖升级、回退、迁移失败、原调度状态、子任务和图片、冻结记录执行锁、只读命令边界与关闭证明；22项通过。新增证明形状/权限输入拒绝及既有诊断等6项本机测试通过。Windows直接运行Linux路径夹具与96MB tmpfs运行各出现环境不匹配，未当通过；改用无网络只读挂载的Linux容器及2GB tmpfs后完成验证，未降低1GB空间门禁。
3. 新的本地 `server-final-post-paper-readonly-command-v3.txt` 已生成并语法校验；它内嵌新通知分类并使用服务器原只读库，不要求覆盖服务器旧工具。命令尚未运行，不能声称新终审已在现场通过。

仍未解除的执行条件：现场只读复核、实际执行清单审核、新渠道权限继承审核、停写窗口新鲜备份及明确插件升级授权。既有三库在线保护备份不冒充迁移窗口备份。此次本地通过不产生线上执行授权。
