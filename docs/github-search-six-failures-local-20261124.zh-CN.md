# 六条 GitHub 搜索失败：归因与本地修复

## 已确认的现场事实

根据用户提供的批量只读诊断，六条任务的 plan、search、gather 阶段均成功，失败均在 verify。阶段成功不代表每个仓库都取到了完整材料。没有重试旧任务、重启服务或改动线上配置、数据与登录状态；两套论文保持原有关闭安排。

| 题目 | 最终核验错误 |
| --- | --- |
| 2 Windows／Python／离线工作流 | `AGENT_GITHUB_SEARCH_CITATION_INVALID` |
| 4 备份工具／正式Release区间 | `AGENT_PROVIDER_OUTPUT_INVALID`，内部 `AGENT_GITHUB_SEARCH_VERIFICATION_INVALID`，位置 `$.candidates[0].checks[1].references[0].quote:bounded_quote` |
| 5 SQLite／仓库创建区间 | `AGENT_GITHUB_SEARCH_CITATION_INVALID` |
| 6 生图模型／权重商用 | `AGENT_GITHUB_SEARCH_CITATION_INVALID` |
| 7 语音识别／CPU／内存上限 | `AGENT_PROVIDER_OUTPUT_INVALID`，内部 `AGENT_GITHUB_SEARCH_VERIFICATION_INVALID`，位置 `$:json` |
| 8 依赖许可证检查／报告导出 | `AGENT_GITHUB_SEARCH_CITATION_INVALID` |

六次核验模型均以 `finishReason=stop` 结束，不是这份证据中的输出长度截断。四次引用错误发生时，模型调用通过了格式校验，随后被服务端引用绑定拒绝。

共性在最终核验的结构与证据契约：模型必须生成满足格式边界的JSON，并逐字复述服务器取回的材料；任一引用无法绑定或字段不符合限制，都可能使整条任务失败，已有候选和正确条件没有形成可解释的最终交付。

诊断摘要不含被拒的完整回复。因此不能确定四次引用错误具体属于翻译、改写、空白差异、来源编号错误或跨仓库引用；也不能确定 bounded_quote 是太短、过长或类型错误，或 JSON 错误是否只是代码围栏。下面的用例复现这些实际错误类别，不冒充原始模型回复重放。

## 本地修复

业务代码仅修改 `apps/api/src/agent-plugins/github/search.mjs`，没有改共享模型网关、授权策略、预算、工作流调用上限、定时计划、QQ、数据库或桌面代码，没有新增迁移或发布镜像。

1. 核验JSON可去除一个完整标准Markdown围栏，再调用原重复键检测解析器。前后说明文字、多个JSON、截断语法和重复键不会被抽取或修补为可信对象。规划JSON的解析规则不改。
2. 核验引用允许1至1200字符非空原文。短词仍必须确实来自本仓库的非元数据来源；长引用必须全部存在于模型实际取得的材料视图后，才截取不超过400字符作为保存引用。不能通过截掉捏造的尾部获得有效引用。
3. 优先精确匹配；精确匹配失败时，仅尝试空白/换行差异，并要求归一化结果在该来源中唯一。保存的引用使用实际原文及行号，不保存模型改写文本。跨来源、跨仓库、元数据冒充功能证据、实质改写和歧义匹配不能成为证据。
4. 搜索核验处理器启用逐条件引用故障隔离。一个条件存在无效引用，即使同时提供另一条有效引用，也改为unknown并删除该条件的所有引用，记录安全的 `validationIssues`。候选不能凭该硬条件进入已确认推荐。其他已独立核验的候选与条件可保留。直接调用引用绑定函数默认仍为严格拒绝模式。
5. 仅当最终核验自身发生 `AGENT_GITHUB_SEARCH_VERIFICATION_INVALID`，或模型网关因该校验器而返回 `AGENT_PROVIDER_OUTPUT_INVALID` 时，生成明确的未完成报告，保留候选与材料，文档条件一律unknown，阻止完整匹配。状态为 `verificationStatus=incomplete`。不会再次调用模型。引用局部故障为 `verificationStatus=partial`，正文明确披露，不冒充完整核验成功。
6. 权限、预算拒绝、网络故障、取消、不确定结果、其他校验器错误仍停止；候选身份替换和漏掉项目条件等绑定错误仍拒绝。没有用默认通过或放宽用户条件换取任务完成。

若原模型调用因格式失败被网关记录为failed，这条失败记录及预算结算保持原样。外层任务可以交付一份带“核验未完成”的报告，这表示交付了可解释结果，不表示模型调用或业务核验成功。任务回执和报告中保留具体未完成状态，不重写失败为成功。

## 验收结果与证据

- 81项本地功能/兼容测试通过，0失败、0跳过。包含按六类现场错误构造的回归、精确/空白引用、长短引用、混合有效与无效候选、歧义与假引用拒绝、非法JSON与重复键、安全降级边界、任务重放、原条件分区、许可/时间/硬件未知、插件与追问兼容。
- 16项隔离数据库测试通过，0失败、0跳过。实际执行正常、无效引用、无效JSON三种插件路径；策略和预算网关、证据及回执落库、失败调用记录均为真实实现。验证原授权/日计划不变、不生成文章或论文运行；重放不新增模型调用或网络请求。
- 模型和GitHub响应均为固定合成数据。数据库位于无外网临时容器，仅合成数据，测试容器已清理，没有操作已有容器或线上服务。

完整记录：

- `E:\CodexData\build\Right\agent-server-preflight\20261124\github-search-verification-recovery-local-final\result.json` 与 `tests.tap`
- `E:\CodexData\build\Right\agent-server-preflight\20261124\github-search-verification-recovery-db-r1\result.json` 与 `database-tests.tap`

本地业务源码SHA-256：`0bd0ec7aeec713775fdaff1d13f6ba0200e385fce3da8477368b6b0b61b6a09b`。

## 尚未验证

没有真实付费模型的新一轮语义验收，没有上线、准备新发布包或重试六条原任务。不能据此宣称六种需求都能完整核验成功；修复保证了对应故障类别的处理边界与透明性，模型仍可能产生不正确的语义判断。引用匹配成功不等于语义必然成立，也不代表实际运行项目。

Rust低Stars检索的候选利用率、特殊字符串测试中模型限制说明与固定链接的矛盾，仍是另外的质量事项，没有混入这次六条失败修复。线上应保留现场，后续若获准发布再验收新任务，不能改写旧记录。
