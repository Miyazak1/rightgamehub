# 墨鱼工坊通用能力执行织网 F1

版本：v1.20
状态：F1 控制面至 F1.2c-3b-2f 普通用户域可信桌面安装与整体在线更新已经闭环；F1.3a 至 F1.3b-2b-2c-2b-1 已完成论文版面/OCR 本地能力准入、严格结果合同、签名单/多文件组件安装、逐次复验、最小权限沙箱目录投影、可靠 adapter 进程管理和固定版本 PDF 离线渲染参考实现；生产签名渲染组件、OCR 引擎、Authenticode、图形安装向导及 CDN 发布运营尚未实现
更新日期：2026-10-29

## 1. 决策

墨鱼工坊不把 OCR、游戏、创作工具、论文解析分别做成只能运行在服务器上的孤立服务。平台采用一套通用能力执行织网：

- 服务端是控制面，负责身份、权限、调度、预算、版本、审计和公开产品；
- 浏览器、桌面端和云端是执行面，按能力需求和设备状态承接计算；
- 现有 `Agent Run / Stage / Action / Lease / Event` 继续是唯一任务事实源；
- 本地执行不是旁路。本地节点同样受能力合同、授权、租约、预算和结果验证约束；
- OCR 是第一个复杂消费者，不拥有一套专用任务系统。

目标不是简单地“把服务器代码搬到客户端”，而是在用户感知上保持一个连续任务：平台自动判断哪里运行，需要时下载安装，经用户授权后接续执行，并把可验证结果交回原任务。

## 2. 三类执行面

| 执行面 | 适合任务 | 不适合任务 |
| --- | --- | --- |
| 浏览器 | 轻量预览、交互式工具、Canvas/WebGPU、用户当前打开页面中的短任务 | 长时间后台运行、大型原生依赖、浏览器关闭后必须持续的任务 |
| 桌面端 | OCR、PDF 版面、音视频、批量文件、GPU、隐私文件、受控本地沙箱 | 无桌面端用户、必须全天候执行的公开计划 |
| 云端 | 定时任务、公开 Agent、协作状态、轻量 Provider 调用、无法本地运行时的授权降级 | 默认处理用户私有大文件、在 4 核 8G 主机常驻重型 OCR/模型 |

公开小墨鱼每天 10 点的调度仍由云端接管。用户桌面在线时，可以把适合本地的阶段租给桌面；桌面离线时，策略可以等待、请求云端同意或失败关闭，不能静默上传私有资料。

## 3. 核心合同

`mooyu.capability-execution@1` 描述一个能力，而不是描述某台机器。合同包括：

- 稳定能力 ID、语义版本、输入输出契约；
- 可选执行位置及优先级；
- 浏览器、桌面或云端适配器；
- 平台、CPU、内存、磁盘和 GPU 下限；
- 文件、网络域名和设备权限；
- 是否仅本地、是否允许上传、是否支持离线和后台；
- 能力包 HTTPS 地址、SHA-256、签名、签名 Key ID 和大小；
- 执行位置偏好、云端降级政策、用户在场要求和离线排队政策。

选择器只返回六种可解释状态：`ready`、`download-required`、`waiting-for-user`、`consent-required`、`waiting-for-device`、`unavailable`。它不会把“资源不足”“权限不足”伪装成可执行。

## 4. 持久对象

迁移 `0154_agent_capability_execution_fabric.sql` 增加：

- `agent_capability_execution_manifests`：不可就地改写的能力版本；
- `agent_execution_nodes`：浏览器、桌面、云端节点及资源/权限上限；
- `agent_execution_node_capabilities`：节点安装状态投影；
- `agent_capability_package_receipts`：下载、验签、安装、失败和移除的不可变凭据；
- `agent_stage_placement_decisions`：某个 Stage 某次 attempt 的不可变放置决定。

Stage 重试可以重新选择节点，但不能改写上一 attempt 的决定。安装投影可以更新，安装凭据不能删除或修改。能力版本内容不可原地替换；更新必须发布新版本。

迁移 `0155_agent_execution_node_access.sql` 增加一次性配对、窄权限授权、短期访问 Token、单次续期 Token 和不可变访问事件。迁移 `0156_agent_execution_stage_leases.sql` 增加：

