# 墨鱼工坊 Windows 桌面节点产品壳基础 F1.2c-3b-1

版本：v1.0
状态：产品壳控制面、HKCU 自启适配、安装账本与安全卸载基础已完成；最终托盘 UI、安装包和生产签名尚未完成
更新日期：2026-10-28

## 1. 阶段结论

F1.2c-3a 已经解决“节点如何长期可靠运行”，本阶段解决“普通用户产品如何安全地管理这个节点”。二者仍共用一个 supervisor 和一个数据目录，产品壳不拥有第二套任务循环。

已建立的稳定边界：

1. `capability-desktop-shell-installation-v1` 原子安装账本；
2. 当前用户 `HKCU Run` 自启适配器，写入后必须读回逐字节核验；
3. 单调升级、降级阻断、安装中断恢复和 `repair-required` 状态；
4. DPAPI 控制密钥 + 每连接一次性挑战的本机命名管道；
5. 托盘/前台未来可直接消费的只读状态投影与可用动作；
6. 卸载先停止领取、等待当前运行排空，再撤销自启和控制密钥；
7. 默认保留能力包、运行日志和用户数据，不接受模糊递归删除；
8. `install/repair/serve/startup-enable/startup-disable/status/pause/resume/stop/diagnostics/uninstall` 稳定 CLI 边界。

这仍不是向普通用户分发的正式安装器，也没有宣称完成 Authenticode。

## 2. 组件

| 组件 | 职责 |
| --- | --- |
| `desktop-shell-state.mjs` | 安装账本、严格 Schema、产品状态与动作投影 |
| `windows-startup-registry.mjs` | 当前用户自启注册、命令行转义、写后核验和撤销 |
| `desktop-shell-ipc.mjs` | 受认证的本机命名管道控制与脱敏诊断 |
| `desktop-shell-manager.mjs` | 安装、升级、修复、自启切换、安全卸载和恢复 |
| `desktop-shell-host.mjs` | 让控制管道与唯一 supervisor 同生命周期运行 |
| `windows-desktop-shell-cli.mjs` | 无 GUI 产品壳入口，供未来安装器与托盘调用 |

## 3. 为什么不能只开放控制文件

F1.2c-3a 的控制队列是可靠的内部机制，但不能直接当产品 IPC。任何能猜到数据目录的进程都不应仅靠写 JSON 获得控制权。

产品壳采用以下协议：

1. 服务端在命名管道连接后生成 256 位随机挑战；
2. 客户端从当前用户 DPAPI vault 读取控制密钥；
3. 客户端对协议版本、挑战、请求 ID 和命令做 HMAC-SHA256；
4. 服务端常量时间校验，并且每个连接只接受一个命令；
5. 挑战十秒内失效且不复用，录制请求不能重放；
6. 服务端只接受固定命令，不接受命令行、文件路径或任意 JSON 操作。

命名管道不是身份凭据；DPAPI 当前用户秘密才是控制授权边界。同一 Windows 用户下的恶意进程不在本阶段提供强隔离，后续正式安装器还需要目录 ACL 与签名程序边界。

## 4. 安装与升级状态

```text
不存在
  → installing
     ├─ installed
     └─ repair-required

installed
  → 同版本修复
  → 更高版本升级
  → uninstalling → uninstalled
```

- 安装账本写入 `dataRoot/desktop-shell/installation.json`，使用临时文件和原子重命名；
- 版本必须为 SemVer；更低版本失败关闭，不能静默覆盖；
- 自启写入失败时不能显示“已安装”，而是留下可恢复的 `repair-required`；
- `repair` 根据账本的期望状态重新核验自启；
- 重新安装已经卸载的产品会创建新的 installationId；
- 本阶段只管理产品壳权属，不移动或删除用户输入文件。

## 5. 自启选择

本阶段选择当前用户 `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run`，原因是：

- 不需要管理员权限；
- 与 DPAPI CurrentUser 和交互式托盘会话一致；
- 当前只需要用户登录后常驻，不需要无人登录系统服务；
- 注册、查询和撤销都可以做真实可逆验收。

