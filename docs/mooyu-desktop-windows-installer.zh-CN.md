# Windows 本地安装预览

基线为提交 `0f20ae59d3054bccfbcd65576cd7429e843b8c3d`，仅叠加 `scripts/desktop-windows-package.json` 明确列出的安装适配。安装包复用共享界面和既有 API，不更新服务器、数据库或论文 worker。本轮生成的是本地验收用的 x64 NSIS 预览安装包，尚未签名、发布或接入自动更新。

## 安装与数据目录

按当前 Windows 用户安装，不请求管理员权限，不创建后台服务或开机启动项。安装结束不自动启动，不自动创建桌面快捷方式；开始菜单和“已安装的应用”保留标准入口。卸载只移除程序、快捷方式和应用注册，默认保留用户数据。

正式预览包固定使用 `https://mooyu.fun` 和既有 HTTPS 游戏运行域。默认启动不读取仓库中的 `launch.json`、环境测试凭据或任意外部配置，也不接受测试服务器和 profile 路径覆盖参数。`--version` 只返回安装版本，不连接网络。

会话、窗口状态、Chromium 数据和本地存档位于 `%APPDATA%\MooyuWorkshop\profiles\production-<服务来源摘要>\`。它不在安装目录内，也不含版本号；升级、更换程序目录、卸载后重装仍使用同一路径。DPAPI 继续绑定当前 Windows 用户与服务来源，不能跨 Windows 用户复制使用。已被服务器撤销或过期的会话仍遵循原认证规则；数据保留不等于绕过服务器认证。

旧开发预览在仓库 `.runtime` 中的 profile 保持原样，首次安装不会自动导入开发配置、测试账号或私人凭据。正式安装包第一次使用可能需要重新登录；这不会删除原开发预览中的账号或存档。不要把程序安装目录选为已有用户数据目录。

## 构建

在 Windows 仓库根目录使用固定版本工具链（工具只写入 `.runtime`）：

```powershell
npm install --prefix .runtime/windows-packaging-tools --ignore-scripts --no-audit --no-fund --save-exact electron-builder@26.18.1
node scripts/package-desktop-windows.mjs --version 0.2.0-preview.3
```

默认使用此前核验的 Electron 44.4.5 发布压缩包，同时固定压缩包及可执行文件的 SHA-256。其他构建机器可通过 `--electron <绝对目录或压缩包路径>` 指定同版本归档；目录内必须存在 `electron-v44.4.5-win32-x64.zip`，不能只提供一个散装可执行文件。通过 `--tools <绝对目录>` 指定固定版本打包工具。

构建先复制归档快照、验证摘要，再解压到全新目录；不复制旁边的本机日志、配置、凭据或未知文件，并去除开发 fallback loader。由受信任归档生成运行文件清单和摘要。NSIS 归档前及构建结束后检查整个负载：只允许清单中的运行文件、经过品牌编辑的应用可执行文件及 `resources/app.asar`；拒绝额外文件、目录、链接、缺失文件和运行库内容变化，同时保留 ASAR 内部审计。

源代码从固定提交全新导出，内部工作区依赖重定向到导出目录；未提交的旧 D1、论文实现、私人 profile 和凭据不会参与构建。入口与依赖合并后，应用 ASAR 只包含 `main.cjs`、sandbox preload、构建后的 web 资源和不含私人信息的版本元数据；源码映射、测试配置和凭据库不打包。

打包器以 `publish: never` 运行，没有更新源或发布目标。产物与 SHA-256 记录在 `.runtime/desktop-windows-package/latest.json`，该索引指向实际安装器，不把本机绝对路径写入安装包。Electron 资源编辑发生在产物副本，原开发运行时不修改。

Electron-builder 在独立 worker 中运行，其清理钩子不会进入父 CLI。父进程同时核对 worker 的退出状态和结果文件；构建或负载审计失败均返回非零，即使工具自身的清理钩子把 worker 的退出码改回 0。报告、worker 状态和日志保留在该次构建目录。

## 安装、升级、卸载回归

验收包使用不同的 appId、程序名和模拟账号，不能代替正式服务包分发。测试入口只接受回环 HTTP，测试凭据由本机内存认证服务临时生成；配置和验证码在包外，验证码在检查结束后删除。正式服务预览包不包含这个测试入口。

```powershell
node --test tests/platform/desktop-windows-package.test.mjs
node --test tests/platform/desktop-windows-guards.test.mjs
# 固定工具链的真实清理钩子：两次 CLI 失败都应返回 1，不生成安装器
node scripts/verify-desktop-windows-package-guards.mjs
node scripts/package-desktop-windows.mjs --acceptance true --version 0.2.0-preview.1
# 保存该次 report.json 的绝对路径作为下面的 previous
node scripts/package-desktop-windows.mjs --acceptance true --version 0.2.0-preview.3
# current 是第二次生成的 report.json
node scripts/verify-desktop-windows-install.mjs --previous <previous-report.json> --current <current-report.json>
```

回归实际执行 NSIS 安装器和卸载器，测试目录包含中文与空格。检查首次启动、Windows DPAPI 模拟会话、真实 `gamehub.saves.v1` IndexedDB 存档、重启恢复、覆盖升级、过期访问令牌刷新、卸载后用户目录逐字节保留，以及重装后恢复同一账号和进度。检查当前用户注册项版本与路径；拒绝覆盖已有的验收安装。`--hold true` 会在重装后保留一个可见验收窗口，供窗口检查，关闭后继续完成最终卸载。

安装验证结果在 `.runtime/desktop-windows-install/latest.json`；保留其指向的测试 profile 供复核。全套既有桌面回归仍通过 `node scripts/verify-desktop-clean.mjs` 在干净目录运行。正式账号的重新登录、跨 Windows 账号/DPI、签名和发布后的更新分发另行验收，不用本机模拟结果代替。

`node scripts/verify-desktop-windows-preview.mjs` 另验收最终正式服务预览包：仅在没有已有产品安装及 `%APPDATA%\MooyuWorkshop` 数据时运行，将程序安装到工作区独立目录，验证版本及二进制一致性，打开匿名正式目录，由窗口检查确认后用 Ctrl+Q 退出，再卸载并保留新 profile。它会匿名连接正式 API，但不读取开发会话、不操作登录、不调用模型或发布；存在已有数据时停止。结果在 `.runtime/desktop-windows-preview/latest.json`。

## 本次验证结果（2026-11-02）

- 干净目录 143 项回归、共享界面构建及安装包文件审计通过。
- 验收安装从 `0.2.0-preview.1` 覆盖升级到 `0.2.0-preview.2`，并完成重启、过期访问令牌刷新、卸载和重装；模拟账号、真实 IndexedDB 存档和偏好设置均恢复，卸载前后 profile 文件逐字节一致。真实安装窗口显示相同的隔离测试用户，Ctrl+Q 正常退出，最终验收安装已卸载。
- 最终 `0.2.0-preview.2` 包完成独立安装、`--version`、匿名正式发现页启动、单实例唤回和卸载，目录显示 20 个线上作品及登录入口。未用真实账号登录，旧开发客户端与其 profile 保持原样。
- 安装包未签名，尚未发布、上传、接入自动更新或部署服务器。会话保留验证使用模拟账号；正式安装首次登录仍由用户完成，未自动迁移开发凭据。

## P2 修复后复核：preview.3

固定发布归档摘要生成运行清单，整个负载在 NSIS 归档前、构建后均通过审计；不携带宿主运行时目录中的日志、配置或开发 loader。许可证仅按固定规则改名为 `LICENSE.electron.txt`，内容摘要继续核对。

新增 7 项门禁回归后，干净目录共 150 项测试及共享界面构建通过。真实打包 CLI 使用同工具链的清理钩子验证构建失败和审计失败：worker 即使返回 0，父 CLI 仍返回 1；两个失败用例均没有生成安装器。

`preview.3` 的正式服务预览包和隔离验收包重建通过；隔离安装从 `preview.2` 升级到 `preview.3`，重启、会话刷新、卸载和重装继续保留同一模拟账号、IndexedDB 存档及偏好，卸载前后 profile 逐字节一致。验收安装已卸载，数据保留供复核。

正式服务预览包完成不联网、不读取 profile 的 `--version` 启动冒烟。本轮未重做正式账号或生产目录验收，未触碰现有正式会话。默认产品数据目录、appId 和业务代码均保持原方案；本轮没有提交、推送、发布或部署。