- `agent_execution_stage_leases`：把 Stage attempt、放置决定、节点授权、能力合同、Manifest/输入哈希和租约终态冻结为不可改写证据；
- `agent_execution_stage_result_receipts`：以 `executionLeaseId + submissionId` 记录不可变幂等结果回执。

这两张表都不是新队列，不决定哪个任务可运行；可运行事实仍只来自 `agent_run_stages`。

## 5. 标准运行流程

```text
Agent Stage 进入可运行状态
  → 控制面读取能力合同
  → 汇总在线节点、资源、权限和已安装包
  → 确定性选择执行面
     ├─ ready：创建该节点可领取的租约
     ├─ download-required：下发签名能力包信息
     ├─ consent-required：请求用户允许云端处理
     ├─ waiting-for-device：等待合格设备恢复在线
     └─ unavailable：确定性失败或降级
  → 节点领取原 Runtime Stage
  → 本地/云端执行并生成内容寻址产物
  → 服务端校验合同、哈希、证据和预算
  → 完成 Stage，后续阶段继续
```

下载不是把任意 URL 交给客户端运行。正式桌面端必须：先验证发行签名与 SHA-256，再解包到版本隔离目录；使用权限最小化的子进程；不继承平台 Key；回报不可变安装凭据；支持按版本移除与回滚。

## 6. 安全边界

F1 已实现：

- 严格能力合同和本地专用数据不变量；
- 资源与权限双重选择门禁；
- 签名包元数据及安装凭据账本；
- 能力版本、放置决策和凭据不可篡改；
- 节点归属隔离和 Agent 操作者范围校验；
- 管理接口统一走现有认证，并返回 `no-store`；
- 真实 PostgreSQL 验收覆盖下载到就绪及阶段选中。

F1.1a 已实现：

- 管理员发起、60–600 秒有效的一次性设备配对；配对码只返回一次，数据库仅保存 SHA-256；
- 节点只获得独立执行凭证，不会获得或保存人类账号的 `device_grants`、访问 Token 或刷新 Token；
- 15 分钟节点访问 Token 与独立轮换续期 Token，全部只以哈希形式保存；
- 续期 Token 单次使用；旧 Token 重放会吊销整个窄权限节点会话；
- 节点权限固定为自身心跳、自身能力快照和能力包安装回执，不能调用管理员或普通用户 API；
- 配对权限上限由管理员明确批准，节点不能在心跳时扩大文件、网络域名或设备权限；
- 管理员可撤销节点及其全部凭证；配对、轮换、吊销事件形成不可修改的审计链；
- 真实 PostgreSQL 验收覆盖错误配对、成功配对、轮换、重放吊销、重新配对与节点撤销。

F1.1b 已实现：

- `agent_run_stages` 仍是唯一任务队列；本地节点只能领取已经明确放置给自身、当前 attempt 与已安装能力版本完全匹配的 Stage；
- 普通服务端 Worker 会跳过已经放置到浏览器/桌面的 Stage，也不会在本地 Stage 安全失败进入重试后抢先执行；
- 领取严格遵循既有 `queued → leased → running` 状态机，并在一个数据库事务里冻结节点、授权、放置决定、能力版本、合同版本、Manifest 哈希和运行输入哈希；
- 节点只得到运行输入、已完成前置阶段引用、冻结能力合同和本次租约，不会得到 Agent 全量配置、模型 Key 或人类登录凭据；
- 原始租约 Token 只返回一次，数据库证据只保存 SHA-256；续租、完成和失败都绑定节点、授权、attempt 与租约；
- 节点只可提交严格的 `capability-output-ref-v1` 内容寻址引用；当前接受 `node-local` 产物，校验合同、哈希、大小、媒体类型和有界元数据；
- 完成 Stage、解锁后继 Stage、写入不可变结果回执和终结租约在同一事务完成；相同 `submissionId` 可安全重放，不同结果会失败关闭；
- 安全失败按既有 Runtime 策略重试；不确定外部结果不自动重试；过期租约由现有恢复器回收并同步终结执行证据；
- 真实 PostgreSQL 验收覆盖服务端防抢、本地领取、续租、合同拒绝、原子完成、后继解锁、幂等回放、篡改阻断和失败重试。

F1.2a 已实现：

