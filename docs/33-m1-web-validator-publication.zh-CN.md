# M1.5 Web ZIP 校验与不可变发布

状态：**完成本地开发闭环**  
日期：2026-09-24

## 本阶段结果

M1.5 已把 `queued` 上传任务推进为可恢复的校验与发布链路：数据库租约领取、过期租约接管、独立解析子进程、受限 ZIP 展开、不可变 runtime attempt、Release 创建、配额结算，以及 `publish_generation` 条件发布。

正常任务现在按以下状态执行：

```text
queued → validating → succeeded
                  ↘ failed
```

`npm run api:validate:once` 每次领取一个可用任务。短暂故障保留配额并重新排队，最多尝试三次；结构、路径、CRC、manifest 或能力策略错误直接失败并释放预留。

## 校验边界

Web ZIP 校验器执行以下硬限制：

- 原包最多 100 MiB，展开总量最多 300 MiB，单文件最多 100 MiB。
- 最多 5,000 个条目、16 层路径，限制完整路径与单段 UTF-8 长度。
- 拒绝绝对路径、`..`、反斜杠、控制字符、Windows 设备名、大小写/NFC 冲突、文件目录冲突。
- 拒绝链接、特殊文件、加密 ZIP、不支持的压缩方式、嵌套归档和未知资产类型。
- 复核 central directory 与 local header，并按实际流重新计算大小、CRC32 和 SHA-256。
- 根目录必须有非空 `index.html`；可选 `platform.json` 最大 16 KiB、严格字段和版本，只接受当前支持的能力。

解析运行在单独 Node 子进程，固定入口、无 shell、120 秒超时；协调进程再次验证报告、资产路径、MIME、大小和摘要。生产开放投稿前仍必须把该固定解析入口放进无网络、只读根文件系统、非 root、cgroup 限制的 rootless 容器；当前 Windows/本地进程隔离不等于生产沙箱验收。

## 租约与发布事务

- PostgreSQL 使用 `FOR UPDATE SKIP LOCKED` 领取任务，租约 30 秒、每 10 秒续租。
- 过期 `leased` 作业可被新 worker 接管，`attempt` 递增；旧 `lease_token` 不能提交或失败新任务。
- `0010_validator_release_identity.sql` 为 UploadJob 固定唯一 `release_id`，并约束非空 `asset_prefix` 唯一。
- 每次尝试写入 `runtime/<releaseId>/<leaseToken>/`；先写并复核资产，再写稳定排序的 `asset-manifest.json`，最后写 `complete.json`。
- 发布事务同时锁定 job、UploadJob、Work、WorkTarget 和 creator usage；只有当前有效租约可提交。
- 自动发布仅在目标仍未 suspended 且 `publish_generation` 匹配时切换 `current_release_id`。旧任务晚完成会生成 ready/disabled Release，并记录 `skipped_newer_intent`。
- 配额由 `reserved_bytes` 原子转换为原始 ZIP 与展开资产的实际 `stored_bytes`；失败恰好释放一次。

## 验证结果

真实 PostgreSQL 16.10 集成测试验证了：

1. 人工过期的租约由新 worker 接管，任务 attempt 从 1 变为 2。
2. 两个 worker 同时抢同一任务时只有一个取得租约。
3. 旧 token 无法在新租约完成后回写状态。
4. generation 1 的任务晚完成时不能覆盖 generation 2，Release 保持 disabled。
5. generation 2 成功发布后，WorkTarget 指针、作品 public 状态和 Release serving 状态在同一事务中生效。
6. runtime 完成标记、manifest 摘要、实际配额与数据库引用一致。

最终执行 `npm run verify:m1-foundation`：73 项既有测试与 19 项平台测试全部通过，共 **92 项**。

## 下一阶段

M1.6：runtime edge 与匿名目录读取。实现独立运行 origin 的状态门禁、严格路径映射、GET/HEAD/Range、清单校验、MIME/CSP/Permissions-Policy，以及撤下后 fail-closed 的缓存策略。
