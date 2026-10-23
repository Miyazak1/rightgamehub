# 墨鱼变更雷达：本地 Researcher 节点

## 目标与边界

本地节点把最重、最敏感的模型分析从墨鱼服务器迁移到用户自己的电脑。用户的 DeepSeek API Key 只存在本机；平台只分发已经冻结的问题、方法和最小证据包，并接收通过校验的结构化结果。

当前是第一阶段：**深度模型分析在本地运行**。新闻搜索、网页抓取、正文提取、证据归档和定时调度仍由平台执行，因此它已经降低模型算力、调用费用和密钥托管压力，但还不是“全部计算都在本地”。第二阶段再把搜索与抓取迁移为本地观察节点。

本仓库现在同时提供命令行节点和 Windows 原生节点。Windows 版是单文件 `windows_standalone_exe`：内含固定版本的 Node 运行时与 Researcher Worker，用户不需要下载仓库、安装 Node 或打开 PowerShell。程序不申请管理员权限、不开放入站端口；节点密钥和 DeepSeek API Key 使用 Windows DPAPI 按当前用户加密保存在本机。

## 使用方式

### Windows 原生包（推荐）

1. 登录墨鱼，打开独立的“墨鱼变更雷达控制台”（`/apps/change-radar`）和一个研究专题。雷达不再出现在“工具”目录。
2. 在“本地 Researcher 节点”中填写电脑名称并创建节点。
3. 立即保存控制台只展示一次的节点密钥。
4. 下载并打开 `MOOYU-Change-Radar.exe`，填写平台地址、节点密钥、自己的 DeepSeek API Key 和模型名称。
5. 先点击“测试连接”，成功后点击“启动本地节点”。关闭窗口会停止节点。

原生包不会把密钥放入命令行参数、日志或平台请求。配置文件位于当前用户的 `%LOCALAPPDATA%\MOOYU\ChangeRadar`，离开该 Windows 用户后不能解密。撤销平台节点后，即使本机仍有旧配置也不能再领取任务。

原生应用中的“打开雷达控制台”只会调用系统默认浏览器访问平台控制台；它不会把本机的 DeepSeek API Key 或节点密钥附加到 URL。旧地址 `/tools/change-radar` 仅作历史链接兼容，平台入口、Agent 插件和文档均使用 `/apps/change-radar`。

开发者可在仓库根目录构建：

```powershell
npm run build:change-radar-native
```

输出位于 `artifacts/change-radar-native/MOOYU-Change-Radar.exe`，并附带记录 SHA-256、包类型、架构和权限声明的 `build-report.json`。公开分发前仍需完成代码签名、恶意软件扫描和真实 Windows 安装/卸载体验验收；开发构建成功不等于平台批准发布。

### 命令行方式

在包含本项目代码与依赖的本机 PowerShell 中设置变量并启动：

```powershell
$env:RESEARCHER_PLATFORM_URL='https://mooyu.fun'
$env:RESEARCHER_NODE_TOKEN='页面生成的一次性节点密钥'
$env:RESEARCHER_DEEPSEEK_API_KEY='你自己的 DeepSeek API Key'
npm run research:local-node
```

也可以复制 `apps/api/.env.researcher-node.example` 到仓库外部的私有配置文件，再使用 Node 的 `--env-file` 启动：

```powershell
node --env-file='D:\private\radar-node.env' apps/api/src/researcher-worker-cli.mjs
```

两种方式使用同一个受限节点协议。节点启动后会先向平台报告心跳，再轮询本账号的任务。没有任务时只做轻量轮询；领取任务后才调用用户自己的 DeepSeek 账号。

## 安全模型

- 平台只保存节点密钥的 SHA-256 摘要，明文只在创建时返回一次。
- 每个节点只能领取创建它的账号所属任务，不能看到其他账号的证据包。
- 每次完成、失败、续租和登记模型调用前，平台都会校验节点、任务和执行租约是否匹配。
- 撤销节点后密钥立即失效；已经领取的任务保留到租约过期并进入不确定状态，避免在模型可能已经产生费用时自动重复执行。
- DeepSeek API Key 不进入页面、平台 API、数据库或服务器日志。

## 运维建议

- 把本地节点作为开机自启的普通用户进程运行，不要使用管理员权限。
- 一台电脑创建一个节点；电脑遗失或密钥泄露时立即在页面撤销节点并创建新节点。
- 首次运行先执行“测试连接”，并保持窗口可见以观察运行记录。
- 本地节点离线不会丢任务；任务会在平台排队，节点恢复后继续领取。

## 后续阶段

第二阶段将为本地节点增加搜索、RSS 拉取、网页抓取和正文提取能力；平台届时只保存来源元数据、内容指纹、最小证据和结构化结论。为了避免用户电脑直接暴露为公网服务，本地节点继续采用主动拉取任务的方式，不要求端口映射。
