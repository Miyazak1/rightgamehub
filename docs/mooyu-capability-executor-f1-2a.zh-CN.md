# 墨鱼工坊 Windows 本地能力执行器基座 F1.2a

版本：v1.0
状态：实现完成并通过本机自动化验收；F1.2b-1 JavaScript 运行边界已继续完成，原生宿主与普通用户安装器尚未实现
更新日期：2026-10-28

## 1. 阶段目标

F1.2a 把已经完成的可信节点身份与 Runtime 本地租约协议落到一个可验证的 Windows 参考执行器内核。它解决四个基座问题：

1. 节点秘密怎样只保存在当前 Windows 用户可解密的系统保护域；
2. 能力包怎样在执行任何字节前完成发行签名、归档哈希、文件清单和解包边界校验；
3. 多个能力版本怎样隔离安装、原子激活、复用和回滚；
4. 设备或进程崩溃后，怎样既不丢失已产生的结果，也不盲目重放结果不确定的本地动作。

本阶段使用伪能力包验证供应链与运行协议，不接入真实 OCR，不把未经沙箱约束的任意可执行文件交给用户运行。

## 2. 实现构成

工作区应用 `apps/capability-executor` 提供以下端口：

- `credential-vault.mjs`：使用 Windows DPAPI `CurrentUser` 保护节点会话与运行日志；Node 与 PowerShell 之间使用 Base64 二进制协议，避免系统代码页破坏中文秘密；
- `node-api-client.mjs`：配对、心跳、能力包事件、Stage 领取/续租/完成/失败；访问 Token 过期后只轮换一次；
- `package-contracts.mjs`：稳定序列化发行声明并使用 Ed25519 验证签名；
- `secure-zip.mjs`：有界解包，拒绝加密包、路径穿越、反斜杠、绝对路径、重复项、软链接、特殊文件和解压膨胀；
- `package-store.mjs`：按能力、语义版本与包哈希隔离安装，原子切换活动指针，保存上一个活动版本并支持回滚；
- `downloader.mjs`：只接受 HTTPS，不跟随重定向，流式限制大小并计算 SHA-256；
- `executor-runtime.mjs`：复用已验证包、持久化租约阶段、后台续租、提交结果和恢复未完成运行。

执行器只依赖接口化的 `runner.run()`，没有在基座中直接拼接 Shell 命令。F1.2b-1 已实现 runner 的严格安全边界、权限投影合同和内容寻址产物仓库；真正启动原生能力进程的 Windows Job Object 与受限 Token 宿主属于 F1.2b-2。详见 [Windows 原生能力运行安全边界](./mooyu-capability-executor-f1-2b1.zh-CN.md)。

## 3. 供应链不变量

发行者签名的 `capability-package-release-v1` 固定绑定：

- 能力 ID 与版本；
- 输入输出合同 Key 与版本；
- 桌面执行目标、适配器和支持平台；
- 下载 URL、归档 SHA-256、精确字节数和签名 Key ID。

安装顺序不可交换：

```text
HTTPS 有界下载
  → 归档字节数与 SHA-256
  → Ed25519 发行签名与 Key 生效窗口
  → 安全解包到随机 staging
  → capability.json 严格字段
  → 文件集合、逐文件大小与 SHA-256
  → 入口文件必须在清单内且声明 executable
  → 原子移动到版本隔离目录
  → 原子更新 active/previous 指针
```

任何一步失败都不会把 staging 目录标记为活动版本。已安装版本再次使用前会重新校验内部文件清单，不能仅相信数据库或活动指针。

## 4. 崩溃与不确定性语义

执行器在 DPAPI 保险库保存单个活动租约日志：

- `claimed`：已安全安装能力包，但原生动作尚未开始；重启后可以继续；
- `running`：原生动作可能已经产生外部效果；重启后报告 `uncertain`，绝不自动重跑；
- `result-pending`：结果已经完整产生并带稳定 `submissionId`；重启后向服务端幂等重交。

续租失败会触发 `AbortSignal`。支持协作取消的 runner 必须立即停止；即使 runner 忽略取消，执行器也不能在租约丢失后把结果提交为成功。

安装锁记录 PID 与时间。活进程持有的锁不会被回收；只有锁超过阈值且 PID 已不存在时才可回收，避免一次崩溃永久阻塞升级。

续期 Token 单次轮换另有“刷新意图”日志。刷新请求发出后若连接中断，执行器不会猜测服务端是否已经旋转 Token，而是失败关闭并要求重新配对，避免重放旧 Token 导致授权被吊销。

## 5. 自动化验收

测试文件：

- `tests/platform/capability-executor-package.test.cjs`
- `tests/platform/capability-executor-runtime.test.cjs`
- `tests/platform/capability-executor-node-client.test.cjs`

覆盖：

- 真实 Ed25519 签名包的安装、活动版本复验、双版本切换与回滚；
- 归档篡改、内部文件篡改和 ZIP 路径穿越拒绝；
- 崩溃遗留安装锁的有条件回收；
- 下载、安装、运行、结果提交和安装回执顺序；
- 已验证活动包复用，不重复下载；
- `result-pending` 幂等恢复与 `running` 不确定失败；
- 安全安装失败不启动原生代码；
- 租约续期失败触发 runner 取消；
- 节点 Token 轮换、轮换断电窗口失败关闭；
- Windows DPAPI 对包含中文的秘密完成真实保护、读取与删除。

运行命令：

```powershell
node --test tests/platform/capability-executor-package.test.cjs tests/platform/capability-executor-runtime.test.cjs tests/platform/capability-executor-node-client.test.cjs
```

## 6. 尚未完成的产品能力

F1.2a 不等于桌面端已经可下载。F1.2b-1 已完成 JavaScript 侧门禁；后续仍必须完成：

- F1.2b-2 Windows 原生沙箱宿主：受限 Token、Job Object、CPU/内存/进程树/超时约束和工作目录隔离；
- 能力权限到本地文件选择、网络域名和设备授权的操作系统级真实投影；
- 设备私钥生成、签名挑战与公钥绑定；
- 普通用户安装器、自动更新、托盘状态、配对 UI、暂停/退出和诊断导出；
- 发布 Key 撤销清单、紧急禁用和安全更新策略；
- 安装包签名和 Windows 发布流水线。

完成 F1.2b 后才能进入 F1.3：发布第一个真实论文版面/OCR 能力包，并在冻结评测集上验证质量、速度、内存和降级策略。
