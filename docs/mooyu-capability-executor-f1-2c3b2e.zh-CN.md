# 墨鱼工坊 Windows 可信桌面制品与安装生命周期 F1.2c-3b-2e

版本：v1.1
状态：可信桌面发行、原子安装、修复、升级回滚和明确卸载已实现
更新日期：2026-10-29

## 1. 阶段结论

本阶段把此前分离的 Node 桌面壳、原生托盘和 Windows 沙箱 helper 收进同一个内容寻址发行制品。安装器不再接受“某几个文件大概来自同一版本”这种隐含关系：四个入口和全部运行依赖都由一个 Ed25519 签名清单绑定，安装后每次读取活动版本都会重新核对文件集合、大小和 SHA-256。

这仍是无交互工程安装链路，不是面向普通用户的图形安装向导。生产 Authenticode 证书、时间戳、品牌安装 UI 和系统级服务不在本阶段内。

## 2. 发行制品

清单 `desktop.json` 使用 `windows-desktop-release-v1`，固定绑定：

- `bin/node.exe`：随产品发行的 Node 运行时；
- `app/scripts/windows-desktop-product-host.mjs`：统一启动入口；
- `bin/MooyuCapabilityTray.exe`：原生授权托盘；
- `bin/MooyuCapabilitySandboxHost.exe`：原生沙箱 helper；
- 桌面壳、节点、更新器、能力执行器源码模块及精确解析出的 npm 运行依赖。

清单对 `productId`、版本、平台、最低 Windows build、签名 key、全部文件和四个入口签名。即使签名有效，产品安装协调器仍只接受 `mooyu.windows.capability-desktop`，错误产品 ID 在激活之前失败关闭。

构建命令：

```powershell
node scripts/build-windows-desktop-release.mjs `
  --output 'C:\Build\Mooyu Desktop 1.0.0' `
  --private-key 'C:\Keys\desktop-release-private.pem' `
  --key-id 'desktop-release-2026' `
  --version '1.0.0'
```

构建器通过 Node 模块解析器定位 pnpm 的真实包目录，不假设传统扁平 `node_modules`。

## 3. 安装布局与事务

程序根和数据根严格分开：

- `installRoot/product-versions/...`：按产品、版本和 manifest hash 内容寻址；
- `installRoot/product-state/.../active.json`：活动版和上一个可回滚版；
- `dataRoot/desktop-shell/installation.json`：用户域桌面壳与启动注册状态；
- `dataRoot/vault`、运行日志、授权、下载包和用户内容：卸载默认保留。

安装流程：

1. 在源目录原地验证清单签名、完整文件集和逐文件哈希；
2. 复制到随机 staging，再次完整验证；
3. 原子重命名为内容寻址版本目录；
4. 原子切换 active/previous 状态；
5. 使用安装版 `node.exe + product host` 写入 HKCU Run；
6. 只有上述步骤全部成功才报告 installed。

活跃 PID 持有安装锁时第二个安装者返回稳定 busy；只有锁文件超过期限且原 PID 已消失才回收。

## 4. 修复、回滚与恢复

- 注册表或桌面壳账本异常：`repair` 重新从已验证活动版本生成启动命令；
- 活动文件被改写：必须提供同一 manifest hash 的签名源制品，修复器才重建版本目录；
- 修复替换失败：先恢复隔离的最后好副本，恢复也失败时保留 quarantine，不删除唯一好副本；
- 升级注册失败：产品版本回滚至 previous，并通过仅供事务恢复的内部降级通道恢复旧启动命令；
- 普通用户主动安装旧版本仍由原有降级保护拒绝；
- 文件版本已激活而桌面壳停在 installing/repair-required：`recover` 以活动签名版本为事实源重建壳状态。

## 5. 无交互运维 CLI

配置使用 `windows-desktop-product-config-v1`，包含程序根、数据根、发行源、桌面壳配置、启动项名称和可信发行公钥。

```powershell
node scripts/windows-desktop-product-cli.mjs install   --config C:\Mooyu\product.json
node scripts/windows-desktop-product-cli.mjs status    --config C:\Mooyu\product.json
node scripts/windows-desktop-product-cli.mjs repair    --config C:\Mooyu\product.json
node scripts/windows-desktop-product-cli.mjs recover   --config C:\Mooyu\product.json
node scripts/windows-desktop-product-cli.mjs uninstall --config C:\Mooyu\product.json
```

稳定退出类：配置 10、并发 20、本地状态 30、信任 40、修复/回滚 50、安装生命周期 60、内部错误 70。

## 6. 卸载边界

卸载顺序为：停止节点、移除 HKCU 启动项、移除本地控制密钥、标记桌面壳已卸载、停用产品版本、删除程序版本目录。默认不删除 `dataRoot`，因此用户授权历史、配置和本地内容不会被一次程序卸载静默清除。

本阶段没有提供“删除全部用户数据”开关。未来若增加，必须是单独命令、明确路径预检和再次确认，不能复用普通 uninstall。

## 7. 验收

- 清单篡改、入口越界、错误角色和错误产品 ID失败关闭；
- 含空格路径的安装、幂等重装、升级和回滚通过；
- 活跃并发锁拒绝第二安装者；
- 活动托盘字节被篡改后，使用精确签名源修复成功；
- 启动注册故障触发完整产品和桌面壳双回滚；
- 中断态桌面壳账本可由活动签名版本恢复；
- 真实 Windows 构建同时编译托盘和沙箱 helper，并打包 Node 与 pnpm 实际依赖；
- 打包后的 Node 能独立加载桌面壳；
- 真实 HKCU 安装、查询、修复、卸载闭环通过，随机测试启动项已清理；
- 卸载后程序版本为空，用户数据哨兵仍存在。
- 扩展后的完整 F1.2 Windows 回归共 77 项，真实普通用户令牌下 77 通过、0 失败、0 跳过；覆盖 AppContainer、DPAPI、HKCU、原生托盘、签名运行时与完整桌面发行制品。

真实 Windows 验收必须在普通用户的真实令牌上下文运行。若在限制注册表和 Token API 的命令沙箱中运行，会得到 `CAPABILITY_SANDBOX_TOKEN_CREATE_FAILED`、`CAPABILITY_DESKTOP_SHELL_STARTUP_ENABLE_FAILED` 等环境性失败；这类结果不能作为产品失败或通过证据。安装状态的原子替换对 Windows 短暂 `EPERM/EACCES` 采用有限指数退避，超过上限仍失败关闭，不宣称安装成功。

## 8. 明确未做

- 生产 Authenticode、时间戳和证书轮换；
- MSI/MSIX、图形安装向导、开始菜单和系统“应用和功能”注册；
- 自动下载桌面产品 catalog；当前在线更新只覆盖既有沙箱 runtime；
- 自动删除用户数据；
- OCR、论文解析或其他能力包本身。

下一阶段应做 `F1.2c-3b-2f` 桌面发行在线更新与普通用户安装包装：为整个桌面产品增加签名 catalog、断点续传、健康门、失败回滚和可审计更新策略，再决定 MSI/MSIX 包装与 Authenticode 接入顺序。
