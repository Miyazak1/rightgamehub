# 本机存档发布与线上更新（2026-10-07）

本次决策：当前服务器不扩容，生产环境只保留本机存档。云存档读写、账号云存档库、存档运营接口关闭；不清空已有云端数据，不移除本机缓存。多人游戏和其他平台服务维持现有配置。

## 行为边界

- API 的 CLOUD_SAVE_ENABLED 默认 false，生产 Compose 同样默认关闭。关闭时不实例化云存档仓库、服务或健康统计器；相关 HTTP 路径在认证、请求正文解析和数据库查询之前返回 503 CLOUD_SAVE_DISABLED，retryable:false。
- 游戏会话不会发放云存档权限；旧会话也不能解析云存档范围。公开 ZIP 仍不允许 cloudSave。
- 新的 localSave 发布能力单独启动宿主本机存档通道。已有批准 cloudSave 的发布版本，公开启动描述按本机能力返回；已有普通游戏能力不变。
- SDK 提供 client.localSave，并保留 client.cloudSave.local 兼容别名。本机读写、分块传输、导出、恢复和账号隔离不依赖云端游戏会话；不启动同步计时器。
- Web 使用原有 IndexedDB，VSIX/Harness 使用原有 SQLite；origin、账号、作品、渠道和槽的键不变。匿名和登录用户分别保存，登录后仍需主动导入匿名进度。
- 进入本机模式时不删除旧的已确认云版本、待同步内容、未确认请求或恢复副本。本机新写入不排入云队列，并标记 localOnly；此版本禁止把这样的记录自动切回云同步。已知被撤销授权的缓存继续拒绝读取，不借离线模式绕过。
- 账号页显示本机存档说明；云存档库、健康及审计入口隐藏，旧链接显示关闭说明且不请求云接口。本机管理保留导出、导入、恢复和副本管理，隐藏同步操作。
- 客户端发行：VSIX **0.3.29**，Harness **0.1.11**。已安装旧版需要更新并重新加载。ADR 默认构建 artifacts/adarkroom-local-save.zip；--cloud-test 仅生成内部云测试包，本次不自动发布新游戏。

本机存档不跨设备、浏览器配置或宿主共享。清除站点数据/客户端存档目录会丢失当地副本，应使用游戏顶部“存档管理”导出需要保留的进度。

## 更新线上

已知线上目录 /www/gamehub，Compose 位于 /www/gamehub/deploy，环境文件 .env.prod。执行：

~~~sh
cd /www/gamehub &&
git fetch origin codex/game-services-foundation &&
git merge --ff-only FETCH_HEAD &&
sh deploy/update-local-saves.sh
~~~

脚本只用于已有线上安装，步骤为：

1. 验证 Compose 配置和现有 PostgreSQL 可访问；持久写入 CLOUD_SAVE_ENABLED=false，不输出任何环境密钥。
2. 排除可选 Compose profiles，并停止存在的 save-storage-probe、save-maintenance；保留容器、表和数据卷。
3. 串行构建镜像，降低并行构建带来的资源峰值；不增加服务器规格或副本。
4. 把数据库备份到 /www/backup/gamehub/before-local-saves-<UTC时间>.dump，校验备份文件可解析后才执行迁移。失败的备份保留为 .partial，脚本退出。
5. 应用已有迁移并更新服务，等待健康检查；不执行 docker compose down 或删除数据卷。
6. 自动验证 /ready 中 saves.mode=local、cloudEnabled=false，并验证云存档库返回 CLOUD_SAVE_DISABLED。

这次本机隔离没有新增迁移。此前已知线上是 **46/46**，当前分支包含 **0047–0049** 的存档审计、容量、探针元数据迁移，因此更新后应为 **49/49**。它们保留存档正文，但 0048 会汇总已有正文大小，新增索引/DDL 也需要锁；备份和迁移失败时脚本停止，不宣称部署成功。关闭云功能后不启动存档探针和维护 profile。

可在服务器额外确认：

~~~sh
curl -fsS https://mooyu.fun/ready
~~~

预期包含 "saves":{"mode":"local","cloudEnabled":false} 及迁移 applied:49, expected:49。云存档库的 503 是有意的关闭响应，不代表平台 /ready 不健康。

旧静态页面或已打开的游戏需刷新；Cursor/VS Code 更新到 0.3.29 后重新加载，Harness 更新到 0.1.11 后重启。只更新服务器不会替换正在运行的已安装客户端。

## 验证

回归覆盖：登录/匿名用户第一次离线读取，超 32 KiB 的分块保存，SQLite 关闭并重开、导出与恢复、恢复副本、账号切换隔离、旧待同步/冲突内容保留、禁止重新上传本机模式内容、接口关闭早于认证及正文处理、旧游戏会话去掉云权限、ZIP 本机能力允许且云能力仍拒绝。

本次交付以仓库测试和构建结果为准；真实线上部署须以上述脚本实际输出为准，不能以代码已推送代替部署成功。

浏览器验收（2026-10-07）：真实 A Dark Room + IndexedDB，使用测试登录身份生火并保存；关闭重开后仍为“生火间”，导出并恢复成功且保留恢复前副本，页面统计的云接口调用始终为 0。测试不连接生产数据库。

最终检查：既有全套测试 383 项通过、8 项因外部集成环境跳过；新增部署失败中止测试 1 项通过（合计 384 项通过）。契约检查通过，Web/VSIX/Harness/ADR 构建通过。实际 Compose 展开确认默认没有两个 save-operations 服务，API 环境开关为 false；不存在的可选容器停止步骤返回成功。部署流程替身测试覆盖构建、备份生成、备份校验和迁移失败，均未继续启动新服务。
