# 墨鱼工坊 Windows 整体桌面在线更新与普通用户安装包装 F1.2c-3b-2f

版本：v1.0
状态：签名产品目录、断点续传、事务恢复、健康失败回滚与无管理员 bootstrap 已实现
更新日期：2026-10-29

## 1. 阶段结论

本阶段把 F1.2c-3b-2e 的可信桌面制品真正接入在线产品更新。现在更新单位是完整桌面产品，而不是单独替换 Node、托盘或沙箱 helper。产品目录、桌面发行清单和下载归档形成三层独立校验；任何一层的版本、哈希、签名、撤销状态或文件集合不一致，都在激活之前失败关闭。

同时提供无需管理员权限的普通用户安装包装。程序和数据只写入当前用户的 `LOCALAPPDATA`，启动项只使用 HKCU。安装包不请求 UAC，不创建系统服务，也不写 Program Files。卸载默认移除程序和当前用户启动项，保留用户数据。

这仍不是 MSI/MSIX 图形向导，也没有生产 Authenticode 证书。它是可被未来图形安装器调用的完整、安全、可审计安装与更新内核。

## 2. 两条独立信任链

桌面发行继续使用 `windows-desktop-release-v1`，签名绑定产品 ID、产品版本、平台、最低 OS build、全部文件及四个入口。

在线发布使用独立的 `windows-desktop-update-catalog-v1`：

- `catalogId + sequence`：目录单调序列，防止回放旧目录；
- `productId + releaseSequence`：产品发布单调序列，防止降级；
- `manifestSha256`：精确绑定签名桌面清单字节；
- `archive.sha256 + sizeBytes`：精确绑定传输归档；
- `generatedAt / expiresAt`：目录有效期；
- `keyId` 与 key 生效窗口：目录签名密钥轮换；
- `revokedManifestSha256s`：紧急撤销具体桌面发行。

目录签名 key 与桌面发行签名 key 分开管理。目录 key 泄漏不能伪造一个通过发行清单验证的新产品，发行 key 泄漏也不能单独让旧目录回放成功。

## 3. 下载、缓存与更新事务

更新器执行以下确定顺序：

1. 通过 HTTPS 获取目录；测试环境只允许显式开启的 localhost HTTP；
2. 校验目录签名、有效期、key 窗口、目录序列和等序列不可变性；
3. 选择当前平台与 OS 可运行、未撤销且发布序列最高的产品；
4. 以归档 SHA-256 为缓存键下载；中断后使用 `Range` 和 ETag 续传；
5. 已完成缓存每次复验大小和 SHA-256，污染缓存自动删除并重取；
6. 安全解压到随机临时目录，拒绝目录穿越和超限归档；
7. 核对 `desktop.json` 精确哈希，再验证发行签名、完整文件集和逐文件哈希；
8. 写入 `installing` 事务日志，再由产品协调器内容寻址安装；
9. 写入 `health-check`，核对活动产品和桌面壳都指向目标 manifest；
10. 健康失败时自动回退 previous；首次安装失败则停用目标并移除启动项；
11. 写入 `committing`，最后原子提交更新状态并清除事务日志。

`installing / health-check / committing` 三种中断状态都可恢复。提交阶段只有在活动产品确实是目标 manifest 时才补交状态；其他未提交阶段回滚目标或恢复产品协调器，不会把不确定状态标记为成功。

## 4. 普通用户安装包装

`windows-desktop-bootstrap-config-v1` 固定：

- 程序目录名与数据目录名；
- 包内初始签名发行目录；
- 桌面壳配置名和 HKCU 启动项名；
- 在线目录 URL；
- 可信发行 keyring 与可信目录 keyring。

构建普通用户包：

```powershell
node scripts/build-windows-desktop-bootstrap-package.mjs `
  --release 'C:\Build\Mooyu Desktop 1.0.0' `
  --output 'C:\Build\Mooyu Desktop User Package' `
  --config 'C:\Build\bootstrap.json'
```

输出包括包内签名发行、`bootstrap.json` 以及：

- `install-user.cmd`：只从包内签名发行首次安装；
- `update-user.cmd`：从签名在线目录更新；
- `repair-user.cmd`：从在线精确发行修复；
- `uninstall-user.cmd`：卸载程序，默认保留数据。

命令统一调用包内 Node，不依赖用户预装 Node，也不使用 `runas`。稳定退出类为：配置 10、并发 20、信任 30、网络 40、安装 50、健康 60、内部错误 70。

## 5. 发布目录构建

发布侧必须先产生与发行目录完全一致的 ZIP，再构建目录：

```powershell
node scripts/build-windows-desktop-update-catalog.mjs `
  --input 'C:\Build\desktop-catalog-build.json' `
  --output 'C:\Build\desktop-catalog.json' `
  --private-key 'C:\Keys\desktop-catalog-private.pem'
```

构建器会解压归档，逐项核对归档与发行目录中的 `desktop.json`、文件集合、大小和 SHA-256，之后才签名目录。生产私钥不进入仓库、不进入普通用户安装包，也不放在唯一一台 4 核 8G 生产服务器的应用容器中。

## 6. 单服务器边界

服务端只需托管静态目录和内容寻址 ZIP，并继续承担身份、调度和审计。下载、解压、安装、健康检查、回滚和将来的 OCR/论文版面计算都在用户本地完成。因此本阶段不会给现有 4 核 8G 服务器增加常驻重计算负担。

产品更新器和既有 runtime 更新器保持独立：runtime 更新器负责沙箱运行时；产品更新器负责 Node、桌面壳、托盘、沙箱 helper 和应用模块组成的整体产品。两者共享安全下载原语，但不共享发布序列或状态文件。

## 7. 验收范围

自动化覆盖：

- 目录签名篡改、过期、撤销、等序列异内容和序列回滚；
- HTTP Range 精确续传与 ETag；
- 完成缓存被污染后删除并重新下载；
- 含空格程序根和数据根；
- 活动安装字节被篡改后用同一签名发行在线修复；
- 安装健康失败后回滚上一版本；
- 更新锁拒绝并发更新；
- `health-check` 中断回滚和 `committing` 中断补交；
- 发布归档与发行目录逐字节一致；
- 普通用户包不包含提权命令，包内发行可验证；
- 既有真实 Windows AppContainer、DPAPI、HKCU、托盘、沙箱和桌面发行生命周期回归。

最终扩展 Windows 回归在真实普通用户令牌下为 82/82：82 通过、0 失败、0 跳过。回归中发现并补齐了能力包仓库、桌面发行构建器和 bootstrap 包构建器在 Windows 防病毒或索引器短暂占用目录时的有限 `EPERM/EACCES` 重试；超过上限仍失败关闭，不会把未完成构建报告为成功。

## 8. 明确未做

- 生产 Authenticode、时间戳、证书轮换和 SmartScreen 信誉；
- MSI/MSIX、图形安装向导、开始菜单和“应用和功能”注册；
- 系统级服务、Program Files 或计算机级启动项；
- 生产 CDN 上传和私钥托管自动化；
- OCR、论文版面或其他具体能力包；
- macOS/Linux 安装与签名。

下一阶段不应继续扩大安装框架。基座已经具备首个真实本地能力所需的可信发布、授权、沙箱、安装和更新闭环；后续优先进入 F1.3 论文版面/OCR 能力包，生产 Authenticode 与图形安装器作为发布运营工作流并行准备。
