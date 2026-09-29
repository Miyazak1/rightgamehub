# GameHub M1.7 共享前端客户端

日期：2026-09-25 · 状态：共享客户端完成；Harness 业务适配与双客户端 E2E 仍是下一阶段。

> D0 的原始工作包把 shared client 记作 M1.6、Harness adapter 记作 M1.7。执行中 Runtime Edge 独立占用了 M1.6，因此本文沿实际连续编号记为 M1.7；产品边界和依赖关系没有改变。

## 阶段目标

把 M0 探针页替换为可复用的平台客户端，并落实两项明确设计要求：界面实时跟随 Agent/宿主主题与强调色；视觉具有游戏平台的探索感，同时让登录、上传、发布状态和错误处理保持清楚、友好。

## 已完成

- 新增 `@gamehub/platform-client` React 18 共享界面，包含发现、详情、游戏库、账号、创作中心、上传和播放器页面。
- 新增 `@gamehub/host-contract`。`light / dark / high-contrast` 统一映射为语义令牌；Agent 强调色只作为合格的操作色或氛围光使用，对比度不足时自动回退。
- 主题事件只更新根节点 CSS 变量，不重建 React 路由、上传任务或 `iframe`。浏览器使用 `prefers-color-scheme`，宿主可注入同一接口。
- 新增 `@gamehub/platform-api-client`，集中处理超时、取消、Bearer、幂等键与领域错误；默认 UI 不在 API 失败时伪造作品。
- 新增 `@gamehub/player-core`，检查 launch descriptor 的协议、release 主机与同源关系；iframe 使用 sandbox、最小 allow、无 referrer，并提供 `idle/loading/running/hidden/error/disposed` 生命周期。
- 上传页面明确分开字节传输和后台校验状态，100% 字节不会显示成发布成功；当前线上版本不因失败上传被替换。
- 320—479 px 使用单列、短底部导航和横向压缩的进度时间线；480—767 px 双列；桌面详情使用主从布局。关键操作同时有图标与文字。
- 提供明确的本地视觉模式 `http://127.0.0.1:4173/?demo=1`。它只用于 UI 验收，默认入口仍访问真实 `/v1` API。

## 包边界

| 包 | 责任 |
| --- | --- |
| `packages/platform-client` | 页面、组件、路由投影、主题消费、友好状态视图 |
| `packages/platform-api-client` | HTTP、超时/取消、鉴权头、幂等、错误映射 |
| `packages/host-contract` | 宿主能力与主题适配、语义 token、安全回退 |
| `packages/player-core` | launch 校验、受限 iframe 与播放器生命周期 |
| `apps/web` | Vite 浏览器入口和开发期 `/v1` 代理 |

## 验收结果

- `npm run test:client`：6/6 通过，覆盖主题 token、高对比度、低对比 Agent 色回退、运行 origin 校验、API 错误和幂等头。
- `npm test`：73 项既有测试、20 项平台测试和 6 项客户端测试全部无失败；当前未提供数据库环境变量，因此平台中的真实 PostgreSQL migration 用例按设计跳过（98 pass / 1 skip）。
- `npm run contracts:check`：通过，共享客户端没有造成 OpenAPI/声明漂移。
- `npm run web:build`：通过；生产构建约 170 kB JS、25 kB CSS（压缩前），无远程字体或图片依赖。
- 1280 × 800：详情页主从布局、动作层级和明暗主题实际渲染通过。
- 320 × 800：发现页与上传页 `documentElement.scrollWidth === innerWidth`，无整页横向溢出；底部短导航和 7 阶段时间线可见。
- 深色 → 浅色切换后，路由与作品标题保持不变；Astra → Sol 后氛围色切换，浅色主操作仍使用满足对比要求的回退色。
- 键盘从页面起点按 Tab 后，首个交互元素获得 `:focus-visible`。

## 明确边界

- 本阶段没有把演示数据接入默认目录，也没有宣称完成真实作者 A → 匿名 B 的端到端发布游玩。
- Harness 的凭据、文件选择、可信上传流和生命周期桥接尚未接入共享包；下一阶段通过正式 HostAdapter 完成。
- 浏览器入口不能启动本地 EXE；PlayerCore 只处理 Web release，不暴露宿主文件、凭据、任意 URL 或 shell 能力。
- 封面目前使用代码生成的抽象作品图形。真实媒体上传与处理属于后续媒体工作包。

## 下一阶段

实现 Harness adapter：把已验证的 Harness 文件/凭据/生命周期能力接入 `HostAdapter v1`，使用正式 bundle 替换原型大厅，并验证主题事件、登录凭据、真实 ZIP 上传、后台任务恢复和播放器退出清理。随后进入两个独立客户端上下文的 M1 E2E 证据阶段。
