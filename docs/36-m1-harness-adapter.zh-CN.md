# GameHub M1.8 Harness Adapter

日期：2026-09-25 · 插件：0.0.17 · 状态：代码、自动测试与真实 Harness 侧栏验收通过 · [目录](./README.md)

## 本阶段结果

共享 React 客户端已正式打包为 Harness closure bundle，并注册主入口“GameHub”。原 0.0.12 本地上传、网页样本、适配包和 EXE 试验能力没有删除，改为独立入口“本机试验场”，避免生产平台界面与本机技术探针混在一起。

本阶段落实以下宿主边界：

- 平台主题读取 Harness 的深浅色、文字、背景与主色变量，只写入 GameHub 自己的根容器，不改宿主根节点；Harness 中主题按钮只显示“跟随宿主”。
- Agent 选择可在平台范围切换 Astra、Sol、Luna、Sage 强调色，不覆盖高对比模式的可访问操作色。
- 账号 access/refresh token 仅保存在当前 Harness JavaScript 运行内，关闭运行后清除；界面明确提示不会持久保存。
- Harness 使用插件内存路由，发现、详情、账号、创作中心和上传页切换不写 `window.location.hash`，也不调用宿主 `history.back()`。
- 宽度响应以插件容器而非浏览器 viewport 为准；窄侧栏会切换移动导航和单列卡片，不受宿主主工作区宽度误导。
- 上传按“创建任务 → 获取一次性 grant → XHR 传输并报告可信字节进度 → complete → 轮询后台状态”执行；活动任务 ID 保存在 `sessionStorage`，面板重新挂载后可恢复轮询。
- Web Player 继续由共享 `PlayerCore` 控制加载、暂停、重启与结束；关闭或卸载面板时释放会话资源。

## 真实 Harness 验收

验收宿主为 DeepSeek Harness `0.1.7-alpha.1`，源码基线 `c36a83ff6bb95e3f82cf79f9be7c724270a8aa61`，使用隔离 `gamehub-m0` profile 和本机 3081 端口安装 0.0.17 包。

实际确认：

- “GameHub”和“本机试验场”两个入口同时注册；共享客户端真实显示在右侧功能区。
- 右栏窄宽度下使用单列卡片和底部导航，功能清楚，没有按整个浏览器宽度错误套用桌面布局。
- 切换到 Sol 后平台操作色变为橙色；主题控件为禁用的“跟随 Harness”，不会反向修改宿主。
- 账号页显示“凭据仅保留到 Harness 本次运行结束”。
- 从发现页进入账号页后，浏览器地址仍保持 Harness 根地址，没有增加 `#/account`；页面返回也不使用宿主历史。
- 未在本次验收中选择、上传或运行任何 EXE；历史本机能力的安全边界保持不变。

## 自动验证

`npm run build:harness`、`npm run test:client`、`npm run web:build` 与 `npm run contracts:check` 均通过。完整 `npm test` 共 104 项：103 通过，1 项真实 PostgreSQL 测试因未提供 `GAMEHUB_TEST_DATABASE_URL` 按预期跳过。客户端测试覆盖 Harness 能力声明、内存凭据、Agent 强调色、upload grant 与可信进度、双入口 bundle、React 外置、主题作用域、容器查询和内存路由。

最终包由 `npm run pack:harness` 生成到 `artifacts/gamehub-harness-plugin-0.0.17.tgz`：20 个文件，73.4 kB，SHA-256 `608bb96d5e62951371a2519797e1e505992a95b95738a2df8ba2b92076acd56e`，npm shasum `e8a8772c905e8fbce0f0051b950aa85f8fbc1a04`。完整根测试继续同时运行 73 项历史 M0 测试、平台测试和客户端测试。

## 明确未完成

隔离 Harness profile 没有配置 `GAMEHUB_API_BASE_URL`，因此真实目录、邮箱登录和云端上传不会在该本机侧栏验收中伪造成成功；它们需要下一阶段用同源或明确允许的 API 地址完成作者与匿名玩家端到端测试。凭据持久化也仍为 false，后续若宿主提供安全秘密存储能力，必须通过新的明确能力契约接入，不能退回 localStorage。

VS Code/Cursor 适配、生产 DNS/TLS/对象存储、邮件投递和公开投稿隔离验收仍不在本阶段完成范围内。