- Windows DPAPI 当前用户域保护节点凭据和恢复日志，包含中文的秘密通过真实系统调用验收；
- Ed25519 发行签名、Key 生效窗口、归档 SHA-256/大小和包内逐文件清单的执行前验证；
- 安全 ZIP 解包、版本隔离安装、活动版本复验、原子切换与上一版本回滚；
- 安装锁崩溃恢复、已验证包复用、租约续期取消信号和三阶段运行日志；
- `result-pending` 结果幂等重交，`running` 状态重启后报告不确定并禁止自动重放；
- 节点 Token 轮换断电窗口失败关闭，不猜测单次续期 Token 是否仍有效；
- 详细实现与边界见 [Windows 本地能力执行器基座 F1.2a](./mooyu-capability-executor-f1-2a.zh-CN.md)。

F1.2b-1 已实现：

- 原生入口在每次启动前重新校验普通文件、大小和 SHA-256，安装后篡改无法进入沙箱宿主；
- 运行权限严格来自冻结 Placement；服务端输入不能直接授予任意本机文件路径；
- runner 只有在可信宿主具备受限 Token、Job Object、文件/网络/设备隔离和进程树终止全部能力时才允许运行；
- 能力进程不继承平台环境或秘密，只得到有界请求、逻辑文件授权和三个协议路径；
- 输出路径逐层拒绝路径穿越、符号链接和目录联接，结果进入本机内容寻址仓库；
- 服务端只收到不含绝对路径的 `capability-output-ref-v1`；
- 详细实现与边界见 [Windows 原生能力运行安全边界 F1.2b-1](./mooyu-capability-executor-f1-2b1.zh-CN.md)。

F1.2b-2 已实现 MVP：

- helper 每次运行创建临时 AppContainer，并在恢复线程前验证子进程确为 Low integrity AppContainer；
- restricted Token、Job Object、最小 ACL、默认断网、设备拒绝和进程树统一终止已经由真实 Windows 子进程验收；
- CPU、内存、活动进程、磁盘、诊断输出、超时和取消均有本地硬门禁；
- Node 适配器逐次重验 helper SHA-256，能力包不能替换宿主；
- 详细实现与边界见 [Windows 原生沙箱宿主 F1.2b-2](./mooyu-capability-executor-f1-2b2.zh-CN.md)。

当前没有虚假宣称已经解决：

- 管理员控制面仍使用管理员会话；桌面节点已经使用独立短期凭证；
- F1.2b-2 已建立可编译并经真实进程验收的 Windows 原生沙箱宿主 MVP，但还没有普通用户安装器和桌面 UI；这不等于用户电脑已经能执行 OCR；
- 当前结果门禁验证引用结构、合同绑定、内容哈希和事务一致性；本地大产物仍留在设备上。跨设备后继阶段、按需上传同意和内容 Schema 深层验证属于后续数据局部性阶段；
- F1.2c-2 已有签名发布索引、manifest 撤销集合和 key 生效窗口；生产 key 轮换/应急操作、远程证明和 Authenticode 安装器签名仍待产品化阶段完成；
- F1.2c-3b-1 已有当前用户 HKCU 自启、安装账本、受认证本机控制、修复和安全卸载基础；尚无最终托盘、安装制品、目录 ACL 和生产签名；
- 尚未托管任何真实 OCR 能力包，因此不能在后台显示“可下载 OCR”；
- 浏览器关闭后的后台续跑取决于桌面端，不依赖 Service Worker 假装常驻；
- 云端降级必须遵守能力合同和用户同意，不允许默认上传私有文档。

## 7. 单服务器约束

当前只有一台 4 核 8G 服务器。控制面保持轻量：

- 不在生产 API 容器常驻 PP-StructureV3 或大型模型；
- 不把桌面能力包塞进 API 镜像；能力包存对象存储/CDN；
- 数据库只保存合同、状态、哈希和小型审计数据；大产物使用现有对象存储；
- 云端重任务必须单独限并发、限内存并可关闭；
- 调度器只做租约和状态推进，不承担 OCR 计算。

## 8. OCR/论文版面的接入方式

R1.11 以 `research.paper.layout` 能力接入：

