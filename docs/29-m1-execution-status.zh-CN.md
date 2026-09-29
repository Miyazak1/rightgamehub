# GameHub M1 执行状态

日期：2026-09-24 · 增量：M1.1/M1.2 基础门 · 状态：第一可验收增量已落地。

后续 M1.2 已继续完成 Fastify 与真实 PostgreSQL 基础，见 [30](./30-m1-api-database-foundation.zh-CN.md)。本文保留第一增量的当时边界。

## 本阶段目标

在不删除、不迁移现有 Harness 0.0.12 原型的前提下，建立完整平台实施所需的工作区、共享契约、OpenAPI、TypeScript 声明、PostgreSQL 前八个迁移和自动验证。此阶段不声称 API、邮箱或数据库服务已经运行。

## 已完成

- 根目录加入 `pnpm-workspace.yaml` 和 `pnpm-lock.yaml`，覆盖 `apps/*`、`packages/*`、`extensions/*`；关闭可选 peer 自动安装，Harness 继续使用宿主 React。
- 新建 `@gamehub/contracts`，以严格 Schema 和路由元数据为单一来源。
- 生成并提交 OpenAPI 3.1 与 TypeScript 声明；`--check` 可阻止生成物漂移。
- 新建 `apps/api` 骨架及 `0001`—`0008` SQL migration：身份、设备令牌、作者配额、作品、多目标、release 指针、上传、任务租约与幂等。
- 新增平台测试，检查严格字段、作者鉴权、幂等头、状态枚举、迁移连续性、非破坏性和关键复合外键。
- 根测试命令先运行原 73 项，再运行平台基础测试；保留 `test:legacy` 便于单独验证 M0。

## 验证结果

- `npm run contracts:check`：通过，OpenAPI 与 TypeScript 声明没有漂移。
- `npm run test:legacy`：73/73 通过；没有启动真实 EXE。
- `npm run test:platform`：7/7 通过。
- `npm run verify:m1-foundation`：总验证通过。
- pnpm 锁文件设置 `autoInstallPeers: false`；Harness importer 没有 React 依赖，保持宿主 React 边界。

## 明确未完成

- 尚未启动 PostgreSQL，也没有把 SQL migration 宣称为实际升级通过。
- 尚未实现 Fastify API、邮箱验证码发送、token 轮换 repository 或真实数据库事务测试。
- 当前 OpenAPI 是 M1 首批路由基线，不是 27/28 中所有最终路由的完整实现。
- Windows 扫描、R2、runtime edge、共享 React 客户端和三个宿主业务闭环尚未开始。

## 下一增量

M1.2 继续完成：本地 PostgreSQL 开发依赖、migration runner/校验、API bootstrap、`/health`/`/ready`、邮箱 challenge 与设备授权 repository，并使用真实 PostgreSQL 覆盖验证码单次消费、refresh 轮换重放和作者权限。

任何需要下载新依赖、拉取容器镜像或启动本地服务的步骤，执行时按环境权限和用户授权处理；本阶段没有打开 GUI 或运行 EXE。
