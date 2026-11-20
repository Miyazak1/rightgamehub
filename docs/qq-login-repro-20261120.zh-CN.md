# QQ 登录后退出：2026-11-20 本地真实账号复现

开发现场为 E 盘独立工作树 `qq-password-login`，基线提交 `8c0b50eb`。原 C 盘工作树与其中的未跟踪文件均保留。本轮不更新服务器，不连接线上数据库或登录卷，论文继续关闭。

用户使用独立测试 QQ 亲自扫码。本地测试只启动网关，不启动问答 worker、业务数据库或模型；没有发送问答测试消息。每次使用新目录或已停止测试实例的独立副本，线上历史、配置、预算和登录数据不参与测试。

## 必须保留的 Windows 成功基线

用户纠正后回查原会话及本地记录确认：最早的原生 Windows 本地组合确实已真实登录并完成问答，不能说成“此前本地从未真实登录”。成功组合为 Windows QQ `9.9.31-49738`、Node `22.23.2`、NapCat `4.18.42`。`qq-local/connection-check.json` 在 2026-11-19 北京时间 15:09:53 记录连接正常；`first-reply-verification.json` 在 15:45:27 再次记录连接正常、模型调用累计 6 次并有已送达消息。原会话还记录了连续对话、重启后记忆和消息去重验收。没有据此宣称 24 小时稳定性已经验收。

Windows 与 Linux 两套 `napcat.mjs` SHA256 相同，均为 `7967149b1c4f3d30e0506c842f84b7b925c2d361e3c9c75ebf0d4ff24dbdedaa`。Windows 直接加载其 QQ wrapper/DLL；Linux 改为另一版本 QQ `.so`、Linux 专用 `node_addon.node` 和自行组装的 Debian 网关。当前应优先核查这次平台和加载链路迁移差异。原 Windows 现场继续保持暂停，不恢复或修改。

## 已观察的结果

| 对照 | QQ / NapCat | Node | 结果 |
|---|---|---|---|
| A：固定线上同款网关镜像，全新测试数据 | 3.2.34-53644 / 4.18.42 | 22.23.2 | 北京时间 13:25:32 检测到已登录、Core 就绪；13:25:34 容器退出，退出码 1，未记录 OOM |
| B：仅替换 Node 可执行文件，复用停止状态的 A 数据副本 | 同 A，五个原生文件校验值不变 | 20.19.6 | 13:30:40 处于 initializing，13:30:43 容器退出，退出码 1，未记录 OOM；轮询未捕获 ready 瞬间 |
| C：无账号、无网络的基础图片路径 | A 中的 QQ 图像组件，libvips 8.13.3 | 22.23.2 | 合成 PNG 元数据读取 100 次、像素解码 100 次通过，进程正常退出 |
| D：仅替换 QQ 组件，全新测试数据 | 3.2.32-52194 / 4.18.42 | 22.23.2 | 13:39:58 处于 initializing，13:40:01 容器退出；仍为 SIGSEGV / SEGV_ACCERR，故障映射及文件偏移与 A 相同 |
| E：仅清空自定义 LD_PRELOAD，全新测试数据 | 同 A | 22.23.2 | 13:42:26 处于 initializing，13:42:29 退出，QQ 栈偏移与 A 一致；移除该设置不能解决问题 |
| F：仅停用 MoeHoo 可选包适配器，全新测试数据 | 同 A | 22.23.2 | 13:44:32 处于 initializing，13:44:37 退出；故障信号及 libvips 映射偏移仍与 A 相同，不能把该模块单独认定为根因 |

A 的信号为 `SIGSEGV / SEGV_ACCERR`，故障映射为 `libvips-cpp.so.42` 的 `---p` 页，文件偏移 `0xed9000`。与用户最近的线上故障报告吻合。A、B 的原生栈均包含 QQ 模块偏移 `0x6def064`、`0x6df234d` 及匿名地址；这两个 QQ 帧属于崩溃报告路径，不能直接据此确定实际出错组件。

固定网关镜像 ID：`sha256:9f4f4eb0d28abc6bdea6662477a44fb1ecfc202e0a83e414f90be96782b1fc24`。本机为 Docker Desktop Linux amd64、WSL2 内核、glibc 2.36；测试限制为 1 GiB、1 CPU、只读根目录、独立可写 `/data`、128 MiB `/tmp`、关闭 core dump。沿用最近线上记录中的 `NAPCAT_DISABLE_BYPASS=1`。为了避免崩溃后反复自动登录，测试容器设置 `restart=no`，与线上自动重启策略不同。

## 能确定与不能确定的事

