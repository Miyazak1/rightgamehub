# 联网游戏本地测试与排障

先运行 `npm run multiplayer:doctor -- ./项目目录 --web-zip ./客户端.zip --json --output ./artifacts/creator-doctor.json`。提供 `--web-zip` 时会复用生产 Web ZIP Validator；报告分 `error`、`warning`、`info`，只有 error 影响退出码。warning 中的启发式边界必须人工确认。

## 双会话验收

1. 用两个不同账号或完全隔离的浏览器配置打开已上传模板。
2. A 创建邀请房并复制 roomId/邀请码，B 加入；双方准备，A 开始。
3. 当前玩家提交合法 `score`；另一方同时提交，确认收到规则拒绝且 revision 不变。
4. 对同一命令模拟网络重试，确认 commandId 只产生一个事件。平台负责幂等，适配器负责相同基线的确定性。
5. 刷新 B，确认重新订阅后得到自己的私密视图和当前 revision，不出现 A 的秘密哨兵。
6. 执行认输，再单独测试超时；双方只收到一个终局。

首版不伪造双真实账号自动通过。自动测试覆盖适配器和桥契约，真实账号、网络断开和生产部署必须按上述步骤记录结果。

## 平台构建与上线前核对

管理员选择“批准构建”后，提交会原子进入独立 Rule Builder 队列。只有构建状态为 `ready` 时，治理页才允许下载平台构建的 `.cjs`；下载后要核对 `Digest` 与页面 SHA-256。这个文件仍需在离线发布机签入完整 manifest，再按 [66](./66-multiplayer-rules-release-operations.zh-CN.md) 安装；只有 API 与 Realtime `/ready` 返回同一个 manifest SHA-256 才能注册模式，不能直接复制进单个线上容器。

如果构建失败，先按错误码检查来源 ZIP 摘要、`creator-submission.json` 身份、规则测试和当前 Builder 镜像摘要。不得手工修改失败构建的产物或数据库状态；源码或规则有变化时提交新的 `rulesetVersion`。

常见排障：`BRIDGE_TIMEOUT` 检查是否在 GameHub 已批准的多人发布中运行；`MODE_NOT_ALLOWED` 检查 mode 是否属于当前作品；`REVISION_CONFLICT` 重新订阅；`RULE_BUILDER_UNAVAILABLE` 检查受控构建是否启用且镜像摘要已固定；`RULESET_NOT_AVAILABLE` 先完成平台审核、受控构建、离线签名和双服务部署；Doctor 的 `PRIVATE_VIEW_LEAK` 需检查服务端裁剪与公开 event。
