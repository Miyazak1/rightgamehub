# 墨鱼工坊 Windows 原生沙箱宿主 F1.2b-2

更新时间：2026-10-28
状态：源码、构建脚本、Node 可信适配器与真实 Windows 进程验收已完成；尚未制作桌面安装器，尚未接入 OCR

## 1. 本阶段解决什么

F1.2b-1 只建立了 JavaScript 侧安全门禁，明确禁止用普通 `spawn` 冒充沙箱。本阶段补齐真正的 Windows 宿主，使签名能力包只能在以下边界内运行：

- 临时 AppContainer，默认没有网络 capability；
- 禁用宿主权限的 restricted primary token；
- 子进程恢复前强制验证 `TokenIsAppContainer=1` 且完整性 RID 不高于 Low（4096）；
- Job Object 在恢复线程前绑定，限制进程数、内存和 CPU，宿主退出时杀死整个进程树；
- 能力安装目录只读、单次工作目录可写、用户文件 grant 只读；
- 工作目录磁盘用量、stdout/stderr、运行时间和取消都有硬上限；
- 设备和网络域只要不是空集合即失败关闭，本阶段不接受“声明了就放行”；
- 子进程拿不到模型 Key、节点凭据、平台令牌或完整宿主环境。

## 2. 组件与信任边界

| 组件 | 信任级别 | 职责 |
| --- | --- | --- |
| `windows-native-runner.mjs` | 执行器可信代码 | 重验入口哈希、冻结策略、构造协议、收取本地产物 |
| `windows-sandbox-host.mjs` | 执行器可信适配器 | 每次运行校验 helper SHA-256、限制宿主环境、传递取消、验证返回协议 |
| `MooyuCapabilitySandboxHost.exe` | 随桌面端分发的可信 helper | 创建 AppContainer/Token/ACL/Job，启动并监管不可信能力进程 |
| 能力 EXE | 不可信 | 只能读取明确授权输入并写入单次输出目录 |

helper 哈希必须来自受信安装清单，不能由能力包提供。生产安装位置必须是普通用户不可写的应用目录；能力包、工作区和产物库必须位于执行器管理根。任意外部文件只能经 file-grant broker 逐项授权。

## 3. Windows 隔离实现

### 3.1 Token 与 AppContainer

宿主先从当前 primary token 创建 `DISABLE_MAX_PRIVILEGE` restricted token，再为每次运行创建唯一临时 AppContainer profile。子进程使用 `PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES` 且 capability 列表为空，因此默认断网。

真实 Windows 验证表明，先叠加 `LUA_TOKEN | WRITE_RESTRICTED` 再创建 AppContainer 会使普通 Win32/CLR 程序在 DLL 初始化阶段失败。当前组合保留“全部权限禁用”的 restricted token，由 AppContainer 生成 Low 子 token，并在恢复线程前读回验证；验证失败即终止 Job，绝不降级为普通进程。

### 3.2 文件系统

- 安装根：`ReadAndExecute`；
- 单次工作根：`Modify + ReadAndExecute`；
- file grants：仅 `ReadAndExecute`；
- ACL 使用本次 AppContainer SID，运行结束后逐条撤销；
- 能力不能指定任意工作根，根目录由执行器配置并提前创建；
- 目录统计不跟随 reparse point，超过 `diskMiB` 即终止整个 Job。

### 3.3 Job Object 与终止

- `KILL_ON_JOB_CLOSE`；
- active process limit = 8；
- `PROCESS_MEMORY` 使用冻结策略中的 `memoryMiB`；
- CPU hard cap 按 `cpuCores / 主机逻辑核数` 换算；
- timeout、取消文件、诊断流越界、磁盘越界都会终止 Job，而不是只杀入口 PID。

稳定终止原因：`exited`、`timeout`、`cancelled`、`diagnostic-limit`、`disk-limit`。

## 4. 构建与固定哈希

Windows 10/11 自带的 .NET Framework x64 C# 编译器即可构建，不要求服务器或用户额外安装大型 SDK：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File scripts/build-capability-sandbox-host-windows.ps1
```

脚本输出 helper 和验收 fixture 的绝对路径及 SHA-256。桌面打包阶段必须把 helper 哈希写入受信安装清单；Node 适配器每次运行前重新计算并比对。开发目录 `.runtime/` 内的二进制不是发布物，也不进入 Git。

## 5. 验收

```powershell
$env:MOOYU_WINDOWS_SANDBOX_ACCEPTANCE='1'
node --test tests/platform/capability-executor-windows-sandbox-host.test.cjs
```

当前真实验收覆盖：

1. helper 篡改失败关闭；
2. 网络或设备提权策略在启动前拒绝；
3. 真实 CLR 子进程报告 AppContainer=true、完整性 RID=4096、网络连接失败；
4. timeout 杀死 Job 进程树；
5. AbortSignal 取消、诊断上限和磁盘上限返回稳定原因；
6. native runner → Windows helper → 真实能力 → content-addressed artifact store 全链路成功。

## 6. 尚未完成

- helper 的正式代码签名、安装器和自动更新；
- 桌面 UI、节点配对 UI、诊断导出；
- 对非空网络域的 Windows Filtering Platform 精细放行；
- 摄像头、麦克风、GPU 等设备能力的显式授权；
- 首个 OCR 能力包及模型资产下载。

因此 F1.2b-2 完成的是“可编译、可真实运行并失败关闭的 Windows 沙箱宿主 MVP”，不是 OCR 已上线，也不是桌面产品已经交付。
