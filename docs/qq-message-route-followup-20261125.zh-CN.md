# QQ @ 无回复：现场只读结果与下一步

本轮截图报告的读取时刻是 2026-11-25T11:29:18Z，即北京时间 19:29。

## 已有证据

- 网关未重启，worker 当天 13:01:30 启动、13:01:35 建立 reverse WebSocket；两者当前运行。
- worker 原生观测 fresh，ready、loggedIn、coreReady、accountMatches、groupReady、connected 均 true；执行模式 agent，lastFault null，论文 false。
- 磁盘中的网关上报目标、array 格式正确。磁盘配置和连接不等于某一条消息已经上报。
- 两位白名单用户匹配；平台入口授权 can_invoke=true、status=active，未被撤销。
- worker 汇总 45 条历史 delivered；最近 24 小时、当天消息数和事故窗口收件查询均为空；平台最近及事故窗口 interaction 也为空。
- 日志摘要有连接和启动，没有 admission、admission-failed、worker-waiting。日志没有完整记录被忽略的事件，不能据此证明网关完全未上报。
- 有 QQ_OBSERVATION_WORKER_UPDATED_VERIFIED 更新回执。

因此，目前定位到“消息入库之前”，不能再次把问题归结为已掉线、失去授权或模型任务失败。45 条累计历史与最近窗口为空不矛盾。事故窗口内没有新增业务记录，但仍缺少原始上报形状及上游收件证据。

## 本地复现出的缺陷与证据边界

当前 parseInbound 允许 text、at；回复某条消息后再 @ 会带 reply 段，当前解析器返回 null。直接 at+text 的相同消息能通过。测试明确复现这个静默过滤缺陷；尚未确认用户 13:05 的消息包含 reply 段，不把可能原因当作已确认根因。

下一条命令只读一次原群最多 100 条历史，最多一次管理鉴权，只输出事故窗口账号 9022 的时间和消息段元数据，以及该账号最后五条记录的形状。消息正文、其他人记录、令牌、原生错误和二维码均不输出。没有发送、已读标记、修改配置、QQ 账号登录、恢复、重试或服务重启。所有接口共用 15 秒截止时间，失败不重试。

历史接口的数据不是 reverse WebSocket 原始事件；即使历史消息有 at 段，也不能单独证明它已上报给 worker。返回范围也不保证覆盖完整事故窗口，空结果不表示用户没有发送。

运行内容来自 scripts/qq-group-history-shape-readonly.mjs 的 HISTORY_SHAPE_PROBE，可直接通过 docker exec 执行，不依赖上传发布包。四项本地测试验证解析器缺陷、脱敏、调用边界与错误处理。线上运行代码未改动，现有功能、权限、预算、定时计划、登录与历史、旧锁定记录、两套论文关闭状态保留。

接口参考：[NapCatQQ get_group_msg_history 官方仓库问题记录](https://github.com/NapNeko/NapCatQQ/issues/863)。接口返回条数可能不足指定数量，因此诊断始终保留范围限制。
