# @gamehub/contracts

M1 的 HTTP、状态枚举与 OpenAPI 单一来源。

- `src/schema.mjs`：人工维护的严格 JSON Schema 与路由元数据。
- `generated/openapi.json`：由根目录生成脚本产生并提交。
- `generated/index.d.ts`：由同一 Schema 生成的 TypeScript 类型。

修改 Schema 后运行 `npm run contracts:generate`，提交生成结果；CI 使用 `npm run contracts:check` 拒绝漂移。当前包是 M1 基线，不表示对应服务均已实现。

## 交互课件契约

`courseware/` 冻结墨鱼工坊 Agent 原生交互课件的 L0 机器契约：

- `manifest-v1.schema.json`：包身份、语言、受众、构建和运行能力。
- `course-v1.schema.json`：学习目标、误区、场景、检查点与完成规则。
- `sources-v1.schema.json`：来源、事实声明和素材授权链。
- `journeys-v1.schema.json`：可由 Agent/浏览器执行的学习验收路径。
- `learning-sdk-v1.schema.json`：课件与可信宿主之间的最小学习事件协议。
- `doctor-report-v1.schema.json`：稳定、可存档的本地 Doctor 报告。

契约默认严格拒绝未知字段。实现校验器位于 `packages/creator-tools/src/courseware.mjs`，参考包位于 `templates/courseware/`。
