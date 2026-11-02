# Windows 客户端下载与分发

本轮只完成本地准备与验证。安装包未上传，线上网页、网关和服务未更新。

## 页面与独立清单

- 官网 `/download` 复用共享客户端界面、主题和中英文切换，导航栏、页脚和 Agent 安装页均有入口。
- `/downloads/desktop/manifest.json` 是桌面预览版清单，与 Agent 的 `/downloads/manifest.json` 独立。
- 页面仅允许清单中同源、规范的版本化 Windows x64 下载地址；清单不可用、异常或超时会显示重试，不保留旧下载按钮。
- 页面说明当前未签名、手动升级、设备会话和本地存档范围，不把预览版描述成已签名正式版。

## 本地准备

在仓库根目录运行：

```powershell
node scripts/prepare-desktop-downloads.mjs
```

默认输入 `.runtime/desktop-windows-release/report.json` 和 `config/desktop-download-release.json`。
必须先有已通过安装包审计的报告及其对应安装包。工具复核文件名、大小、SHA-256 和 PE 文件标记；不会打包、上传或连接服务器。
输出为 `.runtime/desktop-downloads/data`：

```text
manifest.json
0.2.0-preview.3/
  MooyuWorkshop-0.2.0-preview.3-x64-Setup.exe
  SHA256SUMS.txt
  release.json
```

先写入并验证版本目录，最后原子替换 `manifest.json`。相同版本不得换文件或改说明；内容变更必须新版本。单写入锁避免并发切换，失败不更新当前清单。异常终止留下 `.prepare.lock` 时，先确认无准备进程，再人工处理锁。
公开清单只包含版本、发布日期、说明、文件名、相对下载路径、大小、哈希和签名状态；不复制审计报告、本机路径、账号或凭据。

## 本地回归与真实下载验证

```powershell
node --test tests/platform/desktop-downloads.test.mjs
node scripts/verify-desktop-clean.mjs
```

第二条命令使用 HEAD 的干净导出，仅覆盖 `scripts/desktop-auth-scope.json` 列出的文件，排除旧 D1 与论文未提交改动。报告位于 `.runtime/desktop-auth-clean/latest.json`。
在报告对应的 `source/apps/web` 目录，用现有 Vite 依赖构建官网。随后在仓库根目录执行：

```powershell
node scripts/verify-desktop-downloads.mjs --web <干净构建的apps/web/dist绝对路径> --playwright <Playwright模块绝对路径> --chromium <本机chrome.exe绝对路径>
```

Playwright 和 Chromium 参数可省略，只运行 Caddy/HTTP 验证。所用 Docker context 必须是本机 `desktop-linux` 命名管道，已有 `gamehub-production-web:latest` 镜像（包含 alidns）。脚本只启动自己带有唯一标签的临时 Caddy 容器和网络，绑定环回地址，读取本地文件并在结束时清理。不会操作现有容器或上传文件。

验证从生产 Caddyfile 提取同一下载配置，检查完整包 SHA-256、两段 Range 合并后的 SHA-256、HEAD、206、416、附件头、版本缓存、清单不缓存、独立 Agent 路径，以及缺失安装包/清单/目录的真实 404。可选浏览器检查下载地址、加载失败/重试、异常清单拒绝、窄屏、中英文和主题，网络请求限制在本地测试源。
报告和截图位于 `.runtime/desktop-downloads/verification-*`，这些内容和安装包均不纳入 Git。

## 分发配置与后续上线顺序（本轮不执行）

`deploy/Caddyfile` 的桌面命名空间先于 SPA fallback，只有 GET/HEAD，未知文件返回 404。清单 `no-store`；版本文件成功响应才标记一年 immutable，错误响应不永久缓存；exe 以附件下载。支持文件服务原生 Range/HEAD。未挂载分发目录时也不会把缺失包返回成网页 HTML。

`deploy/compose.desktop-downloads.yml` 只给 `web` 增加只读 bind mount：

```text
DESKTOP_DOWNLOADS_DIR=<服务器上已准备好的独立分发目录>
                   → /srv/desktop-downloads (read-only)
```

未来获准上线时，按以下顺序单独安排：

1. 备份正在运行的网关镜像、实际 Caddyfile、完整 Compose 文件列表和清单。已有测试域名覆盖文件必须保留，不可仅用基础 Compose 重建。
2. 以新版本目录上传安装包、校验文件与 `release.json`，服务器端重新核对完整文件大小与 SHA-256。安装包不放进网页 Docker 镜像或 Git。
3. 构建含 `/download` 的网页镜像，合并当前实际网关配置并校验。确认新增桌面分发命名空间未破坏既有业务/测试域名，再追加只读挂载覆盖文件，只更新 `web`。
4. 版本文件就绪后，最后原子切换服务器 `manifest.json`。通过 HTTPS 重跑完整下载、续传和 404，再开放下载入口。无需修改 API、worker、数据库或 OAuth。
5. 回滚时将最新清单恢复为备份的旧版本；如果回滚网页/网关，恢复原镜像及完整配置组合。保留所有已发布版本目录，不覆盖旧文件；immutable 文件不能靠同名替换修复。

桌面安装包目前是未签名预览包，不能宣传为 Windows 已信任发布者。用户应保留系统防护，通过官网与 SHA-256 核对来源。以后签名或自动更新需另行设计与验证，本轮没有启用自动更新。
