# QQ 网关运行模式修复交付

目标是修复已确认的会话失效后“登录服务重启失败：重启功能未初始化”问题，不承诺QQ服务端永不使会话失效。用户于2026-11-24要求修复，交付为宝塔手动执行命令，本地未操作线上。

仅将原napcat服务的NAPCAT_DISABLE_MULTI_PROCESS从字符串1改为0，使用该固定网关版本已有的父子进程恢复机制。原镜像以不可变digest固定，显式固定当前有效主机名，保留原/data命名卷及全部既有端口、网络、运行用户、安全和资源设置。不重建QQ worker、API、交互执行器、数据库、日调度或桌面服务，两套论文保持关闭。不删除登录文件、不修改白名单/权限/预算/定时计划、不自动重试旧任务。

执行前检查完整Compose链、模型与容器环境/挂载/网络/命令一致，检查声明的本地管理端口、ulimits及其余运行配置；拒绝隐藏.env中的进程开关覆盖，拒绝有效主机名与Docker配置不一致的现场。对其他所有容器、原锁定记录和API/QQ业务及历史快照建立门禁，要求实际工作与QQ投递空闲。仅在新私有目录写工具及维护记录，旧包/旧锁不改动。

先备份并完整读取校验登录目录，再正常停止网关（不主动强杀），停下后创建并完整校验第二份登录备份。随后通过原Compose链末尾追加的仅网关覆盖重建napcat，使用no-deps/no-build/pull-never。核对镜像、原主机名、端口、数据卷、权限、其他容器及数据库业务快照，检查原生父子进程、登录状态及二维码可用性。内置原生父进程的恢复机制包括退出超时处理和崩溃次数限制；不是给Docker或系统增加循环重启脚本。

每次维护记录中生成rollback.sh；回退也先做新备份，只恢复单进程开关，不恢复数据库或旧登录文件。任何失败停止，无自动重试或回退。不要反复执行失败命令，尤其在已经正常停止网关后的失败现场。

本地验证：固定原网关镜像在无网络、无用户登录数据的隔离环境中以非root用户启动，通过两Node进程和原生扩展预加载检查；该结论仅PASSED_BOOTSTRAP_ONLY。专用合成Compose项目的模式切换和回退通过，原镜像、固定主机名、历史卷及无关容器均保留。6项顺序/失败停止/配置与端口门禁测试通过。真实QQ登录及会话失效后的自动恢复仍需现场验收。

首次r2入口因旧stage/node不可执行而在nice启动处失败，未进入修复脚本。不能仅凭Permission denied区分文件执行位、ACL或挂载限制。没有修改旧Node权限。

修正版r4先检查/root可用空间，在新私有/root/mooyu-qq-gateway-runtime-20261124-*目录从当前API复制Node，比较来源SHA256、设置新文件700并验证Node22。只读访问API，不重启API；回退入口使用process.execPath指向同一新运行时。该私有运行时需要保留。旧文件和原有目录权限不改变。

断网隔离环境中已复现旧Node文件600不可执行，并通过新运行时复制/校验/版本检查，确认旧文件模式仍为600；证明位于E:\CodexData\build\Right\agent-server-preflight\20261124\napcat-runtime-bootstrap-proof-r2\result.json。模拟使用测试专属可执行tmpfs，不能据此断言服务器/root不存在额外执行策略；若新运行时仍不可执行，应停止检查现场，不修改挂载选项。

当前交付命令：E:\CodexData\build\Right\agent-server-preflight\20261124\napcat-mode-repair-command-r4\server-repair-only-qq-gateway.txt。

## r5：修正Compose零值序列化的误拦

用户现场确认声明JSON为core:{}，Docker配置Soft/Hard均为0，原生node进程Max core file size亦为0/0。此处无实际限值漂移，旧比较代码未识别Compose JSON省略零字段，导致停止前误报DECLARED_ULIMIT_MISMATCH。r5将canonical空对象等价解释为0/0，仍要求Docker存在该限制且Soft/Hard准确相等；未知结构、缺失运行限制或实际限值不同仍拒绝。

本地真实Compose同样输出serializedCore:{}，在变更/回退前后运行新检查通过，镜像、主机名、历史卷及无关容器保持不变。7项单元/门禁回归通过。运行时入口也实测首次复制校验和第二次复用通过，只复用SHA与当前API来源一致、可执行且版本为22的私有Node，不修改旧文件权限。证据目录napcat-mode-compose-r4和napcat-runtime-bootstrap-proof-r3保留。

当前替代交付命令：E:\CodexData\build\Right\agent-server-preflight\20261124\napcat-mode-repair-command-r5\server-repair-only-qq-gateway.txt。r4已在预检退出，stopIssued/recreateIssued均为false，没有停止或重建网关；不把该预检失败称为线上修复已执行。

结果GATEWAY_MULTIPROCESS_LOGIN_READY表示已检测到预期账号、原生核心均在线；GATEWAY_MULTIPROCESS_SCAN_REQUIRED表示有符合客户端约束的二维码，需用户确认登录；LOGIN_PENDING表示登录仍待核对，不能称业务恢复。无论哪种结果，都不能仅凭本次启动证明未来自动恢复已经通过真实掉线回归。
