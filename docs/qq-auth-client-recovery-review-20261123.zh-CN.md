# QQ管理鉴权恢复：待批准的单服务操作

现场已确认：API到QQ控制服务HTTP200、共享管理密钥和DNS正确、OneBot连接仍在。网关配置loginRate=3、未启用2FA、网关配置token与环境相同，worker管理token也一致；当前一次受限鉴权仍返回HTTP200/code=-1/rate-limited。尚不能确认原生QQ是否掉线。等待与复查没有恢复管理状态，不继续重复新建鉴权探针。

本方案需要额外重建 `mooyu-qq-worker-1`，用户已明确回复“授权”，允许此处审定的单服务范围。首次服务器执行在构建检查阶段停止，尚未执行停止 worker。QQ原生登录网关 `mooyu-qq-napcat-1`、其登录卷、API、交互执行器、日调度器、数据库、桌面服务均不重启，两套论文保持关闭。

## 已准备的修正

只替换worker中的 `/app/apps/qq-channel/src/napcat-control.mjs`：复用一小时有效的管理凭据至50分钟，普通状态接口失败或超时不再清凭据；只有明确Unauthorized才作废并退避，原60秒限流退避和并发鉴权合并保留。没有更改网关的认证、权限、限流阈值、token、2FA或任何登录数据。

本地候选镜像：`sha256:9e7c8488882efb656b848a83c86f95c4f7bb567c0adfd68fc32a7ee4db82a3d9`。

基础镜像：`sha256:efc4944ddc0ecdb477d539e8e36cad276aab6f9a7351e95b01c0a7688a1c8c1d`。

已测新源码SHA256：`1329ab40e03161b5e75c08bfb57977e6137092c2d3322a94c5441d744d16c022`。

原源码SHA256：`79e7aa4cff56a2cf421416b17551614c8774aafc501e2e51bd65e9f68b1b1f09`。

候选完整继承基础镜像运行配置和全部旧镜像层，仅新增一个源码COPY层。实际镜像内12项鉴权/消息接入测试通过；API宿主相关的12项插件测试另在本地通过，未将宿主API目录添加到worker镜像。恢复步骤、失败停止、资源/日志/权限/tmpfs模型比较等11项本地测试通过（其中含6项鉴权回归，不能与前述数字直接累加为独立用例数）。

## 待执行步骤

1. 在新私有目录保存SHA固定工具与已测源码，验证现有包、当前worker镜像、完整Compose链、配置和环境文件、登录卷引用、两套论文关闭状态及任务空闲。
2. 基于服务器已有不可变原worker镜像构建只替换同一文件的新镜像，无需重传整个镜像。由于构建时间/元数据可能不同，不要求其ID等于本地候选；必须验证基础层前缀、全部镜像运行配置和新源码SHA完全一致。
3. 正常停止QQ worker，保留原容器现场与回退信息。冷却70秒，此间不请求网关鉴权，不修改/清除限流计数器，不停止其他服务。
4. 对专用QQ库创建新保护备份并完整解码校验。worker停下不代表网关或全站数据停写；不宣称跨库原子快照。
5. 在原完整Compose链末尾追加仅含worker image的覆盖，以no-deps/no-build/pull-never重建worker。
6. 核对健康、环境、挂载、网络别名、启动命令、运行权限、资源、日志、临时目录、旧消息/权限/预算/计划/QQ设置及全部其他容器；使用现有worker客户端读取管理状态，报告available/loggedIn/coreReady/connected，不能仅凭连接存活宣称账号在线。

本流程不登录QQ、不获取或刷新二维码、不删除数据、不改密码/token，不提高预算、不重试旧任务。不直接修改网关配置；保留原worker正常连接恢复逻辑。若管理状态仍不可读，记录结果继续审核，不自动重启网关。

每次操作在 `/www/backup/gamehub/qq-auth-client-operation-20261123-随机后缀` 保存记录和 `rollback.sh`。回退只恢复原worker镜像、保留新旧历史，不恢复数据库、不重启其他服务。任何失败停止，无自动重试/自动回退。

已批准命令：`E:\CodexData\build\Right\agent-server-preflight\20261123\qq-auth-client-fix-r1\operator-command\server-update-only-qq-worker.txt`。交接前重新核对了命令中嵌入的各源码SHA与已测工作树一致；现场结果仍待用户执行回传。源代码与测试证明在同任务目录内保留。

## 首次构建检查失败后的权限修正

服务器截图显示在 `build-one-file-worker-image` 阶段以 `DOCKER_RUN_FAILED` 停止，未进入停止、冷却、备份和重建阶段。该错误没有输出底层 stderr，不能将服务器 EACCES 当作已直接观测的事实。本地使用 Linux tar 构建上下文重现服务器 root:0600 源码，证实普通 COPY 后默认 node 用户读取 EACCES；原本 Windows 文件模式测试未覆盖此情况。

修正 Dockerfile 为 `COPY --chown=node:node --chmod=0444`，主机私有源码仍为600。停止现有 worker 前额外核验候选镜像的默认非 root 用户能读取源码、文件归该用户所有、模式0444。源码内容 SHA 保持不变，镜像配置与基础层前缀完全保留。实际修正镜像内12项测试通过，权限复现证明保存在 `E:\CodexData\build\Right\agent-server-preflight\20261123\qq-auth-private-source-permissions-r1\result.json`。

修正版命令：`E:\CodexData\build\Right\agent-server-preflight\20261123\qq-auth-client-fix-r1\operator-command-r2\server-update-only-qq-worker.txt`。在新工具目录和维护记录重新预检及构建，保留原包、原命令和失败记录，沿用既有 QQ worker 单服务授权。管理状态是否恢复仍须以本次服务器结果核实，不将本地测试等同于 QQ 已在线。
