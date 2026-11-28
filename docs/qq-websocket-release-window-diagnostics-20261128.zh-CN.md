# QQ 网关发布窗口只读诊断（2026-11-28）

上传的 `qq-websocket-owner-20261127-r1` 发布包在 `plan/preflight` 返回
`ACTIVE_OR_UNCERTAIN_WORK_NO_RETRY`，且 `workerStopIssued=false`、
`gatewayStopIssued=false`。该结果表示窗口检查阻止更新，不能据此认定网关修复已经应用。

首轮只读报告中，其余被检查的任务、发送和关联表均为 0；
`agent_runtime_outbox` 有 139 条非 delivered 事件，其中 70 条符合旧历史保留规则，
另有 69 条仍阻塞。该报告不包含这 69 条的具体分类，不能据此认定它们可忽略。

## 下一条命令

由 `scripts/qq-websocket-outbox-readonly.mjs` 的 `wsOutboxReadonlyCommand()` 生成。
打开交付的 `server-outbox-classification-readonly.txt`，复制全文到宝塔终端执行一次。
无需重新上传、解压或替换发布包。

命令先核验上传目录的 `SHA256SUMS`，使用已有私有 Node 22，
从已校验发布包导入只读数据库访问器与原 outbox 判定 SQL。
以单条 SELECT 对所有非 delivered 事件分类，保证本次 outbox 汇总来自一个语句快照。
数据库会话启用只读、8 秒语句超时和 1 秒锁等待超时。
最多输出 80 个分类；超出时明确报告 `groupsTruncated=true`，计数仍覆盖全部事件。

报告仅包含工作流、阶段、事件状态、次数、租约是否存在、关联是否一致及创建时间范围。
不输出 payload 正文、消息、错误原文、凭据或二维码。
终端中最后的 `outboxSummary`、`outboxGroup` 与最终 result 可用于后续核对。

## 判读与边界

原保留规则仅覆盖两个旧工作流 `blog.project.discovery-shadow`、`blog.project.single`：
还必须同时满足运行和阶段已成功、运行有结束时间、事件 pending 且次数为 0、
没有事件租约、payload 的 run/stage/key 关联完全一致。

新工作流名称或终态不同只是可能的阻塞原因。必须根据分类结果继续核实，
不能仅凭名称把所有事件放行。查询不认定发布窗口通过：`releaseWindowApproved=false`。
此报告也不代替执行更新前的完整窗口重查。

不投递、不删除、不修改事件，不重试旧任务，不修改旧锁或恢复计数，不重启服务。
本次源码诊断跟进不改变已上传的 r1 归档、发布源标签、运行镜像或线上配置。
不得在当前受阻状态执行 upgrade，或以手工改数据库来绕过检查。

## 本地验证

只读分类与已有窗口规则、Bash/Node 解析共 8 项回归通过。
另以新建、无网络的 PostgreSQL 17 容器验证 1 项真实 SQL 集成测试：
空表、70 条旧保留事件、69 条新工作流事件，以及失败、活动、带租约、
有尝试、孤立关联、payload 不一致和分类截断场景。
查询前后记录指纹一致；测试容器仅保存合成数据，不连接线上。
该集成测试验证查询使用的列与分类逻辑，不代表生产事件已被判定安全。
