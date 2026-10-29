# 墨鱼工坊 Windows 常驻桌面节点生命周期内核 F1.2c-3a

版本：v1.0
状态：生命周期内核、控制 CLI、真实 Windows helper/DPAPI 验收已完成；普通用户安装器、系统注册、托盘 UI 与生产代码签名尚未完成
更新日期：2026-10-28

## 1. 本阶段解决什么

F1.2c-2 已经能可信下载、验证、安装和回退平台运行时，但“更新器可用”不等于桌面节点可以长期安全运行。F1.2c-3a 把更新器、运行时装配、节点心跳、租约执行和崩溃恢复接成一个失败关闭的常驻生命周期：

1. 同一数据目录只允许一个 supervisor；
2. 启动先恢复更新事务，再检查可信更新，再装配活动运行时；
3. 领取新任务前恢复上一运行日志；
4. 定期上报资源与受限元数据，不上报本机绝对路径或节点秘密；
5. 空闲时轮询，暂时故障指数退避，连续失败打开熔断器；
6. 信任状态、单次续期 Token 或本地状态不确定时自动暂停，不猜测重试；
7. 更新只在没有活动任务时检查，新版本健康通过后重新装配；
8. 停机停止领取新任务，正在运行的原生任务按既有租约和超时边界收尾，不粗暴制造未知结果。

它仍是产品内核，不是普通用户安装包，也不代表 OCR 已经发布。

## 2. 组件

| 组件 | 职责 |
| --- | --- |
| `desktop-node-supervisor.mjs` | 单实例、恢复、更新、装配、心跳、运行循环、退避、熔断、暂停和停机 |
| `desktop-node-state.mjs` | 原子状态快照、严格本地控制请求、有界结构化事件、脱敏诊断导出 |
| `windows-desktop-node-cli.mjs` | `run/status/pause/resume/stop/diagnostics` 稳定无界面入口 |
| `capability-desktop-node-config.example.json` | 严格生产配置示例；私钥和节点 Token 不进入该文件 |

supervisor 复用 F1.2a 的执行日志和 F1.2c-2 的更新事务，不建立第三套任务队列或另一套安装状态。

## 3. 状态机

```text
starting
  → recovering
  → checking-update
  → ready
     ├─ running → ready
     ├─ backoff → running
     ├─ circuit-open → running
     ├─ paused → ready
     └─ stopping → stopped

不可恢复信任/状态错误 → paused 或 failed
```

`status.json` 只保存：状态、进程、代次、运行时公开身份、连续失败数、最近结果、下一尝试和熔断时间。访问 Token、续期 Token、租约 Token、用户文件路径、任务输入和模型 Key 均不得进入状态、事件或诊断。

## 4. 故障策略

- 网络超时、429 和服务端 5xx：指数退避并加入抖动，最大等待有上限；
- 连续故障达到阈值：打开有冷却时间的熔断器，禁止忙循环；
- 更新目录/发布序列回滚或等序列异内容：失败关闭；
- DPAPI 会话损坏、续期 Token 轮换结果不确定：暂停，必须重新建立可信状态；
- `result-pending`：按既有 submissionId 幂等重交；
- `running` 中断：上报不确定结果，绝不重复执行原生任务；
- 更新健康检查失败：由可信更新器回退，不装配失败版本。

## 5. CLI

常驻运行：

```powershell
node scripts/windows-desktop-node-cli.mjs run --config C:\ProgramData\Mooyu\capability-node.json
```

本地运维：

```powershell
node scripts/windows-desktop-node-cli.mjs status --root C:\Users\USER\AppData\Local\Mooyu\CapabilityNode
node scripts/windows-desktop-node-cli.mjs pause --root C:\Users\USER\AppData\Local\Mooyu\CapabilityNode
node scripts/windows-desktop-node-cli.mjs resume --root C:\Users\USER\AppData\Local\Mooyu\CapabilityNode
node scripts/windows-desktop-node-cli.mjs stop --root C:\Users\USER\AppData\Local\Mooyu\CapabilityNode
node scripts/windows-desktop-node-cli.mjs diagnostics --root C:\Users\USER\AppData\Local\Mooyu\CapabilityNode --output C:\Temp\mooyu-node-diagnostics.json
```

`run` 配置只允许精确字段。节点会话继续由当前用户 DPAPI 保管；配置中的三组 keyring 只包含公钥。当前文件授权代理默认返回空授权，不能借配置文件指定任意本机路径。后续桌面 UI 必须通过用户选择器产生短期文件授权。

## 6. 已验收

专项自动化覆盖：

- 启动恢复、可信更新、装配、心跳和有界运行；
- 暂时故障的 1/2/4… 有界退避与连续失败熔断；
- 会话不确定和信任故障自动暂停；
- 控制请求只消费一次，停机前不再领取任务；
- 诊断导出不包含访问/续期 Token；
- 真实编译的 Windows sandbox helper 执行 `--self-test`；
- 真实 Windows CurrentUser DPAPI 保存、读取和删除节点状态。

真实 helper/DPAPI 验收意味着内核路径已接通，不等于已经完成 MSI/MSIX、开机启动或托盘交互。

## 7. 资源与部署边界

- 当前仍只有一台 4 核 8G 服务器；服务器只承担控制面、租约和小型状态，不运行常驻 OCR；
- supervisor 在用户本机运行，重型能力包也在本机受限沙箱运行；
- 不新增服务器、Redis、消息总线或 OCR 容器；
- 不通过 Service Worker 假装浏览器后台常驻；
- 不伪造 Authenticode 或“已签名安装器”结论；
- 不把开发目录 EXE 当成可向用户分发的正式制品。

## 8. 下一阶段 F1.2c-3b

F1.2c-3b 应完成“普通用户可安装且可恢复”的 Windows 产品外壳：

1. 安装、卸载、修复和升级编排；
2. 当前用户计划任务或受限后台进程注册，明确比较后再决定是否需要系统服务；
3. 数据目录 ACL、日志保留和诊断一键导出；
4. 配对、文件选择授权和状态托盘的最小 UI；
5. 生产 Authenticode、时间戳、发布 key 轮换和 CDN 托管；
6. 干净 Windows 用户环境、断网、重启、升级失败和卸载残留验收。

只有完成这些，才能称“普通用户桌面节点可安装”。OCR 仍属于其后的 F1.3 能力包，不应塞进安装器或生命周期内核。
