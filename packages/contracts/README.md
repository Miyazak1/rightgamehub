# @gamehub/contracts

M1 的 HTTP、状态枚举与 OpenAPI 单一来源。

- `src/schema.mjs`：人工维护的严格 JSON Schema 与路由元数据。
- `generated/openapi.json`：由根目录生成脚本产生并提交。
- `generated/index.d.ts`：由同一 Schema 生成的 TypeScript 类型。

修改 Schema 后运行 `npm run contracts:generate`，提交生成结果；CI 使用 `npm run contracts:check` 拒绝漂移。当前包是 M1 基线，不表示对应服务均已实现。
