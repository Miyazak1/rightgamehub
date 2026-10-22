# @gamehub/contracts

M1 的 HTTP、状态枚举与 OpenAPI 单一来源。

长期研究协议位于 `research/`：任务必须冻结知识缺口、契约、来源版本和平台证据包；结果只能引用这些证据，并由服务端再次校验预算和来源身份。协议不携带模型供应商密钥。

- `src/schema.mjs`：人工维护的严格 JSON Schema 与路由元数据。
- `generated/openapi.json`：由根目录生成脚本产生并提交。
- `generated/index.d.ts`：由同一 Schema 生成的 TypeScript 类型。

修改 Schema 后运行 `npm run contracts:generate`，提交生成结果；CI 使用 `npm run contracts:check` 拒绝漂移。当前包是 M1 基线，不表示对应服务均已实现。

## 长期研究协议

`research/` 固化墨鱼变更雷达与独立深度研究引擎之间的异步边界：

- `research-contract-v1.schema.json`：用户授权的长期问题、方法、来源、频率、预算、通知与保留策略。
- `research-job-v1.schema.json`：控制面提交给研究引擎的有界任务信封，同时冻结专题当前启用的方法模板和已有指标定义，避免证据范围、必填维度或同一指标口径在不同运行中静默变化。
- `research-result-v1.schema.json`：研究引擎返回的来源、证据绑定、发现、未解决问题与额度回执；`metric` 类发现必须携带直接观察型指标值、单位、时间、维度和任务中已冻结的方法版本。

这三个协议不允许研究引擎直接写入雷达数据库；结果必须先通过协议校验，再由雷达控制面应用。

## 交互课件契约

`courseware/` 冻结墨鱼工坊 Agent 原生交互课件的 L0 机器契约：

- `manifest-v1.schema.json`：包身份、语言、受众、构建和运行能力。
- `course-v1.schema.json`：学习目标、误区、场景、检查点与完成规则。
- `sources-v1.schema.json`：来源、事实声明和素材授权链。
- `journeys-v1.schema.json`：可由 Agent/浏览器执行的学习验收路径。
- `learning-sdk-v1.schema.json`：课件与可信宿主之间的最小学习事件协议。
- `doctor-report-v1.schema.json`：稳定、可存档的本地 Doctor 报告。
- `knowledge-map-v1.schema.json`：课程权威来源、学科、知识节点、关系、Learning Cluster、教材映射和审校状态。
- `textbook-baseline-v1.schema.json`：平台首套教材基线、权威目录、出版社版本、册次、ISBN 与来源链接；允许后续并列添加地区采用版本。
- `knowledge-map-fragment-v1.schema.json`：按学科拆分的大规模知识地图片段；主目录编译校验时合并，不以一个巨型 JSON 维护全部节点。
- `courseware-coverage-v1.schema.json`：把可运行课件包显式绑定到学科知识簇，并分别记录 Doctor、双语、键盘、减弱动效、外站容器和真实浏览器旅程证据；原型不会被误报为 C4。
- `experience-v1.schema.json`：让教材实验、F2/F3 自由沙盒与科学状态驱动的场景挑战按课件需要组合；声明自由沙盒或挑战时仍执行严格能力门禁，不强制每个课件伪造全部模式。
- `module-manifest-v1.schema.json`：结构化课件模块的类型、接口版本、能力、命令、依赖、状态版本、完整性与可控热插拔等级。
- `module-lock-v1.schema.json`：固定 Builder 产出的发布模块图；锁定根模块、解析后的本地入口、模块清单摘要与依赖闭包。
- `embed-protocol-v1.schema.json`：冻结外站嵌入握手、脱敏学习事件和基础宿主命令。
- `embed-protocol-v2.schema.json`：以新协议版本增加有界状态快照、恢复和体验模式控制，不改变 v1 信封。

契约默认严格拒绝未知字段。实现校验器位于 `packages/creator-tools/src/courseware.mjs`，参考包位于 `templates/courseware/`。
