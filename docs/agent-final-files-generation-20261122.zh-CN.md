# 仅生成升级、回退与论文持久关闭文件

服务器已完成 STAGED_ONLY：7 镜像校验，现有容器未变，无重启、迁移或论文关闭。用户本次只授权生成文件。

## 本次入口

`generate-agent-cutover-files.mjs <已有stage目录> <新的私有record目录>`。依赖服务器 stage 目录中已复制的 Node 22，不安装系统组件，不覆盖已有运维工具或配置。

生成器核对 stage 回执、已有小文件校验及原调度镜像证明；仅读取容器元数据、原始有序 Compose 链、环境文件及只读数据库指纹。在新目录生成实际现场对应的 API/QQ/Web 覆盖、共享执行器定义、原镜像及兼容回退覆盖、生产论文持久关闭覆盖、冻结文件指纹和命令脚本。主机上的已有环境文件、Compose 文件和登录卷保持原状。备份脚本本轮也只生成，不创建双库备份。

读取 Docker 的边界另有命令白名单：inspect、image inspect、ps、Compose config 和带 default_transaction_read_only=on 的 psql SELECT。up/run/start/stop/restart/update、image load、迁移、备份等命令均在此入口拒绝。

## 保留审核与执行锁

生成时不会把 allExecutionServicesInventoried 或 adoptLegacyQQParticipants 自动改成 true。对应状态写入 execution-review.required.json；state.private.json 标 executionLocked=true，命令脚本为600权限，运维工具加载该记录时拒绝执行。该记录不能通过手改状态解锁；未来完成范围审核并获准执行后，使用常规 prepare 对最新现场重新生成独立可执行记录。

另一项目的论文 worker 单独生成 paper-outside-scope-*.draft.json 和所属 Compose 链的 review.private.json。覆盖文件保留原镜像，设置六论文开关 false、restart=no、paper-disabled profile 和立即退出入口，但不加入生产项目调用链，也不应用到任何容器。后续仍需明确该项目关闭范围及会重建它的实际启动入口。

生成前后比较全部既有容器的配置哈希、镜像、启动时间、运行状态和重启计数；同时核对保留的业务指纹。成功结果为 FILES_GENERATED_ONLY、executionLocked=true、containersUnchanged=true。此结果不表示已关闭论文或已具备上线窗口。

## 本地验证

使用目标 API 镜像的全新无网络、只读根文件系统测试容器，16项回归测试全部通过。覆盖原有升级/回退/备份门禁、登录与权限保留、开发替身证明拒绝、新增仅生成模式及只读 Docker 命令边界。初次测试的96MiB临时盘触发真实1GiB备份空间门禁；调整测试环境临时盘配额后全部通过，未修改生产空间门禁。另有本机归档集合及快照变化测试通过。

未在服务器执行本次生成命令；需等待用户返回真实结果。
