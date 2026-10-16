# Courseware Embed v1/v2 E0.5 验收样本

本目录用三个不同 loopback origin（两个相互独立的外站宿主 + 一个课件运行源）证明已有 Courseware v1 包无需改变即可嵌入，并演示增量 Embed v2 的体验模式切换与状态迁移。宿主页只连接外层参考网关；网关加载原始 `dist/index.html`，把 `mooyu.learning.v1` 消息收敛后经专用 `MessageChannel` 发送。冻结的 v1 不变，v2 由宿主显式协商。

启动：

```bash
node scripts/start-courseware-embed-acceptance.mjs
```

默认宿主为 `http://127.0.0.1:4173` 和 `http://127.0.0.1:4175`，课件运行源为 `http://127.0.0.1:4174`。逐一打开终端输出的六个页面，可验证同一固定课件 Release 在两个不同宿主中行为一致；即使宿主不接 Host SDK，课件 iframe 仍应可以正常学习。

## v2 双宿主状态验收

1. 在第一宿主打开数学样本，切换“自由实验”，修改系数并点击“导出状态”；
2. 复制诊断区生成的 JSON；
3. 在第二宿主的状态框粘贴 JSON，点击“恢复状态”；
4. 确认体验模式、系数、探针与显示开关一致，日志出现 `host.restoreState.applied`；
5. 修改 JSON 中的 Work/Release、加入自由文本或超限对象，确认恢复失败且现有现场不被部分覆盖。

v2 快照绑定 Work/Release，总大小不超过 64 KiB；变量与对象数量、键名和属性均有上限。状态只能表达课件允许的标量、对象和脱敏进度，不能携带答案原文、身份、完整 URL 或任意嵌套数据。

## 自动门禁

- 只接受 HTTPS 父来源；本目录的 loopback 是唯一开发例外；
- 固定 Release 必须精确匹配 Release ID，不能静默换版；
- `disabled`、`withdrawn`、`suspended`、`revoked` 均 fail-closed；
- 消息必须是 32 KiB 内的严格 v1 信封，未知字段、事件、命令拒绝；
- 通道持续超过每秒 20 条会关闭；
- 网关验证 `event.source`、精确 origin 和移交的端口。

## 数据字段与隐私审查

允许发往外部宿主的字段只有：Work/Release ID、语言、能力名、场景/检查点/目标 ID、尝试次数、有限结果枚举、粗粒度时长、尺寸和有限错误码。中继明确丢弃 `interaction.changed.data`、答案原文、自由文本、外部完整 URL、身份、邮箱、学校、图片、聊天、堆栈与内部路径。

进度只允许三个已完成 ID 列表，并绑定同一 Work/Release；不接受任意对象。外部宿主必须把进度视为不可信输入。

## 人工验收

在 Chrome、Edge、Firefox、Safari 中记录：普通 iframe、协议连接、中文/英文、键盘、触控、320 px、200% 缩放和 reduced-motion。浏览器实测记录完成前，E0 只能标记“实现完成、人工验收待完成”。
