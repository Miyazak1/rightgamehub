# 墨鱼工坊 Windows 本地文件授权内核 F1.2c-3b-2a

版本：v1.0
状态：系统选择器边界、DPAPI 授权账本、能力绑定与单次消费已完成；最终托盘视觉与任务级授权提示尚未完成
更新日期：2026-10-28

## 1. 本阶段解决什么

桌面节点能够常驻，不代表 Agent 可以读取用户电脑。F1.2c-3b-2a 把“读取本机文件”定义成独立、可撤销、失败关闭的用户动作：

1. 文件只能来自当前用户看到并确认的 Windows 系统文件选择器；
2. 服务器、模型输入、能力包配置和平台配置都不能传入本机绝对路径；
3. 一次授权只绑定一个稳定 capability contract key；
4. 授权有明确过期时间，只能被对应能力消费一次；
5. 选择后到执行前文件被替换或修改，执行失败关闭；
6. 沙箱仍只得到只读投影和逻辑显示名，平台 API 不得到本机路径；
7. OCR、论文、音视频和未来工具复用同一授权内核。

## 2. 数据边界

明文索引 `file-authorizations.json` 只保存：

- authorizationId；
- capabilityKey；
- `pending/consuming/consumed/revoked/expired`；
- 文件数量与显示名；
- 创建、到期、消费和撤销时间。

绝对路径、文件大小、mtime 和 SHA-256 身份记录只保存到 CurrentUser DPAPI vault。DPAPI 文件名也是逻辑 key 的 SHA-256，不含原文件名。授权消费后，DPAPI 记录立即删除。

服务器只会继续看到既有的 `capability-output-ref-v1`，不会收到选择路径。

## 3. 授权流程

```text
本机用户点击“选择文件”
  → 产品壳调用 Windows OpenFileDialog
  → 本机校验扩展名、普通文件、非符号链接
  → 计算大小、mtime、SHA-256
  → 路径与身份进入 DPAPI；安全摘要进入授权索引
  → pending

对应 capability 下一次本地运行
  → runner 以 contract.key 请求授权
  → 原子变为 consuming（崩溃后不可重放）
  → 重新 lstat + SHA-256
  → 只读文件投影进入 AppContainer
  → consumed，删除 DPAPI 路径记录
```

当一个能力有多个待执行任务时，本阶段消费该能力最早的 pending 授权。任务级可视提示和具体 Stage 绑定属于下一小阶段；在此之前 UI 必须明确文案为“授权给该能力的下一次运行”，不能伪装成已经绑定某一远程任务。

## 4. 为什么消费前先写 `consuming`

不能先执行再标记消费。节点若在能力进程启动后断电，重复授权可能使不确定副作用再次发生。因此授权在把路径交给 runner 之前原子进入 `consuming`：

- 正常完成后变为 `consumed`；
- 校验失败也变为 `consumed`，必须由用户重新选择；
- 启动恢复发现遗留 `consuming` 时直接收敛为 `consumed`；
- 不猜测上次是否已经打开过文件。

这是安全优先的 at-most-once 授权，不是自动重试队列。

## 5. 文件替换防护

选择时冻结：普通文件身份、大小、mtime 和 SHA-256。消费时全部重验。任何一项变化都返回 `CAPABILITY_DESKTOP_FILE_GRANT_SOURCE_CHANGED`，不会把新内容静默交给能力。

本阶段当时仍有路径重验与 Windows sandbox 只读投影之间的窄 TOCTOU 窗口。该缺口已在 F1.2c-3b-2c 通过卷标识 + File ID 双重复验和 helper 运行期句柄锁收窄；原始阶段结论不追溯包装。

## 6. 产品壳入口

产品壳新增本机动作：

```powershell
node scripts/windows-desktop-shell-cli.mjs authorize-files `
  --config C:\ProgramData\Mooyu\desktop-shell.json `
  --capability research.paper.layout `
  --extensions .pdf,.png,.jpg `
  --max-files 10

node scripts/windows-desktop-shell-cli.mjs authorizations `
  --config C:\ProgramData\Mooyu\desktop-shell.json

node scripts/windows-desktop-shell-cli.mjs revoke-authorization `
  --config C:\ProgramData\Mooyu\desktop-shell.json `
  --id 00000000-0000-4000-8000-000000000000
```

CLI 不提供 `--path`。托盘控制器状态合同新增 `selectFiles` 和 `manageAuthorizations` 动作，后续界面必须调用同一 broker。

## 7. 已验收

- 选中路径不出现在明文索引；
- 真实 Windows CurrentUser DPAPI 中看不到路径或文件内容；
- capability key 不匹配不能消费；
- 单次使用后不能重放；
- 过期、撤销和用户取消均不产生可执行授权；
- 扩展名不匹配、符号链接或文件替换失败关闭；
- runner 继续按冻结 placement 的 `files` 权限做第二重门禁；
- 原有 Runtime、沙箱、更新器和产品壳回归保持通过。

## 8. 后续阶段 F1.2c-3b-2b（已完成）

任务级请求已通过 `executionLeaseId + capability contract` 精确绑定，详见
[Windows 任务级文件同意队列 F1.2c-3b-2b](./mooyu-capability-executor-f1-2c3b2b.zh-CN.md)。
F1.2c-3b-2c 已完成文件身份复验和运行期句柄锁；最小托盘视觉、安装目录 ACL、打包器和生产签名仍是后续工作。

OCR 仍只是未来第一个消费者，不属于授权内核本身。
