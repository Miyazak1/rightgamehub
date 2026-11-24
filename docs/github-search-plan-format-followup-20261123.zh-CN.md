# 搜索规划格式失败后续

服务器只读证据：run `23102384-963e-4bd3-be04-38315f1fc854`，workflow `agent.github.search`，plan 阶段失败；provider 外层错误 `AGENT_PROVIDER_OUTPUT_INVALID`，内部错误 `AGENT_GITHUB_SEARCH_PLAN_INVALID`。finishReason 为 stop，token ceiling 5000，实际 outputTokens 514。后续 search/gather/verify 取消，不能宣称该次已搜索 GitHub。

没有保留该次被拒绝的模型原文，因此无法复现其具体字段，也不能把本次防护加固描述为已证明修复了该历史响应。现有证据支持完整返回后格式校验失败，不支持 token 截断或 QQ 登录故障。

本地变更：

- 规划提示增加可执行的完整格式示例、全部必填字段、null 与数字/字符串要求；保留原请求引用、硬条件与偏好区分。
- 规划格式失败错误保留既有 code，message 增加固定 schema 路径与规则名。既有 provider gateway 会保存 error_message，因此后续无需先输出模型原文即可定位。数据库只读诊断也应允许读取固定路径详情；旧的仅接受 AGENT_ 全大写字符串的过滤会隐藏新详情。
- 保持严格校验，不补造模型缺失的需求、不把未知证据当通过、不新增调用预算或自动重试，不改变搜索与论文权限。

测试命令：`node --test tests/platform/github-search-plan-format.test.mjs tests/platform/github-search-quality.test.mjs tests/platform/agent-provider-gateway.test.cjs`，29 项通过。覆盖浏览器 DOM 选择器的用途/运行环境/许可偏好/合集排除，以及离线平台、Stars、Release 时间等通用场景；采用合成模型和网络响应，不等于真实模型或线上验收通过。

当前仅本地修改，没有更新线上镜像、重试旧任务或重启任何服务。QQ 登录刚恢复，后续发布应单独指定 API 和必要的交互执行器，保留网关、QQ worker、数据库、日调度和桌面服务现场，两套论文保持关闭。生产群消息的逐条件证据结果仍是待完成验收项。

## 已授权的交付范围

用户随后要求推送更新以继续测试。交付采用新版本镜像和新私有目录，不改旧包或旧执行记录；只重建 API 与交互执行器，保留现有 QQ 网关和 worker、数据库、日调度和桌面服务。执行入口在空闲和远离日调度的窗口内创建新的 API/QQ 保护备份并完整解码校验，不将这些备份宣称为全站停写或跨库原子备份。没有迁移、权限/预算/计划修改或工作流重新注册；不自动重试失败任务。

候选镜像 `sha256:a48de95df41613c4e0c455850a47cbfd83abfdda052ca4516125e85c780fcf3a`，基础为当前线上搜索镜像 `sha256:8f72cb8afcbfe2fb33730c467668f007b6cdc23a8a1a3f9c70851155efcab1e2`。仅新增搜索模块源码层，文件在镜像内明确只读0444；镜像运行配置和旧层前缀保持一致。实际镜像内25项搜索测试和隔离数据库14项测试通过，均未调用真实模型或生产网络。

执行入口使用完整 Compose 链、环境/挂载/网络/命令指纹和显式运行配置语义检查；不再以 Docker 生成的附件元数据或等价 bind 排序充当配置漂移。原锁定记录仍检查哈希和模式不变，其他容器检查 ID、启动时间及指纹不变。任何失败停止，不自动重试/回退。每次创建的新维护记录内提供 `rollback.sh`，只回退这两个服务的镜像，不恢复数据库；回退操作也要求空闲窗口。