1. 文本 PDF 先走现有轻量解析，不无条件 OCR；
2. 只有扫描件、复杂表格或低可信版面进入版面能力；
3. 首选桌面 `native-package`；用户文件默认 `localOnly + upload=never`；
4. 浏览器只承接轻量预览或未来可证明足够小的 WASM 子能力；
5. 云端 OCR 必须显式同意、限页数、限并发并计费；
6. 输出统一为版面块、页码、坐标、置信度、公式/表格/图片引用及工具版本；
7. 质量门禁仍由服务端决定，OCR 自己不能宣称论文内容可靠。

PP-StructureV3 只是候选实现，不进入通用合同。将来可以替换为其他 OCR 引擎，而论文工作流和 UI 不需要重写。

## 9. 管理接口

F1 提供管理员控制面：

- `GET /v1/admin/capability-execution`
- `POST /v1/admin/capability-execution/manifests`
- `POST /v1/admin/capability-execution/manifests/:capabilityId/:capabilityVersion/activate`
- `POST /v1/admin/capability-execution/nodes`
- `POST /v1/admin/capability-execution/nodes/:nodeId/heartbeat`
- `POST /v1/admin/capability-execution/nodes/:nodeId/package-events`
- `POST /v1/admin/capability-execution/placements`

F1.1a 增加可信设备接口：

- `GET /v1/admin/capability-execution/access`
- `POST /v1/admin/capability-execution/pairings`
- `POST /v1/admin/capability-execution/nodes/:nodeId/revoke`
- `POST /v1/capability-execution/pair`
- `POST /v1/capability-execution/session/refresh`
- `GET /v1/capability-execution/node`
- `POST /v1/capability-execution/node/heartbeat`
- `POST /v1/capability-execution/node/package-events`

F1.1b 增加节点 Runtime 接口：

- `POST /v1/capability-execution/node/stage-leases/claim`
- `POST /v1/capability-execution/node/stage-leases/:executionLeaseId/renew`
- `POST /v1/capability-execution/node/stage-leases/:executionLeaseId/complete`
- `POST /v1/capability-execution/node/stage-leases/:executionLeaseId/fail`

所有返回配对码或节点凭证的响应均禁止缓存。配对发起与节点撤销属于管理员权限；配对兑换与续期使用各自的一次性秘密；节点接口只接受节点 Token。当前 `deviceKeySha256` 是设备生成公钥的固定指纹身份，桌面端签名挑战与系统密钥库封装在桌面执行器阶段完成。

## 10. 后续目标

### F1.1a：可信设备接入（已完成）

- 一次性配对、设备密钥指纹、短期节点 Token、轮换与吊销；
- 独立于人类登录态的最小权限节点主体；
- 心跳、自身能力快照、安装回执及审计账本；
- 管理接口已就绪，最终桌面 UI 尚待执行器产品化。

### F1.1b：Runtime 租约协议（已完成）

- 只允许节点领取明确放置给自己的 Runtime Stage；
- 服务端冻结运行输入哈希、能力合同和能力版本，节点输出必须经过严格引用合同与内容哈希验证；
- 已具备续租、幂等结果提交、过期租约拒绝和安全恢复；
- 桌面节点不能直接调用内部 `completeStage` 绕过节点结果门禁；
- 租约继续使用现有 `agent_run_stages`，没有建立第二套任务队列。

### F1.2a：Windows 执行器内核（已完成）

- 签名包验证、安全解包、版本隔离、原子激活和回滚；
- DPAPI 系统凭据保护、节点 API 客户端、后台续租和崩溃恢复；
- 伪能力包与真实 Windows DPAPI 自动化验收；
- 尚未接入任意真实 OCR 或其他原生能力。

### F1.2b-1：原生运行安全边界（已完成）

- 严格 runner 协议、安装入口二次校验和冻结权限投影；
- 必须具备完整安全原语的沙箱宿主端口；
- 本地文件授权代理边界、输出目录逃逸阻断和内容寻址产物仓库；
- 未使用普通 `spawn` 冒充 Windows 沙箱。

### F1.2b-2：Windows 原生沙箱宿主（已完成 MVP）

- restricted Token、AppContainer Low Token、Job Object、ACL 工作区和进程树终止；
- 默认断网；非空网络域与设备请求失败关闭，精细放行留到后续版本；
- CPU、内存、磁盘、诊断、超时与取消限制的真实进程验收；
- helper 源码、构建脚本和 Node 逐次 SHA-256 门禁；生产代码签名随桌面安装器完成；
- 详细实现见 [Windows 原生沙箱宿主 F1.2b-2](./mooyu-capability-executor-f1-2b2.zh-CN.md)。

