# P0.8：猜百科全自动内容供给

日期：2026-09-29。范围：让猜百科在日常运行中不需要人工选题、审核或排期。P0.7 的人工接口只作为故障恢复兼容能力，后台正常界面只展示自动化状态、结果库存和紧急停用。

## 无人值守流程

1. 服务启动后自动执行，此后默认每 6 小时运行一次；
2. 通过中文维基百科 Action API 的 Random generator，从主名字空间串行获取一批随机条目；
3. 使用 TextExtracts 的 `exintro` 与 `explaintext` 获取完整纯文本序言，同时通过 Info 固定 page ID、修订号、更新时间和规范来源地址；
4. 自动拒绝消歧义、列表/索引、标题超过 10 个可猜字符、序言少于 180 个汉字或缺少修订来源的条目；
5. 以维基 page ID 去重并幂等入库，按正文关键词做轻量类别标记；
6. 自动补齐未来 14 天日题，保留近期不重复规则，且不覆盖已有日期；
7. 维基不可用、超时或处于高负载时记录失败，继续使用本地合格库存补排，不影响当天游戏。

请求遵守 MediaWiki 官方建议：携带可识别 User-Agent、使用 `maxlag=5`、单次批量请求并设置 15 秒超时。上线时通过 `GUESS_BAIKE_WIKIPEDIA_USER_AGENT` 配置正式联系信息。

参考：[Random API](https://www.mediawiki.org/wiki/API:Random)、[TextExtracts](https://www.mediawiki.org/wiki/Extension:TextExtracts)、[Info API](https://www.mediawiki.org/wiki/API:Info)、[API Etiquette](https://www.mediawiki.org/wiki/API:Etiquette)。

## 可观测与故障边界

- `0026_guess_baike_automation.sql` 记录每次运行的开始/结束时间、抓取数、通过数、排期数和失败原因；
- 管理后台显示流水线状态、可用库存、未来排期覆盖和上次筛选结果；
- 管理员不参与日常发布，只能在发现明显错误内容时紧急停用或纠正后恢复；
- 自动任务使用进程内互斥，不会并发抓取；停止 API 时定时器随服务关闭；
- 自动排期不会覆盖已有日期，外部服务异常也不会清空现有题库或排期。

## 实际验证

- 本地数据库迁移：`26/26`；
- 真实维基请求抓取 20 条，自动通过 2 条并入库；
- 未来排期覆盖 `14/14`，自动任务状态为 `succeeded`；
- 自动测试新增候选过滤、礼貌请求参数、未来排期和维基故障回退；
- 完整回归：legacy 74、platform 42（41 通过、1 个按环境跳过）、client 36；
- Harness `0.0.58` 与 VS Code/Cursor `0.2.5` 共享相同自动化状态界面。
