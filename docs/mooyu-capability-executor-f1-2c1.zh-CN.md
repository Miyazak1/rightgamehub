# 墨鱼工坊 Windows 可信运行时发布与本地装配 F1.2c-1

更新时间：2026-10-28
状态：签名发布合同、原子安装/回滚、发布构建器和执行器 bootstrap 已实现并通过真实沙箱验收；尚未制作面向用户的安装器

## 1. 为什么 F1.2b-2 后还需要这一层

F1.2b-2 证明原生沙箱 helper 能安全运行，但开发目录里的 EXE 不能直接成为产品信任根。F1.2c-1 把 helper 变成独立于能力包的“平台运行时发布物”：

- 平台发布者用 Ed25519 私钥签署运行时清单；
- 本地只信任预置公钥与有效期，不信任能力包提交的 key 或 helper；
- 清单绑定平台、最低 Windows build、运行时版本、唯一 helper 路径及每个文件的 SHA-256/大小/角色；
- 安装在隔离版本目录，活动版本状态原子切换，并保留一个可验证的上一版本；
- 每次装配和运行前都重新验证签名、文件集合与 helper 哈希；
- bootstrap 只能从已验证安装目录创建 sandbox host、native runner、artifact store 和 executor runtime。

## 2. 发布合同

`windows-runtime-release-v1` 的签名内容包括：

| 字段 | 约束 |
| --- | --- |
| `runtimeId` | 固定平台运行时身份，不能由能力包覆盖 |
| `runtimeVersion` | SemVer |
| `platform` | 当前只接受 `win32-x64` |
| `minimumOsBuild` | 安装前硬门禁 |
| `keyId` | 必须命中本地 active keyring 且处于生效窗口 |
| `files[]` | 安全相对路径、SHA-256、大小和角色 |
| `helper` | 必须精确指向唯一 `sandbox-host` 文件并重复绑定其哈希 |

任何未知字段、额外文件、符号链接、路径穿越、大小或哈希不一致都会失败关闭。

## 3. 构建发布目录

先在离线或受保护的发布环境准备 Ed25519 PKCS#8 私钥，然后运行：

```powershell
node scripts/build-windows-runtime-release.mjs `
  --output C:\release\mooyu-runtime-1.2.0 `
  --private-key C:\secure\runtime-release-private.pem `
  --key-id mooyu-runtime-release-2026 `
  --version 1.2.0 `
  --minimum-os-build 19041
```

输出只包含：

```text
runtime.json
bin/MooyuCapabilitySandboxHost.exe
```

验收 fixture 不进入生产发布目录，私钥不会被复制。构建器拒绝覆盖已有输出目录，避免误把两个版本混在一起。

## 4. 原子安装与恢复

`createWindowsRuntimeReleaseStore` 执行：

1. 在源目录验证签名、平台、OS build、精确文件集合和逐文件哈希；
2. 逐个复制声明文件到随机 staging，不递归信任来源目录；
3. 在 staging 再验一次；
4. 原子 rename 到内容身份确定的版本目录；
5. 原子写入 `active.json`，保存 `active` 和 `previous`；
6. 进程崩溃遗留的、所有者已消失且超过阈值的安装锁才可回收；
7. `active()` 和 `rollback()` 都重新验签与重算文件哈希，不能回滚到已篡改版本。

旧 staging 即使在断电后残留也不会成为 active；后续维护阶段可清理，但不会被执行。

## 5. 正式装配

`createWindowsExecutorBootstrap` 从运行时 store 读取 active release，并创建：

```text
受信 helper
  → Windows sandbox host adapter
    → native runner
      → content-addressed local artifact store
        → capability executor runtime
```

能力包安装仓库仍是另一条低信任供应链。它只能提供被执行的能力 EXE，不能提供 helper、平台公钥或 bootstrap 配置。

## 6. 验收证据

```powershell
$env:MOOYU_WINDOWS_SANDBOX_ACCEPTANCE='1'
node --test tests/platform/capability-executor-runtime-release.test.cjs
```

当前覆盖：

- 版本、平台、最低 OS 和每个 helper 字节都受签名约束；
- 签名篡改、未知 key 和文件篡改失败关闭；
- 原子安装、遗留锁回收、双版本切换和上一版本回滚；
- 发布构建器只输出 helper 与签名清单；
- 从真实已安装 helper 完成 bootstrap → AppContainer Low 进程 → 本地产物的端到端运行。

## 7. 明确未完成

- Windows Authenticode/EV 证书签名和时间戳；
- MSI/MSIX/安装向导、卸载与系统级 ACL；
- CDN 的生产托管尚未完成；签名发布索引、断点续传、撤销/反回滚和自动更新内核已在 F1.2c-2 完成；
- 托盘、桌面 UI、开机启动和诊断导出；
- OCR 能力包。

后续实现见 [Windows 可信在线更新器 F1.2c-2](./mooyu-capability-executor-f1-2c2.zh-CN.md)。仍不应向用户分发开发目录二进制。
