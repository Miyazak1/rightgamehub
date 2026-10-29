# 墨鱼工坊 Windows 可信在线更新器 F1.2c-2

更新时间：2026-10-28
状态：签名发布索引、撤销/反回滚、断点续传、安全解包、事务恢复、真实 helper 健康观察、自动回退和无界面 CLI 已实现并通过真实 Windows 验收；Authenticode 与图形安装向导尚未实现

## 1. 阶段目标

F1.2c-1 证明本机只能装配经过 Ed25519 验证的运行时目录。F1.2c-2 解决发布目录离开构建机之后的问题：客户端下载什么、是否仍然允许安装、下载中断怎么办、断电后如何恢复、何时可以把新 helper 视为可用。

这不是 OCR 下载器。它是所有桌面原生能力共同依赖的平台运行时更新层，运行时 helper 与低信任能力包继续属于两条独立供应链。

## 2. 两层信任链

```text
预置目录公钥
  → windows-runtime-update-catalog-v1
    → 归档 URL / 大小 / SHA-256 / 发布序列 / manifest SHA-256 / 撤销集合
      → windows-runtime-release-v1
        → 平台 / 最低 OS / helper 路径 / 每个文件大小与 SHA-256
```

发布目录使用单调 `sequence`；每个运行时使用单调 `releaseSequence`。本机分别记录见过的最高值：

- 更小目录序列直接拒绝；
- 相同目录序列但内容哈希不同视为签名方歧义并拒绝；
- 更小发布序列直接拒绝；
- 相同发布序列但 manifest 不同同样拒绝；
- 被当前有效签名目录列入 `revokedManifestSha256s` 的发布不能成为候选；
- 目录有生成时间、失效时间和签名 key 生效窗口，客户端不信任目录附带的新公钥。

## 3. 下载与归档

`downloadFileResumable` 使用内容哈希命名缓存，保存 `.part` 与严格元数据：

1. 首次请求不追加到未知文件；
2. 中断后只在 URL、预期大小和 SHA-256 全部相同时复用 partial；
3. 续传发送 `Range`，有 ETag 时同时发送 `If-Range`；
4. 服务端不正确响应 Range 时从零覆盖，不拼接两个对象；
5. 完成后重算整个文件 SHA-256，逐字节匹配后才原子改名；
6. 默认只接受 HTTPS。测试或受控本机开发必须显式开启 localhost HTTP，不能开启任意明文远端。

`package-windows-runtime-release.ps1` 不使用 Windows 默认的反斜杠 ZIP 条目；它显式生成 `/` 路径、拒绝 reparse point、固定条目时间并输出归档大小与 SHA-256。解包继续拒绝绝对路径、`..`、反斜杠、重复条目、链接、特殊文件、加密条目、文件数或展开大小超限。

发布侧使用标准入口生成目录：

```powershell
powershell -File scripts/package-windows-runtime-release.ps1 `
  -ReleaseDirectory C:\release\runtime-1.2.1 `
  -ArchivePath C:\release\runtime-1.2.1.zip

node scripts/build-windows-runtime-update-catalog.mjs `
  --input C:\release\catalog-build.json `
  --output C:\release\catalog.json `
  --private-key C:\secure\catalog-private.pem
