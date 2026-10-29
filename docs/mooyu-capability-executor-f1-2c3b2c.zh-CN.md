# 墨鱼工坊 Windows 本地授权中心与文件身份锁 F1.2c-3b-2c

版本：v1.1
状态：统一授权中心、双重文件身份复验和运行期句柄锁已完成
更新日期：2026-10-28

## 1. 阶段结论

F1.2c-3b-2b 已能把一次文件同意精确绑定到 `executionLeaseId + capability key/version`，但还留下两个产品化缺口：

1. 托盘或桌面控制器只能取得原始请求数组，缺少统一计数、可操作状态和有界历史；
2. JavaScript 复验路径、大小、时间和 SHA-256 后，到原生沙箱真正打开文件之间仍有窄 TOCTOU 窗口。

本阶段没有复制一套 UI 权限逻辑，而是在既有 broker 和认证命名管道上形成稳定控制合同；文件安全则下沉到可信 Windows sandbox host。

## 2. 授权中心合同

认证控制通道新增：

```powershell
node scripts/windows-desktop-shell-cli.mjs file-consent-center `
  --root C:\ProgramData\Mooyu
```

响应固定为 `capability-desktop-file-consent-center-v1`，包含：

- `notificationCount`：当前可操作的 waiting 请求数；
- `activeCount`：waiting + selecting；
- 六态计数：waiting、selecting、approved、rejected、cancelled、expired；
- 最多 200 条有界历史；
- 每条请求的 capability contract、execution lease、时间、状态和 actionable；
- 不包含任务正文、提示词、本机路径、文件内容、哈希或 DPAPI 密文。

原 `file-consent-requests`、批准和拒绝命令保留兼容。桌面壳状态投影升级为 v2，并只嵌入通知数和活动数；需要列表时由控制器读取授权中心，避免在不同 UI 中重做权限判断。

活动请求不会为了裁剪历史而被静默丢弃。活动请求超过安全上限时失败关闭；已解决记录只保留最近窗口。

## 3. 文件身份链

系统选择器返回路径后，broker 打开文件并从同一句柄取得：

- Windows 卷标识（Node `stat.dev` / Win32 volume serial）；
- 64 位文件 ID（Node `stat.ino` / Win32 file index）；
- 文件大小；
- 同一打开句柄计算的 SHA-256。

绝对路径、身份和哈希只写入 CurrentUser DPAPI secret v4。明文请求账本和授权中心不保存这些值。

消费链执行两次复验：

1. Runner 打开文件，核对卷标识、File ID、大小和 SHA-256；
2. 原生 sandbox host 在添加 AppContainer ACL 前用 `CreateFile` + `GetFileInformationByHandle` 再次核对卷标识、File ID 和大小。

第二次打开使用 `FILE_FLAG_OPEN_REPARSE_POINT`，拒绝 reparse point。句柄只允许其他读取共享，不允许写入或删除共享，并持续持有到沙箱任务结束。因此：

- 即便替换文件内容完全相同、大小和时间可伪装，只要路径指向了另一个文件 ID 就拒绝；
- helper 复验后，攻击者无法在任务运行期间写入、删除或换掉该对象；
- 沙箱仍按只读 ACL 暴露原路径，不把宿主路径写入能力请求正文。

## 4. 兼容与失败语义

- 能力级旧预授权继续兼容读取 v1-v3 secret，并在消费时补采身份；
- 生产 `requireTaskBinding=true` 路径只接受带身份的 v4 secret；
- 错租约、错能力版本、重放、身份不匹配、reparse point、文件消失和句柄无法打开全部失败关闭；
- 授权被领取后，即使身份校验失败也收敛为 consumed，避免重复弹框或反复试探；
- Windows helper 请求协议升级为 v2，旧 helper 不会被误当作支持文件身份锁的新版本。

## 5. 验收证据

- 同内容、同大小的新文件替换原路径时，broker 按 File ID 拒绝；
- 原生 helper 独立拒绝同类替换，错误发生在不可信进程启动前；
- helper 持有句柄期间，外部写入被 Windows sharing violation 阻断，任务结束后恢复；
- 授权中心覆盖六种状态、通知数、可操作标记、200 条上限和敏感字段缺失；
- 活动请求始终排在已解决历史之前，避免新请求被大量历史记录遮挡；
- Windows 状态文件原子替换遇到短暂 `EPERM/EACCES` 时执行有界退避重试，超过上限仍失败关闭；
- 真实 CurrentUser DPAPI、命名管道、AppContainer、取消、超时、磁盘/诊断限制和内容寻址产物保持通过；
- 完整 F1.2 Windows 回归 63/63 通过，其中包含真实 CurrentUser DPAPI、HKCU 启动项、本机临时端口、原生 AppContainer 和文件句柄锁；
- 关键授权、取消、重启残留、同内容替换攻击和授权中心裁剪连续 10 轮、40/40 通过；原生 C# helper 已重新编译通过。

## 6. 后续阶段 F1.2c-3b-2d（已完成）

最小原生托盘、系统通知去重、前台选择器归属、键盘与基础无障碍路径已完成，详见 [Windows 最小原生托盘授权控制器 F1.2c-3b-2d](./mooyu-capability-executor-f1-2c3b2d.zh-CN.md)。权限判断仍只存在于 broker。

## 7. 明确未做

- 最终托盘品牌视觉、设置页和无障碍视觉精修；
- 安装器、Authenticode、时间戳和干净普通用户机器验收；
- OCR、论文版面或其他具体能力包；
- 云端代跑、自动上传或本地文件正文日志。

下一阶段应把托盘、Node 壳和原生 helper 纳入同一受信桌面制品与安装事务；不得绕过既有签名清单、可信更新和 broker 权限判定。