这不是永久冻结。正式安装器阶段会比较“HKCU Run”和受限计划任务；只有出现无人登录运行等明确需求，才评估 Windows Service。4 核 8G 的单服务器不参与桌面自启。

## 6. 卸载策略

卸载顺序固定：

1. 读取安装账本；
2. 如果节点仍活跃，请求优雅停止；
3. 等待 `stopped` 或进程确认消失，超时则失败并留下修复状态；
4. 删除 HKCU 自启值并再次查询确认；
5. 删除 DPAPI 保护的产品控制密钥；
6. 标记 `uninstalled + dataPreserved=true`。

本阶段不实现 `--purge-data`。未来即使提供，也必须单独确认并只删除账本明确归属的目录；不能对用户文件、能力产物或未知目录执行递归删除。

## 7. CLI

安装器内部使用：

```powershell
node scripts/windows-desktop-shell-cli.mjs install --config C:\ProgramData\Mooyu\desktop-shell.json
node scripts/windows-desktop-shell-cli.mjs repair --config C:\ProgramData\Mooyu\desktop-shell.json
node scripts/windows-desktop-shell-cli.mjs serve --config C:\ProgramData\Mooyu\desktop-shell.json
node scripts/windows-desktop-shell-cli.mjs startup-disable --config C:\ProgramData\Mooyu\desktop-shell.json
node scripts/windows-desktop-shell-cli.mjs startup-enable --config C:\ProgramData\Mooyu\desktop-shell.json
```

产品控制：

```powershell
node scripts/windows-desktop-shell-cli.mjs status --root C:\Users\USER\AppData\Local\Mooyu\CapabilityNode
node scripts/windows-desktop-shell-cli.mjs pause --root C:\Users\USER\AppData\Local\Mooyu\CapabilityNode
node scripts/windows-desktop-shell-cli.mjs diagnostics --root C:\Users\USER\AppData\Local\Mooyu\CapabilityNode --output C:\Temp\mooyu-diagnostics.json
node scripts/windows-desktop-shell-cli.mjs uninstall --root C:\Users\USER\AppData\Local\Mooyu\CapabilityNode
```

示例配置见 `docs/examples/capability-desktop-shell-config.example.json`。配置不含平台 Token、模型 Key、控制密钥或签名私钥。

## 8. 验收证据

自动化覆盖：

- 安装、同 ID 升级、降级阻断和修复；
- 自启失败留下可恢复账本；
- 正在运行时卸载会等待排空，撤销控制密钥并保留数据；
- 命名管道正确密钥成功，错误密钥失败；
- 状态和诊断不泄露 Token；
- host 与唯一 supervisor 共享生命周期；
- Windows 命令行空格、引号和尾部反斜杠转义；
- 真实 HKCU 随机测试键写入、读取、删除的可逆验收。

## 9. 下一阶段 F1.2c-3b-2

下一阶段才做面向人的产品呈现与安装制品：

1. 最小托盘 UI：状态、暂停/恢复、立即检查更新、诊断和退出；
2. 文件选择器产生短期逻辑文件授权，不接受配置中的任意路径；
3. 安装目录 ACL、程序文件清单和安全清理；
4. 打包器、安装/修复/卸载 E2E，覆盖干净用户、重启、断网和升级失败；
5. 正式 Authenticode 与时间戳服务接入点；没有真实证书时保持“未签名测试制品”；
6. 生产发布后再接第一个 OCR 能力包。

其中 F1.2c-3b-2a 已先完成系统文件选择器、DPAPI 路径保管、能力绑定、单次消费和文件替换阻断；详细见 [Windows 本地文件授权内核 F1.2c-3b-2a](./mooyu-capability-executor-f1-2c3b2a.zh-CN.md)。任务级绑定、托盘视觉和安装制品继续在后续子阶段完成。

OCR、论文解析和其他工具仍是能力包，不进入桌面产品壳核心。
