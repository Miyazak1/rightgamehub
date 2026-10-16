# `@mooyu/courseware-runtime`

结构化互动课件的最小模块运行时。它冻结模块清单、能力依赖、状态所有权、生命周期、确定性命令、快照和受控热插拔；不包含具体学科公式、页面布局或远程插件市场。

正式 Release 只注册 Builder 已固定并写入完整性摘要的本地模块。开发期可以替换模块，但 `domain`、`scenario`、`construction`、`challenge` 与 `journey` 至少要求暂停，`embed` 要求新会话；只有 `component` 与 `instrument` 可以声明实时替换。

`module-lock-v1` 是发布边界：源项目通过 `runtime.modules` 选择模块清单，通过 `runtime.rootModules` 选择本次课件入口。固定 Builder 解析依赖并生成 `dist/mooyu-modules.lock.json`；上传后平台重新计算每个清单与入口的 SHA-256，锁文件缺失、陈旧或被替换都会拒绝发布。