现在已在本机 Docker 中的 Linux 真实登录路径复现，而此前 Linux 镜像验收只做到无登录启动。原生 Windows 本地成功与 Linux 迁移后失败必须区分，不能把二者统称为“本地”。问题在不运行网站、worker 或模型的 Linux 实例中仍发生，且使用全新账号资料即可发生；线上旧历史损坏和业务问答代码不是首要怀疑方向。单独换成 Node20、换 QQ 版本或移除库预加载均不能解决问题。

普通 PNG 解码可用，不等于所有图像路径均已排除。故障映射落在图像库不可访问页，也不等于图像库自身有缺陷。实际根因仍需组件版本对照或更完整调用证据。

核对过上游已知的空包段错误修复 [651c15a](https://github.com/NapNeko/NapCatQQ/commit/651c15aa6109f43d5fdb44194e3513c6576f58a0)：本镜像相关文件的 Git blob 为 `344b9c0a37ce28a0c29823d49d57aaacf625f5be`，与该修复文件一致，因此不能声称当前只是漏装了这一修复。没有修改任何原生机器码，也没有应用原工作树那个尚未验证的覆盖文件。

## 现场与工具

测试 A 证据：`E:\CodexData\build\Right\qq-login-repro\20261120052407-08a9c8`。

测试 B 证据：`E:\CodexData\build\Right\qq-login-repro\20261120052931-d9c5fc`。

测试 D 证据：`E:\CodexData\build\Right\qq-login-repro\20261120053913-f824ad`。旧 QQ 包来自上游说明列出的 Rodert/qq-versions 归档镜像，资产 SHA256 为 `d085dd89397225061eb9f194308f688129818ed445777e97a4a0a16e13d7b0e8`，下载后匹配。解包在 Windows bind 根目录应用权限/时间戳时出现元数据警告，所需运行文件和版本已单独核验。仅取运行组件构建测试镜像，不执行软件包安装脚本。旧 QQ 与新 QQ 的 libvips SHA256 相同，QQ wrapper SHA256 不同。

测试 E 证据：`E:\CodexData\build\Right\qq-login-repro\20261120054129-ef0e36`。

测试 F 证据：`E:\CodexData\build\Right\qq-login-repro\20261120054326-0af7e0`。停用方式仅为新测试容器增加独立空目录只读挂载，触发上游已有缺失模块降级路径；没有修改原生二进制或应用到服务器。该实验失败，不能发布为修复。

## 基于 Windows 成功基线调整后的下一组

已缓存的原作者完整 Linux 镜像为 `ghcr.io/napneko/nodenapcat@sha256:9f35df29e9f0a92f737143e123b9159b998c314a573139b5ac0e6bd4ab5af574`，原标签 `v4.18.41`。其中 Node 为 20.19.6、QQ 为 3.2.34-53644；加载器、QQ wrapper、libvips、两个原生适配器文件都与自组装镜像中的对应文件一致，主程序 `napcat.mjs` 不同，其 SHA256 为 `7c66d0239d7effe73ab6e4920eddef732a8066fb47cd19539541c72055c5f0aa`。外层 package.json 写的是 0.0.1，不能把它当作实际 NapCat 发布版本。

完整组件组合实例已经启动于本机 `http://127.0.0.1:64088`，证据目录为 `E:\CodexData\build\Right\qq-login-repro\20261120054950-2d4b5b`。仍为非 root、只读根目录、独立新数据和仅本机管理端口；显式覆盖 shell 入口为 `node /app/load.cjs`，不运行原镜像中修改主机/容器信息的入口脚本。当前仅验证等待二维码，真实扫码对照待用户完成，不能宣称稳定性通过。

脚本状态报告白名单及日志事件过滤测试 2 项通过；Python 只读环境报告白名单夹具通过。所有失败实例、原始测试登录资料及回退镜像均保留，没有自动清理。

独立测试登录资料保存在 `E:\CODE\Right\private-deployments\qq-login-repro` 对应子目录，属于私有资料，不提交、不清理。`session.json` 含本地管理凭据，不分享。报告只保留状态、组件 SHA256 与受限原生事件，不保存聊天内容、二维码或凭据。

`scripts/qq-login-lab.mjs` 提供仅监听 127.0.0.1 的二维码页面及状态观察。它只允许已知的本地测试镜像；复用测试数据时验证源容器已停止，并复制到新目录，源目录保持不变。

`deploy/qq/environment-report.py` 是尚未在线上执行的只读环境报告工具。它仅输出允许的版本、运行标志、资源限制与挂载目的地，不输出 Docker 环境变量全集、源路径、密钥或账号。当前没有服务器直接访问能力，线上实时环境仍未重新采集。
