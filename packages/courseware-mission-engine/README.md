# `@mooyu/courseware-mission-engine`

面向综合学习任务的确定性 `scenario` 模块工厂。它只负责任务图、任务时钟、资源、行动成本、结局和学习证据，不包含学科公式、DOM、画布或宿主 API。

任务通过 capability binding 只读观察已声明的 Domain 模块；界面只能提交行动 ID，不能提交“是否成功”。因此任务结果来自已固定 Release 中的权威学科状态，可以快照、恢复和回放。

该包与原子课件共用 `@mooyu/courseware-runtime`，不创建第二套运行时。