### F1.2c-1：可信运行时发布与本地装配（已完成）

- Ed25519 签名运行时清单绑定平台、最低 OS、版本、helper 路径和逐文件哈希；
- 版本隔离安装、遗留锁恢复、活动状态原子切换和上一版本回滚；
- bootstrap 只能从已验证安装目录装配 sandbox host、runner、artifact store 和 executor runtime；
- 能力包与 helper 分属两条信任链，能力包不能替换平台宿主；
- 详细实现见 [Windows 可信运行时发布与本地装配 F1.2c-1](./mooyu-capability-executor-f1-2c1.zh-CN.md)。

### F1.2c-2：可信在线更新内核与无界面安装外壳（已完成）

- Ed25519 签名发布索引、目录/发布双单调序列、撤销集合、过期和 key 生效窗口；
- HTTPS 内容寻址缓存、可恢复 Range 下载、归档逐字节校验和安全解包；
- 单实例事务日志、断电恢复、真实 helper 自检、健康失败自动回退；
- 稳定 CLI 退出码和首次安装/更新/状态/恢复无界面外壳；
- 详细实现见 [Windows 可信在线更新器 F1.2c-2](./mooyu-capability-executor-f1-2c2.zh-CN.md)。

### F1.2c-3a：常驻桌面节点生命周期内核（已完成）

- 单实例 supervisor 串联更新恢复、可信更新、运行时装配、执行日志恢复、心跳和任务领取；
- 暂时故障有界指数退避，连续失败熔断，信任或单次 Token 状态不确定时自动暂停；
- 停机停止领取新任务，活动任务按租约和超时收尾；状态与诊断严格脱敏；
- `run/status/pause/resume/stop/diagnostics` CLI 及真实 Windows helper/DPAPI 端到端验收；
- 详细实现见 [Windows 常驻桌面节点生命周期内核 F1.2c-3a](./mooyu-capability-executor-f1-2c3a.zh-CN.md)。

### F1.2c-3b-1：桌面节点产品外壳基础（已完成）

- 原子安装账本、SemVer 单调升级、降级阻断和中断修复；
- HKCU 当前用户自启注册、命令行安全转义、写后读回核验和撤销；
- DPAPI 控制密钥、一次性挑战和 HMAC 的本机命名管道；
- 托盘状态投影、安全停机卸载、默认保留数据及稳定 shell CLI；
- 真实随机 HKCU 测试键可逆验收；
- 详细实现见 [Windows 桌面节点产品壳基础 F1.2c-3b-1](./mooyu-capability-executor-f1-2c3b1.zh-CN.md)。

### F1.2c-3b-2：桌面节点安装制品与最小交互安全内核（已完成）

其中 F1.2c-3b-2a 至 2d 已完成文件授权、同意队列、授权中心和原生托盘；F1.2c-3b-2e 已把 Node、桌面壳、托盘、沙箱 helper 和依赖纳入同一签名清单，实现内容寻址安装、精确修复、升级双回滚、HKCU 启动注册与保留用户数据的卸载；F1.2c-3b-2f 已增加独立签名产品目录、HTTPS/Range 内容寻址下载、污染缓存复验、断电事务恢复、健康失败回滚以及不请求管理员权限的普通用户 bootstrap 包。详见 [Windows 可信桌面制品与安装生命周期 F1.2c-3b-2e](./mooyu-capability-executor-f1-2c3b2e.zh-CN.md) 与 [Windows 整体桌面在线更新与普通用户安装包装 F1.2c-3b-2f](./mooyu-capability-executor-f1-2c3b2f.zh-CN.md)。

截至 F1.2c-3b-2f，扩展 Windows 验收在真实普通用户令牌下为 82/82；受限命令沙箱不具备 AppContainer Token 和 HKCU 写入权限，不能替代真实桌面验收。原子状态替换和构建目录切换已覆盖 Windows 短暂文件占用的有限重试，重试耗尽后保持失败关闭。

- Authenticode、时间戳、安装器、卸载/修复与系统级 ACL；
- 最小权限长期节点、设备签名挑战、计划任务/服务生命周期、托盘和诊断导出；
- CDN 生产托管、发布 key 轮换操作、撤销应急流程和回滚可视化；
- 数据局部性解析：同设备后继阶段优先、跨设备明确等待、用户同意后才上传或云端降级；
- Windows 完成后再定义 macOS/Linux 的签名、notarization 和沙箱，不复制 Windows 假实现。

