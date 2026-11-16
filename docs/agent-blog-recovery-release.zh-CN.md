# GitHub 自动调研恢复发布

此修复承接 `cae18091` 的无论文统一发布版本，包含当前工作流版本预检和 GitHub 秒精度 UTC 日期归档适配。桌面端及插件资源未变，沿用已发布的 `mooyu-unified-20261116-desktop-parity.tar.gz`，不需要重新安装客户端。

网页回归保留原有断言和超时限制，压缩测试构建中的语法及空白，减少完整 App 的加载开销；保留开发模式和 StrictMode 检查。发现页和平台 Agent 按 DOM 与实际组件就绪条件等待，并在异常时也释放浏览器上下文和服务器。Windows 测试关闭 Chromium 原生日志，减少子进程继承日志管道对退出的干扰；页面 JavaScript 错误仍单独收集。创作助手重试前等待会话初始化读取完成，避免夹具提前变为成功、移除正在点击的重试按钮。

整轮中发现的下载续传和授权重启用例，分别改为等待真实部分文件落盘、等待旧工作进程确实进入暂停点，替代固定 75ms/25ms 的竞态假设；未放宽超时、签名、续传或授权断言。最终整轮串行执行，避免在本机多个测试进程间争用资源。

## 宝塔执行方式

上传包路径（已经存在且校验正确可直接复用）：

`/www/backup/gamehub/incoming/mooyu-unified-20261116-desktop-parity.tar.gz`

SHA-256：`8151813fc67dc529fd5858198c1655a3407eb524a7e70df4b6bc71ae31e98fdf`

先 fetch 发布分支，设置交付的完整提交号 `MOOYU_RELEASE_SHA`，再按已有统一更新程序运行：

```bash
git show "$MOOYU_RELEASE_SHA":deploy/prepare-unified-release.sh > /tmp/mooyu-prepare-unified-release.sh
bash /tmp/mooyu-prepare-unified-release.sh "$MOOYU_RELEASE_SHA" /www/backup/gamehub/incoming/mooyu-unified-20261116-desktop-parity.tar.gz
bash /www/gamehub/deploy/resume-blog-public.sh
```

更新程序在仓库有本地修改、非快进更新、包校验失败时停止；保留现有环境文件和运行中的 Compose 配置，备份数据库及回滚镜像，不删除数据库卷。论文四项开关由生产 Compose 固定为 false。

恢复命令仅在当前运行的生产公开调度容器中执行新版 CLI，不重新创建容器、不改写配置文件。它检查配置开关、Foundation 发布归属、工作流版本、模型/凭据登记、预算、未完成执行和近期调度心跳；不放宽原有预检阻断。只有检查通过才清除该公开计划的暂停标记、重置计划连续失败计数，恢复下一次北京时间 10:00。已启用时保留原下次执行时间；不创建 Run、不立即调用模型、不补发历史任务，不清除失败执行、文章、归属或其他计划的数据。

成功输出应为 `event=explicit-resume`、`enabled=true`、`blocked=false`，并带有 `schedule.nextFireAt`。如输出阻断或心跳过期，命令非零退出；应核查提示，不应直接 UPDATE 数据库强行跳过检查。调度重启本身仍保留暂停状态。

```bash
docker logs --since 15m --tail 60 gamehub-production-agent-blog-public-scheduler-1 2>&1
```

调度过程会输出 `fire-finished`。公开执行后仍以实际文章发布结果判断成功；连续失败会按既有阈值再次暂停。

## 验证记录

相关单元回归 11 项通过；独立 PostgreSQL 中的版本共存、当前版本退役阻断、合法归属审计、暂停恢复、幂等重复执行、保留历史时间/自定义配置、过期心跳阻断及零 Run/Provider/文章副作用验证，共 7 项通过。数据库使用任务专属容器及空库，不连接生产或其他开发库。四个完整 App 网页用例（创作助手、发现页、平台 Agent、上传状态）在保留开发检查后全部通过，日志为 `.runtime/blog-release-browser/development-checks.tap`。

2026-11-16 最终串行全量回归：362 个文件、1678 项测试，1598 通过、0 失败、0 超时取消、80 项因依赖条件跳过，耗时约 12 分 16 秒。另行实跑的相关 PostgreSQL 7 项全部通过。结果为 `.runtime/blog-release-browser/full-serial/result.json` 和 `results.tap`。早期失败日志保留在同目录的其他报告文件夹，不覆盖为成功结果。恢复脚本通过 Bash 语法检查，沿用统一包的 SHA-256 也已重新核对。
