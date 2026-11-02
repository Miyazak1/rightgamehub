# 墨鱼工坊桌面客户端开发预览

## Electron 共享界面预览

当前正式推进的方向是 Electron 外壳直接挂载 `packages/platform-client` 的 App 和 styles.css。默认只加载本地构建与明确标注的本地样本，不连接服务器；可显式接入本机隔离账号 API 或独立 HTTPS 测试 API，邮箱登录、GitHub 系统浏览器登录与会话恢复已接通。发布、下载导出与后台执行尚未接通。现有 Windows 执行内核保留，未在本阶段替换。

在仓库根目录运行 `start-mooyu-desktop-preview.bat`，或：

```powershell
node scripts/build-desktop-shell.mjs
node scripts/start-desktop-shell.mjs
```

构建后也可双击 `.runtime/desktop-shell/MooyuDesktopPreview.exe`。该小型原生文件仅负责启动 Electron，不绘制产品界面。开发预览使用本机既有且核对摘要的 `E:\CODE\Right\.runtime\electron-v44.4.5-win32-x64` 运行时；不自动下载运行时，不是可分发安装包。

本地构建、配置、缓存和诊断记录位于 `.runtime/desktop-shell/`。主界面使用固定 `mooyu-app://client` origin；游戏兼容样本由进程自建的随机端口 `127.0.0.1` 静态服务承载。离线预览仅允许这两个本地来源；联网测试只额外允许可信启动描述符对应的游戏 origin，不开放通用网络代理。

验证命令：

```powershell
node --test tests/platform/desktop-electron-policy.test.cjs tests/platform/desktop-window-state.test.cjs
node scripts/verify-desktop-shell.mjs
# 可选：额外导入已存在的真实 PDF；内容仅在本机读取
node scripts/verify-desktop-shell.mjs --paper 'E:\绝对路径\论文.pdf'
```

验收运行真实 Electron、共享 React 页面、PlayerCore、PDF.js 和 Tesseract，随后重启进程验证 localStorage/IndexedDB，并另测实际产品启动入口。报告与截图保存在独立 acceptance 目录；最近成功记录为 `.runtime/desktop-shell/verification-latest.json`。测试不代表完整账号、服务器业务、发行、更新或 OCR 准确率验收已完成。

具体结果及边界见[Electron 预览验收](../../docs/mooyu-desktop-electron-preview.zh-CN.md)。

标题栏与共享网页导航合为一行，保留 Windows 原生最小化、最大化和关闭按钮，背景随三种网页主题变化。左侧返回/前进跟随真实页面历史；“集成与 Agent”、刷新、全屏和退出收在桌面菜单中。支持 Alt+左右箭头、Ctrl+R、F11（Esc 退出全屏）和 Ctrl+Q。

标题中间保留至少 32 CSS px 的独立原生拖拽区。可用界面宽度不超过 1100px 时，发现、日志、学习、工具、游戏库收进桌面菜单，复用共享导航定义；不使用网页的底部移动导航。菜单支持键盘选择，并在高度不足时内部滚动。回归覆盖中英文、960–1320px 窗口和 100%/125%/150% 界面缩放；界面缩放模拟不等于不同 Windows DPI 的完整验收。

桌面页面和工具内部采用 8px 滚动区、6px 可见圆角滑块，透明轨道、不显示两端箭头，悬停及拖动时使用主题强调色。三种主题同步调整颜色，高对比模式增强可见性。保留原生滚轮、触控板、键盘和滑块拖动；不修改网页版样式或游戏 iframe 内部样式。

当前预览关闭窗口即退出，不在托盘或后台继续执行。窗口位置、尺寸和最大化状态写入本地 profile 下的 `window-state.json`，重新启动时恢复，并将失效的显示器位置调整回可见工作区。页面已有的 `beforeunload` 阻止退出时，保留继续编辑/退出选择；这不代表已实现全局未保存内容检测或自动保存。文档仍遵循各工具已有保存规则。

