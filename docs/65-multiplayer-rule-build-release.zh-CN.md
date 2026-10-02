# 联网规则受控构建与发布实施契约

状态：受控构建已完成生产迁移与 G2 验证；签名发布/摘要门禁/自动回退代码完成，待首个真实规则制品上线、模式注册与双账号验收

更新日期：2026-10-02

## 1. 本阶段完成定义

管理员把提交状态改为 `approved_for_build` 时，平台在同一数据库事务中创建唯一规则构建任务。Worker 只读取该提交已经核对过 SHA-256 的不可变源码 ZIP，并把它交给独立、无网络、非 root 的 Rule Builder。Builder 不安装依赖、不运行作者提供的 npm、shell、Dockerfile 或构建脚本。

首版固定输入为：

- `creator-submission.json`；
- `rules/adapter.cjs`；
- `rules/tests.json`。

输出是单个不超过 1 MiB 的 CommonJS bundle、SHA-256 和机器报告。构建成功只表示产物可以进入离线签名，不表示已部署、已注册模式或可供生产房间使用。

## 2. 状态与审计

```text
approved_for_build
  -> queued
  -> preparing
  -> building
  -> ready | failed
```

`multiplayer_rule_builds` 保存来源提交、作品/模式/版本身份、来源摘要、Builder 镜像摘要、产物摘要和错误码。`multiplayer_rule_build_events` 为仅追加审计表，数据库触发器禁止修改或删除。

同一个提交以及同一个 `(workId, modeKey, rulesetVersion)` 只能存在一个构建。重试必须使用相同不可变输入和相同镜像；来源或实现变化时提交新的规则版本。

## 3. 隔离边界

Rule Builder：

- `network_mode: none`；
- 只读根文件系统、非 root、丢弃全部 capability；
- 只通过原子文件信箱接收 ZIP、身份与输出路径；
- 不拥有数据库、Redis、对象存储、GitHub、签名私钥或部署凭据；
- 固定 CPU、内存、进程数和超时；
- 拒绝路径逃逸、符号链接、加密 ZIP、重复路径、超限文件和额外规则入口。

Worker 负责重新核对来源摘要、Builder 响应和最终保存产物的摘要。Builder 镜像摘要变化后，旧排队任务失败，必须由运营明确重新批准或创建新版本。

## 4. 确定性与规则测试

Builder 使用平台固定测试器加载 `rules/adapter.cjs`，并验证：

- 导出完整 Rules SDK 方法；
- bundle 身份与审核提交完全一致；
- 固定玩家、seed 和时间生成相同初始状态与哈希；
- 相同命令重放产生相同结果；
- 非当前玩家命令被拒绝；
- 玩家和观战视图不泄漏测试哨兵；
- 认输和超时都生成唯一完整终局。

Node `vm` 只限制意外依赖，不视为恶意代码安全沙箱；真正的执行隔离由独立容器提供，人工代码审核仍然是批准构建的前提。

## 5. 签名发布阶段

构建为 `ready` 后：

1. 管理员下载 bundle 和构建证明并再次核对 SHA-256。
2. 离线发布机用 `rules:release stage` 验证当前签名发布并把新旧 bundle 合入完整规则目录。
3. 使用不进入服务器的 Ed25519 私钥签署完整 manifest。
4. 生产机用 `deploy/rules-release.sh install` 物化不可变目录，并让 API 与 Realtime 同时挂载和验证同一签名清单、公钥。
5. 两个服务的 `/ready` 报告相同 manifest SHA-256 后，管理员才能注册或启用模式。
6. `deploy/rules-release.sh rollback` 验证 previous、原子切换并同时重建两个服务；完整运行手册见 [66](./66-multiplayer-rules-release-operations.zh-CN.md)。

## 6. 验收门槛

- 批准审核与排队是同一事务，不会出现已批准但无任务。
- 修改来源 ZIP、Builder 输出或镜像摘要都会失败关闭。
- Rule Builder 无网络、无签名密钥、无数据库连接。
- 相同输入与镜像生成相同 bundle 摘要。
- 失败任务可定位错误码，不覆盖已存在的已签名规则。
- 真实作者、管理员及两个玩家账号的证据写回 61、62、64。

## 7. 生产启用

本阶段新增迁移 `0038_multiplayer_rule_builds.sql`。截至 2026-10-02，生产迁移与 G2 Rule Builder 验证已完成。新环境部署前仍需构建 `deploy/Dockerfile.rule-builder`，获取实际镜像的 `sha256:` 摘要，然后配置：

```dotenv
RULE_BUILD_ENABLED=true
RULE_BUILDER_IMAGE_DIGEST=sha256:<64 位小写十六进制>
```

生产配置固定使用 `RULE_BUILDER_EXECUTION_MODE=isolated`。Compose 中 `rule-builder` 无网络且不接收数据库、对象存储或签名凭据；`rule-worker` 负责数据库租约、输入输出摘要核对和 quarantine 存储。部署后依次确认迁移成功、Builder 健康、Worker 租约正常，再由管理员批准一个专用测试版本。未完成这些检查时保持 `RULE_BUILD_ENABLED=false`，审核可继续，但“批准构建”会明确失败关闭。
