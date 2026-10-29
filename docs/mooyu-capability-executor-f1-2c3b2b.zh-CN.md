# 墨鱼工坊 Windows 任务级文件同意队列 F1.2c-3b-2b

版本：v1.0
状态：任务级请求、租约精确绑定、已认证控制通道和失败关闭恢复已完成
更新日期：2026-10-28

## 1. 本阶段解决什么

F1.2c-3b-2a 的能力级预授权只能表达“把文件交给这个能力的下一次运行”。当同一能力并发执行多个任务时，这不够精确。本阶段把生产路径改为：

1. Runtime 以 `executionLeaseId + capability contract key + version` 创建本机同意请求；
2. 明文请求账本不保存任务正文、本机路径、文件内容或远程输入；
3. 当前 Windows 用户只能经 DPAPI HMAC 认证的命名管道查看、批准或拒绝；
4. 批准动作打开 Windows 系统选择器，并把所得授权精确绑定到该请求；
5. Runtime 等待期间继续处于原租约执行链，既有续租循环不会停止；
6. 拒绝、取消、超时、错租约、错能力、重放和重启遗留均失败关闭。

能力级预授权 API 暂时保留给兼容工具，但产品壳生产 composition 强制 `requireTaskBinding=true`，不会消费未绑定授权。

## 2. 本机账本

`file-consent-requests.json` 只保存：

- requestId；
- executionLeaseId；
- capabilityKey；
- capabilityVersion；
- `waiting/selecting/approved/rejected/cancelled/expired`；
- 创建、到期和解决时间。

任务输入、提示词、文章内容、本机路径和文件内容不会进入该账本。选择后的绝对路径和文件身份仍只进入 CurrentUser DPAPI vault；明文授权索引仅增加 executionLeaseId、requestId 与 capabilityVersion，用于精确匹配。

## 3. 状态与崩溃语义

```text
Runtime 请求 user-selected 文件
  → 建立 waiting 请求
  → 有界轮询；AbortSignal 可取消
  → 本机用户拒绝：rejected，任务安全失败
  → 到期：expired，任务安全失败
  → 本机用户批准：selecting
     → Windows 系统选择器
     → DPAPI 写入任务绑定授权
     → approved
  → runner 原子领取授权：pending → consuming
  → 文件身份重验并进入沙箱
  → consumed，删除 DPAPI 路径
```

如果进程在 `selecting` 中崩溃，下一实例把该请求收敛为 expired，不猜测用户是否完成选择。遗留 `consuming` 仍按上一阶段规则收敛为 consumed。同一租约的 approved 请求若已无待消费授权，返回 `CAPABILITY_DESKTOP_FILE_CONSENT_REPLAYED`，不会再次弹框。

## 4. 控制通道

命名管道协议升级为 v2，HMAC 覆盖 challenge、requestId、command 和规范化 payload，避免参数被替换。稳定命令为：

```powershell
node scripts/windows-desktop-shell-cli.mjs file-consent-requests `
  --root C:\ProgramData\Mooyu

node scripts/windows-desktop-shell-cli.mjs approve-file-consent `
  --root C:\ProgramData\Mooyu `
  --request 00000000-0000-4000-8000-000000000000 `
  --extensions .pdf,.png `
  --max-files 10

node scripts/windows-desktop-shell-cli.mjs reject-file-consent `
  --root C:\ProgramData\Mooyu `
  --request 00000000-0000-4000-8000-000000000000
```

批准命令允许长时间等待系统选择器；challenge 仍只有短有效期。服务器、网页和模型没有传入本机路径的参数。

## 5. 已验收

- 同能力两个并发租约得到两个独立请求，批准一个不会释放另一个；
- 同一租约的 capability key 或 version 不一致时失败关闭；
- 请求明文不含任务输入、文件路径和文件内容；
- 批准、拒绝、取消、超时、重启遗留和重放均有确定结果；
- 系统选择器取消后请求保持 waiting，不产生授权；
- 授权继续执行扩展名、普通文件、mtime、大小和 SHA-256 复验；
- 真实 Windows CurrentUser DPAPI 与命名管道集成通过；
- 原有预授权、Runtime、原生沙箱、更新器、常驻节点和产品壳回归保持通过。

## 6. 后续阶段 F1.2c-3b-2c（已完成）

统一授权中心、卷标识 + File ID 双重复验及运行期只读句柄锁已完成，详见 [Windows 本地授权中心与文件身份锁 F1.2c-3b-2c](./mooyu-capability-executor-f1-2c3b2c.zh-CN.md)。

## 7. 仍未做

- 最终托盘视觉、系统通知和安装器 UI；
- OCR、论文版面或其他具体能力包；
- Authenticode、安装包签名和干净机器发布验收。

下一小阶段只应把现有控制器合同映射到最小原生托盘交互；不能在 UI 中复制一套权限逻辑。
