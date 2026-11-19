# 小墨鱼 QQ：独立服务器部署

本部署承载当前已验收的单群、白名单用户 @文字问答：人格、同用户最近三轮成功回答上下文、持久化历史、预算、消息去重、有限重试、重启恢复、权限拒绝及不确定发送人工核对。不是网站后台操作代理，不支持图片/语音问答。保持四项论文开关为 false。

## 部署边界

- 独立目录 `/www/mooyu-qq`，Compose 项目 `mooyu-qq`，独立 PostgreSQL 17 和数据卷。不会运行网站的 Compose、迁移或发布脚本。
- 三个容器分别使用普通项目网络，数据库不会作为其他容器的网络命名空间。数据库重启后其他服务仍可通过 Docker DNS 重连。
- `deployment:server` 仅允许专用主机名 `qq-postgres` 和 `mooyu_qq_local_*` 数据库。默认本机模式继续只允许回环数据库，不改变其策略哈希。服务器模式需在停止 worker 时显式 `--init` 确认策略；它保留历史和预算。
- 问答服务在容器内部监听 6700，不发布主机端口。数据库不发布端口。只有 NapCat 管理端口映射至主机 `127.0.0.1:16099`，通过 SSH 隧道访问。
- Linux/amd64，Docker Compose 需支持 `env_file.format:raw`，Docker 随系统启动。三个服务均 `restart:unless-stopped`，worker/NapCat 非 root、只读根文件系统、无新增权限；QQ 原生组件禁用 core dump。设置内存/CPU 上限和 Docker 日志轮转。
- 健康检查区分数据库/应用失败与 QQ 暂时离线；后者不会触发无限重启。QQ 登录态失效时仍可能需要运营者手机重新扫码。

## 网关来源

- NapCat 从原作者 `NapNeko/NapCatQQ` 提交 `9335843246e3b7a17944861f3ac8731a259732c2` 构建（v4.18.42），与本机已验收源码一致。
- Linux QQ 使用原作者下游构建流程指定的腾讯官方地址：`https://qqdl.gtimg.cn/qqfile/QQNT/9.9.36/beta/9ee04bef/linuxqq_3.2.34-53644_x86_64.AppImage`。文件大小 271368614 字节，SHA-256 `a33675d355e8b559453c40b9c59823393c6e585c97a3ae9f5c151203afa125a4`。仅提取原生运行组件。
- Linux 专用加载器取自原作者包 `ghcr.io/napneko/nodenapcat:v4.18.41@sha256:9f35df29e9f0a92f737143e123b9159b998c314a573139b5ac0e6bd4ab5af574`；镜像元数据指向原作者加载器提交 `51e878e018e9ec8ce838d7ae0d1f0c98b04d3d4d`。`node_addon.node` SHA-256 `8b9641da132519a2a1d072f1495f5e7f8c3732b73201a7b145d581973f8aa508`。
- 不执行原镜像入口脚本，不采用其中修改容器标识/主机信息的操作。自行编写最小启动器，仅创建 QQ 数据目录、管理配置并加载原生模块与自建 NapCat。
- 验证过的 Node 22.23.2/Debian 运行库需要显式加载 GnuTLS/OpenSSL，QQ addon 以全局符号方式加载。相关配置见 `deploy/qq`，不能只把 Windows 可执行文件拷到 Linux。
- 镜像不含账号会话、对话历史或模型密钥。源项目许可及原始来源记录随私有部署包保留；不因此授予额外再分发权利。

## 初次部署与切换

1. 在本地完成 Linux 镜像和隔离 Compose 验收。
2. 暂停本机问答 worker 和 NapCat，只停止已核对身份的本专用进程。以一致性 PostgreSQL 导出保存该通道的设置、历史、任务、尝试及审计。不要同时在两台机器运行同一 QQ 账号。
3. 私有部署包包含模型密钥和 QQ 历史。仅上传自己服务器的指定目录，不上传公开仓库、不分享包或配置内容。
4. 确认包校验和，解压为 `/www/mooyu-qq/`。在管理员宝塔终端执行 `bash /www/mooyu-qq/install.sh`。首次安装脚本校验文件、架构、磁盘、Docker、自启动及部署锁；发现现有 QQ 容器、数据卷或安装标记会停止，绝不覆盖。
5. 脚本导入固定镜像，恢复到全新独立数据库，显式确认服务器策略，启动服务、做一次 QQ 数据库备份并启用每日备份 timer；完整安装日志在 `/www/backup/gamehub/qq-server-install-*/run.log`，不包含密钥或对话正文。
6. SSH 转发本机端口，例如 `ssh -N -L 16099:127.0.0.1:16099 root@服务器地址`，浏览器打开 `http://127.0.0.1:16099/webui/`。管理口令在服务器私有 `.env` 的 `QQ_WEBUI_TOKEN`；仅在本机查看，不发到聊天。由运营者手机扫码登录同一专用 QQ 号。
7. 登录后在目录内执行 `docker compose exec -T napcat node /opt/manage.mjs connect`，脚本核对账号和唯一群后设置反向 WebSocket，不发送测试消息。另有启用的未知连接时会拒绝覆盖。
8. 执行 `docker compose exec -T napcat node /opt/manage.mjs status` 核对连接。白名单用户在唯一群真实 @，核对服务端任务和 QQ 成功回执，再进行一次 worker 重启后的实际问答。

服务器实际登录、真实 QQ 收发及重启后收发须单独完成；本地容器的二维码生成及模拟故障不能替代此验收。执行手动 Compose 命令应先 `cd /www/mooyu-qq`；此目录 `.env` 仅属于 QQ 项目。

## 状态、日志与备份

```bash
cd /www/mooyu-qq
docker compose ps
docker compose exec -T worker node apps/qq-channel/src/cli.mjs /config/config.json --status
docker compose exec -T napcat node /opt/manage.mjs status
bash /www/mooyu-qq/backup.sh
systemctl status mooyu-qq-backup.timer --no-pager
```

Docker 日志最多每服务 5 个 10 MB 文件；NapCat 自身文件日志另有上游单文件轮转规则。网关原始日志可能包含本地管理 Token、二维码及聊天内容，不能直接贴到公共渠道。支持排障时先提供状态及经脱敏的错误码。

每天服务器本地时间 04:20 左右备份 QQ 数据库（含最多五分钟随机延迟）；备份只在本机，不替代异机备份。备份目录 `/www/backup/gamehub/qq-database`，生成压缩校验和；不自动删除备份。QQ 登录会话和 NapCat 配置持久保存在本项目 `napcat` 卷，重新扫码可以重建登录态。

停止 QQ 可用 `docker compose stop worker napcat`，数据保留。不要执行 `down -v`、volume prune、system prune 或删除数据库卷。旧电脑上的数据库快照是迁移起点；服务器产生新消息后，不能直接恢复旧快照当作最新数据。

不确定发送仍需先停止 worker，核对群里实际是否收到，再用现有 `--resolve` 命令留审计处理；绝不盲目重发。恢复承诺从消息成功入库开始，入库前的断线消息无法保证由 QQ 重放。