## Electron 本地账号验证

复用网页版 AccountPage、账号启动流程、现有 API 客户端及认证服务。桌面主进程持有访问/刷新令牌，复用现有 Windows CurrentUser DPAPI 凭据库，加密文件位于对应 profile 的 `account-vault/`，并绑定 API origin。preload 和 React 只取得会话状态与不可用于 HTTP 认证的会话标记，不向 DOM、localStorage 或 sessionStorage 写入真实令牌。设备标签为 Windows 桌面版；当前服务端 clientKind 枚举继续复用兼容的 `browser`，未改认证 API 或数据库。

双击仓库根目录的 `start-mooyu-desktop-account-test.bat`，或运行可操作的独立测试窗口：

```powershell
node scripts/build-desktop-shell.mjs
node scripts/start-desktop-account-test.mjs
```

测试脚本启动随机 `127.0.0.1` 端口的内存认证服务和独立 profile，进入原有登录页面。可输入 `desktop@example.test`，本地模拟邮箱验证码显示在启动终端中，不发送真实邮件。关闭窗口后该测试服务退出，内存账户失效；它不代表跨新建测试服务的会话恢复。自动验收在同一隔离服务存活期间执行完整 Electron 进程重启。

如已有本机测试 API，可运行 `node scripts/start-desktop-shell.mjs --account-api http://127.0.0.1:端口`，该参数保持只接受 loopback HTTP。远程隔离测试另用 `--test-account-api https://测试域名`，会先验证测试实例标识，并按精确 origin 派生独立 profile；不能同时使用两种参数。两者都拒绝路径、查询、凭据和账号 API 跳转，HTTPS 测试拒绝已知正式站点。默认入口仍不连接 API。联网业务页面复用同一测试 API，账号专用实例会明确提示业务未开放，不回退本地样本。上传头像、发布和后台执行尚未接入。详见 [测试地址与独立会话](../../docs/mooyu-desktop-auth-test-instance.zh-CN.md#桌面测试地址与独立会话)。

```powershell
node --test tests/platform/desktop-account-session.test.mjs tests/client/account-bootstrap.test.cjs
node scripts/verify-desktop-account.mjs
```

账号专项验收覆盖错误验证码、共享界面登录及设备列表、真实 DPAPI 密文、页面刷新、进程重启后过期访问令牌刷新、退出及再次启动仍未登录，以及桥接白名单和 renderer 隔离。报告与截图见 `.runtime/desktop-shell/account-verification-latest.json` 指向目录；专项验证码文件在结束时删除。服务层另测网络失败保留会话、离线退出、服务端撤销、并发退出胜出、服务器隔离、损坏凭据与跳转拒绝。

### GitHub 系统浏览器登录

沿用网页版 GitHub 按钮、等待授权与轮询页面，以及既有 `/v1/auth/github/web`、回调和 poll API。主进程通过 `shell.openExternal` 打开当前挑战的确切授权 URL，仅允许 GitHub 官方授权端点，或当前 loopback API 的模拟授权端点；拒绝任意 URL、其他挑战、过期链接和其他协议。state 与 PKCE 仍由现有认证服务处理，设计参考 [GitHub OAuth Web 流程](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#web-application-flow)。GitHub client secret 保留在 API 服务端，桌面不接收它。

主进程先保留轮询结果，等共享 `finishLogin` 接受不含令牌的会话标记后才写入 DPAPI 并发布登录状态。桌面点击“返回其他登录方式”、切换页面、重新发起登录或退出均使旧尝试失效；取消过程中已经返回的凭据会尽力撤销，迟到结果不能恢复桌面会话。仅关闭系统浏览器标签页不会通知桌面，可返回桌面取消或等待挑战过期。桌面本阶段不显示尚未接入的设备码备用入口，网页版设备码流程保持原状。

手动体验仍使用 `start-mooyu-desktop-account-test.bat`：在桌面点 GitHub，系统浏览器打开明确标注的本地模拟授权页，选择同意或取消，再回桌面查看结果。它不访问真实 GitHub，不需要真实账号、OAuth App 或密钥。自动验收页由脚本模拟授权选择，按钮禁用以防手动干扰；重复回调显示“已失效或已被使用”，并从地址栏清除回调参数。

```powershell
node --test tests/platform/desktop-github-session.test.mjs
node scripts/verify-desktop-github.mjs
```

8 项 GitHub Electron 专项检查验证真实系统浏览器访问本地模拟授权页、桌面取消后迟到回调、模拟授权拒绝、登录、DPAPI 及令牌隔离、完整进程重启恢复、退出和再次启动。服务层另有 8 项 GitHub 回归，含轮询及凭据写入过程中的取消、结果确认前取消、state 篡改/回放和打开浏览器失败。报告见 `.runtime/desktop-shell/github-verification-latest.json`。尚未用真实 GitHub OAuth App 或远程隔离服务器联调，不能将模拟验证视为真实 GitHub 授权已验收。

## 独立服务器账号联调

独立测试 API 的配置、启动前检查、GitHub 测试 App 配置、验证与停止步骤见 [桌面账号独立测试实例](../../docs/mooyu-desktop-auth-test-instance.zh-CN.md)。该方案复用现有账号 API，使用独立 PostgreSQL/Redis，并关闭业务后台任务。本轮仅在本机准备和验证，没有服务器部署；HTTPS 桌面接入已用本机证书验证，公网服务器与真实 GitHub 授权仍待下一阶段验证。正式桌面接入将复用现有服务器 OAuth App，无需把服务器 Client Secret 放入客户端。

## 本轮交付范围

本轮只交付 Electron 共享界面、账号会话与隔离测试入口。旧 D1/WinForms 诊断、论文审阅协议和对应夹具不在本次提交范围中；工作区中的旧实现保留，另行验证后再提交。当前 package 只提供 Electron 的 start/build，不提供旧诊断入口。研究、文章生成、发布、本地执行节点和发行更新仍按功能矩阵分别接入，不因登录接通而宣称完成。

## 干净目录回归

```powershell
node scripts/verify-desktop-clean.mjs
```

脚本从 HEAD 导出独立源码目录，仅叠加 scripts/desktop-auth-scope.json 中的候选文件，复用本机已安装的第三方依赖并将工作区依赖重新指向独立目录。先检查候选功能清单，再运行账号、HTTPS、网关与窗口回归并构建共享桌面界面；不带入未提交论文实现，不执行 Docker、真实授权、模型调用或部署。最新报告索引为 `.runtime/desktop-auth-clean/latest.json`。

本轮 P2 修复新增 Caddy 运行日志过滤与专用 Redis readiness；正式 Redis store 保持原状。相关回归共 70 项，隔离 Docker 的 15 项检查覆盖 Redis 停止/恢复/关闭、回调连接失败与响应头超时、日志脱敏和原始参数转发。公网证书签发、真实 GitHub App 与发行安装包仍未验收。

## 业务 API 接入（本地验证）

联网模式现已将已支持的业务请求交给同一账号服务器，不再回退到本地样本。发现、日志、课件、主页及游戏库的范围、安全边界和验收命令见 [业务 API 接入](../../docs/mooyu-desktop-business-api.zh-CN.md)。现有远程账号测试实例仍只提供账号接口，本轮没有部署业务服务器，也没有连接生产环境。

远程完整业务测试需要同时配置 `--test-account-api https://desktop-test.example.org --test-runtime-origin https://desktop-runtime-test.example.org`，只接受配对的 HTTPS 测试命名空间，不能混用 localhost 或正式运行域。服务端准备、独立数据库/Redis、Caddy 和回滚见[远程业务测试方案](../../docs/mooyu-desktop-business-remote.zh-CN.md)。