### F1.3：首个真实能力

- F1.3a 已冻结 `research.paper.layout@1`、逐页确定性路由、严格证据坐标与质量合同，并提供会复验获授权 PDF 哈希的自包含 Windows 参考包；
- F1.3b-1 已冻结引擎描述符、逐页引擎计划和签名模型组件目录；大模型独立按需分发，按引擎、平台、语言、摘要和大小精确绑定并支持撤销，不进入 API 镜像或基础桌面包；
- F1.3b-2a 已完成组件 HTTPS Range 续传、内容寻址安装、逐次复验、空间配额、活动/回退引用保护和安全清理，并将冻结引擎计划绑定到可信本地组件文件；
- F1.3b-2b-1 已把组件解析放入可续租执行期，并按摘要、大小和 Windows 文件身份复验后只读投影到 AppContainer；旧 helper 通过协议版本失败关闭；
- F1.3b-2b-2a 已冻结多文件组件包合同和安全解包器，外层摘要、内部文件全集与逐文件摘要必须同时成立；
- F1.3b-2b-2b 已用签名目录 v2 绑定内部清单身份，完成持久多文件存储、活动/回退保护、逐次全量复验、论文引擎绑定和 Windows helper v4 目录最小权限投影；当前受管开发会话无法创建受限令牌，真实 AppContainer 目录验收仍须在普通桌面发行环境完成；
- F1.3b-2b-2c-1 已冻结独立引擎子进程请求、单调进度、精确页集合结果、取消与有界诊断协议，第三方 Python API 不进入通用执行器合同；
- F1.3b-2b-2c-2a 已完成 adapter 进程管理器，强制一次性工作目录、只追加进度、稳定结果、有界日志、协作取消和超时失败关闭；生产进程树终止继续由外层 Windows Job Object 保证；
- F1.3b-2b-2c-2b-1 已完成固定 pdfjs/canvas 版本的本地离线页面渲染、逐页 PNG 摘要和重新复验；生产启用仍须签名组件封装与开放 PDF 金标；
- 复杂版面不等于 OCR：文字层完整的双栏/表格/公式进入本地版面恢复，只有缺失、低密度、损坏或扫描页面进入 OCR；
- 桌面放置固定为用户选中文件、零网络、仅本地、禁止云降级，详见 [论文版面与 OCR 本地能力准入 F1.3a](./mooyu-capability-executor-f1-3a.zh-CN.md)；
- F1.3b-2b-2c-2b-2 完成签名 PDF 渲染组件和开放金标后，才接 PaddleOCR/PP-StructureV3 CPU 引擎，不在服务器常驻模型；
- 双栏、扫描、表格、公式、图片评测；
- 本地优先；私有 PDF 当前不提供云端降级；
- 成本、耗时、失败和质量指标。

### F1.4：横向复用

- 音视频转写、图片处理、仓库沙箱、游戏构建；
- 同一能力可被 Agent、工具页和桌面文件入口复用；
- UI 统一显示“准备、下载、运行、等待设备、降级和完成”。

## 11. F1 验收证据

- 纯合同与选择器测试覆盖严格字段、本地专用边界、包下载、离线、同意、资源和权限；
- 路由测试覆盖认证接入、输入 Schema 与禁止缓存；
- 真实 PostgreSQL 17 测试覆盖迁移、能力注册、节点登记、四步安装凭据、下载前后放置和不可变约束；
- 真实 PostgreSQL 17 租约测试覆盖服务端防抢、节点领取/续租、原始凭证不落库、合同拒绝、原子完成、后继解锁、幂等重放、结果防篡改及失败重试；
- 现有 Runtime、Tool Gateway 和 Capability Registry 未被替换。

因此当前可以宣称“通用执行织网控制面、可信节点身份、Runtime 本地租约交接、Windows 执行器内核、原生沙箱宿主、可信本地装配、整体桌面在线更新、普通用户域无管理员安装内核，以及首个论文版面能力的准入与包合同已经建立”，不能宣称“生产 Authenticode/SmartScreen、图形安装向导、生产 CDN 发布运营或 OCR 引擎已经可供公众下载”。
