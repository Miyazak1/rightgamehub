# Windows 客户端自动更新（本地实现）

本轮不提交、推送或部署，不生成或上传正式发布密钥。当前线上 `0.2.0-preview.3` 不含更新器，需要手动安装一次过渡版本，后续才有应用内更新能力。

## 用户流程

带有受信更新配置的安装版启动 15 秒后检查新版，并在发现新版时后台下载。菜单提供“检查更新”，下载时显示进度，可取消；就绪后提供“重启并更新”。普通退出不自动安装，安装必须经过主进程确认；正在运行游戏或课件时拒绝重启安装。页面取消退出会撤销本次安装意图。

安装沿用现有 NSIS 当前用户身份与安装位置。应用确认退出后才启动安装器，安装器以 `--updated` 启动新程序；正式入口只额外接受这个固定参数，仍拒绝任意配置、服务器和 profile 覆盖参数。
账号凭据、存档和设置保持在安装目录外，更新不会导入仓库开发 profile。

未配置受信更新源的开发预览或安装包不会发起更新请求，只显示未配置提示。此默认值用于避免未授权发布源被自动执行。

更新交接使用当前用户的原生助手：从 ASAR 校验并复制到安装目录外，等待旧进程结束，复核安装器后静默执行 NSIS，再核对安装后的主程序哈希并直接启动。它不依赖 Explorer 快捷方式重启，也不提升权限或访问账号与存档内容。

## 发布信任与更新协议

更新库固定为 `electron-updater 6.8.12`，配合现有 `electron-builder 26.18.1` 和 NSIS。使用自定义签名 Provider；本轮先做完整文件下载，关闭差分下载和退出时隐式安装。

官网下载清单 `/downloads/desktop/manifest.json` 仅作展示，不能授权自动安装。更新器只接受独立的签名清单：

```text
/downloads/desktop/updates/preview.json
/downloads/desktop/updates/stable.json
```

清单为 `{keyId,payload,signature}`，Ed25519 签名覆盖规范化 JSON 的全部 payload。payload 绑定产品、Windows x64、版本、频道、发布时间、到期时间、规范化安装包路径、大小、SHA-256 和 SHA-512。客户端内置公钥，服务器无法通过同一个下载源临时替换公钥。

生产更新源固定为 `https://mooyu.fun`；只有明确的本地隔离验收入口才允许 `http://127.0.0.1`。不接受用户名密码、查询参数、非固定路径、重定向、过大清单或跨产品/跨频道安装包。所有更新请求使用独立网络会话，不携带网站账号令牌或 Cookie。

文件在下载后、复用缓存后和安装前重新校验。签名中还绑定安装后的主程序 SHA-256。安装前还会重新获取签名清单，拒绝撤回、过期、变更或损坏的更新。不允许自动降级；修复已发布版本应提高版本号。签名清单当前有效期为 7 天，生产发布流程必须在到期前刷新签名；过期时停止更新，不影响已安装版本继续运行。

**发布清单的 Ed25519 签名不等于 Windows Authenticode 程序签名。** 本轮隔离安装器仍是未签名测试包，不宣称 Windows 已信任发布者，也不关闭系统防护。正式发布前需要配置和保管生产发布私钥，内置对应公钥，并单独确定 Windows 程序签名方案。HTTPS 证书不能替代这些签名。

## 构建和准备（无自动上传）

打包工具目录需要固定版本 `electron-builder 26.18.1`、`electron-updater 6.8.12` 与 ASAR 工具。公共信任配置只有以下字段，不放私钥：

```json
{
  "schemaVersion": 1,
  "channel": "preview",
  "feed": "https://mooyu.fun/downloads/desktop/updates/preview.json",
  "keys": [{"id": "公钥 SPKI SHA-256 的前 32 个十六进制字符", "publicKey": "Ed25519 SPKI PEM 公钥"}]
}
```

构建时显式传入 `--update-config <公共信任配置路径>`；未传入时不启用更新。
包内只保留公共信任配置，生产包拒绝本地测试更新源；已有全目录与 ASAR 审计继续执行。

```powershell
node scripts/package-desktop-windows.mjs --version 0.2.0-preview.4 --update-config <公共信任配置路径>
node scripts/prepare-desktop-updates.mjs --report <通过审计的打包报告> --private-key <Ed25519私钥路径> --output <独立分发目录>
```

准备工具先核对打包审计、大小和哈希，再复制不可覆盖的版本化安装包，最后原子切换签名 JSON。私钥必须在分发目录外；准备过程不上传文件。发布时先传安装包并核验，再切换签名清单。官网清单单独更新，不混用。

## 本地验证

```powershell
node --test tests/platform/desktop-updates.test.mjs
node scripts/verify-desktop-updates.mjs
node scripts/verify-desktop-clean.mjs
```

真实 Windows 验收会构建 `0.2.0-preview.4` 和 `.5`，使用独立的“墨鱼工坊安装验收” NSIS 身份、环回更新与账号服务器、临时测试签名密钥，以及隔离 profile。它拒绝覆盖已有验收安装和已有验收重启指针，不操作正式客户端。

流程覆盖首次安装、模拟账号登录、DPAPI 凭据、真实 IndexedDB 存档、签名更新下载、确认退出、NSIS 实际升级、自动重启与数据恢复，结束时卸载验收程序并保留隔离 profile 供检查。测试专用重启指针位于 `%APPDATA%/MooyuWorkshopUpdateAcceptance/restart.json`，完成后删除；不会读取正式账号目录。
报告与截图在 `.runtime/desktop-update-acceptance/check-*`。测试私钥、凭据、安装包和本机配置不纳入提交。

网络或验证失败不会启动安装器，继续保留当前程序。NSIS 执行过程中遇到断电、系统强制终止或磁盘故障，不能承诺自动恢复整个旧安装目录；官网旧安装包应继续保留，供人工恢复。撤回更新清单可以阻止尚未安装的更新，不能自动降级已安装的客户端。
