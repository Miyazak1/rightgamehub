# 墨鱼工坊 Windows 最小原生托盘授权控制器 F1.2c-3b-2d

版本：v1.1
状态：最小原生托盘、授权窗口、通知去重和窗口归属已完成
更新日期：2026-10-29

## 1. 阶段结论

上一阶段已经冻结了权限事实源和授权中心合同。本阶段只增加 Windows 用户交互适配层：原生托盘读取经过认证、脱敏的授权中心，向 broker 发送批准或拒绝动作。它不判断能力是否有权读取文件，也不能把文件路径直接提交给 Runtime。

实现采用 .NET Framework WinForms 原生小程序，不引入 Electron、浏览器内核或第二套后台服务。服务器仍只承担控制面；托盘、系统文件选择器和文件读取都在用户自己的 Windows 会话中。

## 2. 进程和控制合同

`MooyuCapabilityTray.exe` 以 `当前 Windows 用户 + dataRoot` 的哈希作为实例身份：

- 每个用户、每个 dataRoot 只允许一个托盘实例；
- 重复启动只向既有实例发送“打开授权中心”信号，然后退出；
- 托盘经 CurrentUser DPAPI 解开本机 HMAC 控制密钥；
- 每次调用仍执行 challenge + HMAC v2 认证，不读取授权 JSON 文件绕过 broker；
- 控制通道断开时执行 2/5/10/30 秒有界退避，恢复后重新读取服务端投影；
- 明确选择“退出”才终止托盘；关闭授权窗口只隐藏窗口，不终止本地能力节点。

托盘只保留 requestId 通知去重账本，最多 200 条。账本不包含 capability、任务正文、本机路径、文件名、哈希或文件内容。壳重启后同一请求不会再次弹出气泡通知。

## 3. 前台窗口与文件选择

批准命令新增可选 `ownerWindowHandle`，格式只能是非零十进制窗口句柄。该值：

- 只存在于一次经过 HMAC 认证的 IPC 请求；
- 不写入同意请求账本、授权索引或日志；
- 不参与权限判断；
- 只交给 Windows `OpenFileDialog.ShowDialog(owner)`，让系统选择器正确归属授权窗口并回到前台。

托盘仍不能提供路径。真正的路径只由系统选择器返回给 broker，随后进入既有 DPAPI v4、文件身份复验和原生句柄锁链路。

## 4. 交互与无障碍

授权窗口展示的字段限定为 capability key、waiting/selecting 状态和请求时间。产品动作：

- `Enter`：批准所选 waiting 请求并打开系统选择器；
- `Delete`：经确认后拒绝；
- `Escape`：隐藏窗口；
- 上下方向键：在请求列表中移动；
- 刷新：重新读取授权中心；
- 托盘双击、气泡点击或重复启动：打开并置前窗口。

窗口、请求列表、状态文本和四个按钮均设置稳定的 AccessibleName/Description；忙碌或 selecting 状态会禁用批准和拒绝，避免重复动作。UI 不显示本机路径和任务正文。

## 5. 构建与启动

构建生产 `winexe` 和仅供验收捕获输出的 console 版本：

```powershell
./scripts/build-capability-tray-windows.ps1
```

在节点已经运行并生成本机控制密钥后启动：

```powershell
./scripts/start-capability-tray-windows.ps1 `
  -DataRoot 'C:\ProgramData\Mooyu'
```

正式安装器尚未实现，因此当前启动脚本是开发/验收入口，不等于生产安装完成。

## 6. 故障与隐私边界

- IPC、DPAPI 或节点不可用：显示“正在重连”，不猜测授权状态；
- 请求已被其他窗口处理：刷新后以 broker 状态为准；
- 文件选择取消：请求保持 waiting，不生成授权；
- 托盘崩溃：Runtime 请求仍在 broker 中按原到期时间失败关闭；
- 通知账本损坏：只丢失去重体验，不扩大权限；
- 选择器 owner 句柄异常：选择器失败，broker 把 selecting 恢复为 waiting；
- 托盘没有上传、云端代跑、文件正文日志或本地模型推理能力。

## 7. 验收

- 原生 WinForms 生产版与 acceptance 版均由 Framework64 C# 编译器成功构建；
- 真实 CurrentUser DPAPI + challenge/HMAC 命名管道读取授权中心通过；
- 原生输出仅含通知数、活动数和 requestId，不含 capability、路径或正文；
- 同一 requestId 两次通知探测结果为 1、0，证明重启去重账本生效；
- 同一用户和 dataRoot 的第二个实例返回稳定冲突退出码；
- 托盘在控制面离线时先启动，节点随后恢复后能够自动重连并写入该请求的去重记录；
- 客户端在 challenge 后立即断开时，迟到的 `EPIPE` 被限制在该连接内，后续认证客户端仍可正常使用；
- owner HWND 从认证 IPC 精确传到选择器适配器，非法零值失败关闭；
- 键盘动作、窗口名称和前台归属由原生 self-test 冻结；
- 完整 F1.2 Windows 回归共 69 项，已在真实 Windows 主机上以串行方式全部通过：69 通过、0 失败、0 跳过。

## 8. 明确未做

- 生产安装器、开始菜单、自动更新托盘制品和卸载 UI；
- Authenticode、时间戳、发布证书轮换和干净普通用户机器验收；
- 最终品牌图标、动效、主题、国际化和高 DPI 视觉精修；
- OCR、论文版面、游戏或其他具体能力包；
- 云端重计算或服务器代替用户点击授权。

下一阶段应先做 `F1.2c-3b-2e` 桌面制品供应链与安装生命周期：把托盘、Node 壳和原生沙箱 helper 纳入同一签名清单、可信更新和安装/修复/卸载事务。在该阶段完成前，不把当前开发构建称为可分发桌面端。