```

目录构建器支持一个目录包含多个候选版本。在签名前，它会用客户端同一安全解包器打开每个归档，并核对归档内 `runtime.json`、精确文件集合以及每个文件的大小和 SHA-256，避免把“哈希正确但内容配错”的 ZIP 合法签入目录。

## 4. 单实例事务与恢复

更新器只有一个本机锁。锁的拥有进程仍存在时绝不抢占；只有超过阈值且进程已消失的锁可以回收。

事务日志在激活前写入，记录旧 manifest 与目标 manifest：

| 阶段 | 重启恢复 |
| --- | --- |
| `installing` | 若目标已经 active，自动回到旧版本；首次安装则取消激活 |
| `health-check` | 同上，不猜测未完成的健康观察 |
| `committing` | 健康观察已通过，使用日志内完整 next state 幂等完成提交 |

因此下载完成、解包完成和文件安装完成都不等于更新成功。只有真实 helper 健康观察通过并持久化单调状态后，更新才提交。

Windows Defender 或索引器短暂占用新写入 EXE 时，版本目录的同卷原子 rename 只做有界退避重试；不会退化成可观察到半安装状态的递归复制。

## 5. 真实 helper 健康观察

生产 helper 增加 `--self-test`，但没有绕过安全原语。自检会实际：

- 打开当前进程 Token；
- 创建 `DISABLE_MAX_PRIVILEGE` restricted Token；
- 创建 Job Object；
- 创建并删除唯一临时 AppContainer profile；
- 输出严格的 `windows-sandbox-host-self-test-v1`。

Node 端在启动自检前重算已签名 helper SHA-256，限制进程时长和输出大小，并严格校验协议。失败时：

- 已有旧版本：原子切回旧版本；
- 首次安装：取消 active 状态，安装文件保留为不可执行的惰性版本；
- 事务日志只有在回退完成后才删除，回退本身失败会保留证据并失败关闭。

## 6. 无界面安装/更新外壳

入口：

```powershell
node scripts/windows-runtime-update-cli.mjs apply --config C:\ProgramData\Mooyu\runtime-updater.json
node scripts/windows-runtime-update-cli.mjs status --config C:\ProgramData\Mooyu\runtime-updater.json
node scripts/windows-runtime-update-cli.mjs recover --config C:\ProgramData\Mooyu\runtime-updater.json
```

配置必须使用绝对数据根，目录/运行时两组公钥从本地文件加载。生产配置必须关闭 `allowInsecureLocalhost`。

稳定退出码：

| 退出码 | 类别 |
| --- | --- |
| 0 | 成功、已是当前版本或完成恢复 |
| 10 | 配置/调用错误 |
| 20 | 信任、签名、撤销、过期、回滚或歧义 |
| 30 | 目录/归档网络下载 |
| 40 | 解包、manifest、安装、状态或事务 |
| 50 | helper 健康观察 |
| 60 | 另一更新实例正在运行 |
| 70 | 未分类内部错误 |

该 CLI 可以完成首次安装和在线更新，是后续桌面壳、系统服务或企业部署工具可调用的稳定内核；它不是面向普通用户的最终安装向导。

## 7. 验收证据

```powershell
$env:MOOYU_WINDOWS_SANDBOX_ACCEPTANCE='1'
node --test `
  tests/platform/capability-executor-package.test.cjs `
  tests/platform/capability-executor-runtime.test.cjs `
  tests/platform/capability-executor-node-client.test.cjs `
  tests/platform/capability-executor-native-runner.test.cjs `
  tests/platform/capability-executor-windows-sandbox-host.test.cjs `
  tests/platform/capability-executor-runtime-release.test.cjs `
  tests/platform/capability-executor-runtime-updater.test.cjs
```

当前覆盖 32 项，其中 F1.2c-2 专项覆盖：目录签名/过期/篡改、撤销、目录与发布反回滚、真实 HTTP 中断续传、真实 helper 自检、健康失败回退、断电事务回退、健康后提交重放和稳定退出码。

## 8. 明确未完成

- EXE/MSI/MSIX 的 Authenticode 证书签名、时间戳与 SmartScreen 信誉；
- 普通用户安装向导、卸载、修复、托盘和可视化诊断；
- Windows 服务/计划任务承载的长期节点生命周期；
- 发布索引/CDN 的生产托管、密钥轮换操作手册和离线应急介质；
- macOS notarization、Linux 包签名与各自沙箱；
- OCR 或任何真实生产能力包。

下一阶段 F1.2c-3 应把现有可信内核接入最小权限桌面节点生命周期和生产签名/部署，而不是在更新器里加入 OCR 特例。
