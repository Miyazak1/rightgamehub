# r2 更新后 QQ 收发与恢复配置的只读验收

用户提供的发布输出为 `QQ_WEBSOCKET_UPDATED_SCAN_REQUIRED`，并已确认重新扫码后
群内直接 @ 收到了预期回复。这证明用户观察到的真实扫码和收发恢复；
服务端新消息送达回执、当前恢复守护状态与短时在线采样仍待本命令输出核对。

使用 `scripts/qq-websocket-post-upgrade-readonly.mjs` 的
`qqPostUpgradeReadonlyCommand()` 生成 `server-post-upgrade-readonly.txt`，
复制全文到宝塔执行一次。无需重新上传发布包，不必重发消息。

命令使用上传并校验过的 r2 模块，读取本次 upgrade 记录，并执行：

1. 只读查询升级完成后的指定验收消息，要求直接或关联最终回复具有远端发送回执与预期短语。
2. 校验网关补丁源码、升级镜像、原 worker 容器与镜像、guardian 身份绑定。
3. 校验定时器启用、最近触发、服务最近执行结果、已加载启动命令、unit 指纹及无额外 drop-in；
   对比实际安装的恢复脚本和策略与 r2 中的已验收版本。
4. 约一分钟采样六次，要求状态新鲜、账号和群匹配、已连接，并至少出现两份不同的最新快照。
5. 纯内存模拟十二项恢复策略条件，覆盖三份新鲜样本和六十秒确认、日限两次、十五分钟冷却、
   待扫码、已登录、群检查异常、观测缺失或过期、相同快照、同一故障和人工复核状态。

读取恢复次数和剩余冷却，不清零或保存恢复状态。普通待扫码、观测失败或只有群检查失败，
不能授权重启。一次性 guardian service 正常执行后处于 inactive/dead 属于可接受状态，
仍需 timer 为 active/enabled、最近执行成功并满足其余检查。

本命令不调用 guardian 的执行入口，不创建原生管理客户端，不请求二维码或登录，
不发消息、不重试旧任务、不修改数据库或状态文件、不获取或改写维护锁、不启动或停止服务。
恢复策略的输入为内存副本，模拟不会消耗线上恢复次数。
正常运行中的 guardian timer 仍可能自行更新它的状态；这不属于验收命令写入。

完整通过标记为 `QQ_POST_UPGRADE_READONLY_CHECKS_PASSED`。
`QQ_POST_UPGRADE_READONLY_REVIEW_REQUIRED` 表示存在未满足项，不能据此自动重启或改设置。
`QQ_POST_UPGRADE_READONLY_READ_FAILED` 表示某项读取失败，不把缺失数据当作已通过。

即使只读检查通过，`liveDisconnectRecoveryTested=false` 和 `longTermStabilityProven=false`
仍保持不变：此次没有人为切断线上连接，不把策略模拟、配置检查或短时采样描述为
真实线上故障恢复或长期稳定性验收。

本地验收：27 项主机测试与 1 项隔离 Linux guardian 测试通过，无失败或跳过。
生成命令使用只读文件、Docker 和 systemd 夹具验证；缺失送达回执、关闭 timer 或策略版本不同
均不能通过。Linux 测试无网络、无 Docker 套接字，Docker 操作为模拟，但实际生成并解码合成登录备份。

这是源码中的独立只读跟进。r2 发布归档、源码快照标签和 388 文件发布清单均保持不变，
新增工具和测试通过专用分支与 PR 同步；不包含论文开发或生产配置变更。
