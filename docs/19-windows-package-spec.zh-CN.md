# Windows EXE 上传下载与侧栏运行验证技术规范

版本：TD-1.1 · 日期：2026-09-22 · 状态：分发为首版要求，原生侧栏运行待实验 · [多宿主客户端](./18-multi-host-client-spec.zh-CN.md)

2026-09-24 实施补充：已完成桌猫下载副本的原生画面/部分鼠标回传探针，见 [22 实测报告](./22-native-exe-local-test.zh-CN.md)。完整运行兼容性仍未通过；仅提供明确标注的实验入口，不改变下述正式发布门槛。

## 1. 包范围与界面规则

用户已明确需要 EXE 安装包下载。平台在同一 Work 下支持 `web`、`windows-x64`、`windows-x86`、`windows-arm64` 等独立目标；先验收 Windows x64，其他架构只在明确标注和测试后开放。macOS/Linux 宿主仍可查看详情和保存包，不能显示该 EXE 可在本机运行。

| packageType | 上传内容 | 下载后的含义 |
| --- | --- | --- |
| `web_zip` | 根目录 index.html 与静态资源 | 在线功能区运行，沿用 16；本轮不要求离线缓存 |
| `windows_portable_zip` | 完整 EXE、DLL、资源和声明入口 | 保存原 ZIP；后续运行前受限解包须保留完整目录，不能只取 EXE |
| `windows_standalone_exe` | 声明可独立运行的单 EXE | 保存原字节，不自动执行 |
| `windows_installer_exe` | 实际 setup/安装器 EXE | 支持上传检查与下载；安装、提权与侧栏运行另行处理 |

安装器的压缩布局、外部下载、管理员权限、服务/驱动请求必须声明并参与策略检查。无法完整检测的包留在私有复核状态；不能为了支持 EXE 后缀就跳过检测。下载功能不自动安装软件，不替作者签名，不绕过系统提示。

Windows-only 作品显示“下载 Windows 版”，不显示“网页在线玩”；双目标作品显示两个准确入口。只有该 release/宿主/运行组件组合经过侧栏实测，才显示“在功能区运行”。

**侧栏运行的新增硬性条件（2026-09-24）**：游戏从启动到退出只在宿主右侧功能区呈现，不出现独立可见桌面窗口，不允许先弹窗再隐藏、不抢前台，也不要求玩家最小化/还原或切换窗口。后台进程可以存在。任何依赖独立可见窗口的实现，即使能把画面回传右栏，也不能获得 `nativeSidebarPlayable` 认证。现有桌猫窗口串流探针未满足该条件。

## 2. 多目标数据修订

单一网页设计的 `works.current_release_id/publish_generation` 已在 14 同步改为 `work_targets`；所有目标不共用发布指针。

| 实体 | 增量/替换 |
| --- | --- |
| Work | 保留归属、资料、全局 visibility/state、metadata revision；全局撤下禁用所有目标 |
| WorkTarget | PK `(work_id,target_key)`，`current_release_id`、`revision`、`publish_generation`、`state(draft/published/withdrawn/suspended)` |
| Release | `target_key/package_type/os/arch/entry_path/requirements`、`download_artifact_id NULL`；沿用 14 的 validation_state/serving_state，不再增加含义重复的 distribution_state；web 的 asset 清单继续存在 |
| UploadJob | `target_key/package_type`、该目标的 publish_generation；不得由完成请求更换目标 |
| DownloadArtifact | `id/release_id UNIQUE/object_key/size_bytes/sha256/file_name/content_type`；绑定不可变原始包 |
| ScanReport | `id/release_id/artifact_sha256/status/engine/rules_version/scanned_at/coverage/signature_result/error_code`；报告不可用不能当 clean |
| RuntimeCompatibility | `release_id/artifact_sha256/host/version/runtime_component_version/os/test_result/evidence`；与扫描结果分开 |

`WorkTarget(work_id,target_key,current_release_id)` 复合外键指向 Release 同目标唯一键。每目标最多 3 个常规版本，共用作者存储配额；新建 Windows 目标不能覆盖网页当前版本或发布意图。

元数据更新用 Work ETag；目标发布/撤下用 `"target-<workId>-<targetKey>-<revision>"`。整体撤下/禁用在事务中递增所有目标意图序号，阻止旧后台任务再次发布。只撤下 Windows 不影响已发布网页；没有任何可见目标时不在大厅列为可玩。

## 3. 上传与发布接口变化

复用 14 的创建作品、上传申请、内容流、complete、状态和幂等机制，上传请求增加必填 `targetKey/packageType`，Windows 增加 `entryPath/requirements`。例如：

```json
{
  "fileName": "tiny-world-setup.exe",
  "declaredBytes": 52428800,
  "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "releaseLabel": "0.1.0",
  "autoPublish": true,
  "targetKey": "windows-x64",
  "packageType": "windows_installer_exe",
  "requirements": {
    "os": "windows",
    "arch": "x64",
    "requiresAdmin": true,
    "installsDriver": false,
    "downloadsAdditionalFiles": false
  }
}
```

requirements 为作者声明，不代表平台已验证。EXE 内容流使用 `application/octet-stream`，ZIP 使用 `application/zip`；服务端以真实格式核对。单 EXE 的 entryPath 不接受任意本机路径；ZIP 只允许规范化包内相对路径。

发布路由修订为 `POST /v1/creator/works/{id}/targets/{targetKey}/publish`，body `{releaseId}`；目标撤下为同路径 `/withdraw`。原 Work `/withdraw` 保留为全部撤下。公开详情返回 `targets[]`，网页 launch 显式选择 web；Windows 目标不通过 iframe launch 冒充运行。

Windows UploadJob 为 `validating → scanning → succeeded`，Release.validation_state 为 `processing → scanning → ready`；错误到 failed/review_required。DownloadArtifact 未就绪或 scan 非 clean/approved-policy 时不得将 serving_state 设为 enabled。ready 只说明符合分发策略，`nativeSidebarPlayable` 另由兼容报告和请求宿主环境决定，缺省 false；缺少环境信息时不得返回全局可玩的结论。

## 4. 限制和检测链路

Windows 初始最大包 500 MiB、便携 ZIP 最大展开 1 GiB、最多 10,000 文件；接收总时限 30 分钟，接收无数据 60 秒中止，全局至多一个 Windows 大包上传。真实检测器上限低于上述值时以更低上限为准，UI 和 API 同步，不允许超限跳过扫描。

已有网页 100/300 MiB 限制保持不变。Windows 配额预留按 `declaredBytes + allowedExpandedBytes` 计算；single EXE/installer 不声称解出全部内容，扫描器临时展开空间另有限额。原 16 的禁止 exe/dll 规则仅用于 web_zip；Windows 分支允许必要可执行文件，但继续禁止路径逃逸、链接、加密未知归档和无法检查的异常内容。

```text
插件内选择文件与发布意图
  → 有限授权上传至私有隔离区
  → 实际大小/hash/ZIP 或 PE 结构检查
  → 独立扫描任务：最终分发字节及可解析内含文件
  → 绑定 hash 的检测和签名结果
  → 符合策略：不可变 DownloadArtifact、目标发布事务
  → 检测不完整/超时/失败/命中：继续私有，复核或拒绝
```

扫描器及其解析库在独立受限环境运行，无作者凭据和生产工作区；默认不执行安装器。需动态兼容测试时使用独立 Windows 测试环境，不在业务机、开发主机或玩家机器自动试跑陌生包。不默认把作者私有包上传到会共享样本的第三方服务。

协调 worker 通过 14 的 scan 任务租约调度扫描，扫描环境只拿本任务受限对象读取授权和输出通道，不直接访问生产数据库。结果包含 jobId/attempt/leaseToken/artifactSha256；协调层验证当前租约与包 hash 后提交 ScanReport 和发布事务，旧结果不得覆盖新任务。扫描器选择、许可、完整安装器覆盖能力与实际资源上限是实现前要完成的技术探针；未验收不能开放 Windows 投稿。

分发对象保持作者原始包字节，扫描 SHA-256 与下载 SHA-256 完全一致；不重打包或重新签名破坏 Authenticode。ZIP 内还记录文件 hash，检测结论有引擎、规则版本、时间和覆盖范围；“通过”不表述成绝对无毒。新规则要求复核时可暂停该 hash 的全部关联版本。

## 5. 下载接口、续传与本地记录

`GET /v1/works/{workId}/releases/{releaseId}/download-info` 返回：

```json
{
  "data": {
    "releaseId": "ba785530-913e-48c6-8d1b-ab423c1a26ad",
    "targetKey": "windows-x64",
    "packageType": "windows_installer_exe",
    "fileName": "tiny-world-setup.exe",
    "sizeBytes": 52428800,
    "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "downloadUrl": "https://download.gamehubusercontent.example/v1/works/2b318e4b-5470-4890-b452-6e15c2cba117/releases/ba785530-913e-48c6-8d1b-ab423c1a26ad/download",
    "supportsRanges": true,
    "nativeSidebarPlayable": false
  }
}
```

下载域与账号域隔离；对象仍私有，不能重定向到能绕过禁用的长期桶地址。网关确认 Work、Target、Release 和扫描状态允许，再查缓存或读取。公开免费包无需账号/领取，不向客户端泄露对象键或 scanner 凭据。

返回 `Content-Disposition: attachment`、安全 fileName/filename*、`application/octet-stream`（EXE）或 `application/zip`、nosniff、no-store、强 ETag(hash)、Content-Length；支持单 Range/If-Range，非法多范围 416。每次 GET/HEAD/Range 重新经过允许状态门禁，TTL 沿用最多 30 秒，撤销新请求的目标 60 秒；已经传出的或正在传输的字节不能追回。

客户端先写随机 `.part` 文件，记录 releaseId/hash/总字节。续传校验 206、Content-Range 起点和 ETag；服务器返回 200 或版本身份变化时清空并重新开始，不能把完整 body 追加到半包。完成后校验整体 SHA-256，再原子改名到用户确认的目标；不覆盖同名已有文件。失败/取消保留或删除自己的临时文件，不触碰其他目录。

状态机：`queued → downloading → verifying → completed`，可到 paused/cancelled/failed；下载完成不进入 running。保存的本地绝对路径只在宿主可信层，不上报平台，也不暴露给游戏 iframe。下载记录与资产身份绑定，文件被外部修改时重新检查。

平台不会主动去除系统下载来源标记或引导关闭防护。不同宿主采用程序化保存时的 Windows 来源标记/签名提示需要实测并采用该平台支持的方式处理，不能声称与浏览器下载提示完全一致。

## 6. 原生侧栏运行：独立实验关卡

继续执行 [09 的完整验证计划](./09-exe-sidebar-validation.zh-CN.md)，目标宿主增加 Harness、VS Code、Cursor 编辑器，分别记录版本。桌猫样本已证明的是 Electron 网页内容可提取运行，不是普通原生 EXE 的通用方案。

先核查正式原生窗口容器接口；没有时优先研究“可选本地 Windows 运行组件＋侧栏 WebRTC 播放器”。原生程序在本机运行，组件捕获指定游戏窗口和声音，功能区显示并回传输入。需要额外组件应如实体现在安装说明中；这不要求分叉或维护整个 IDE。

运行组件只接受可信平台客户端发出的 releaseId/已校验 artifact 选择，不接受游戏网页提交任意路径、命令行或 shell。组件配对、会话 token、进程归属、输入释放和关闭行为单独设计；网页游戏自身不持有运行组件授权。不得用侵入宿主私有窗口、代码注入、关闭系统防护作为产品接入方法。

真实 EXE 验收必须同时满足画面、声音、正确输入、无抢前台、尺寸/DPI、隐藏/恢复、30 分钟稳定性和资源清理。只有视频能显示、只调用了输入 API 或弹出独立窗口均不通过。运行结果绑定 release hash、引擎、宿主与组件版本；不能给所有 Windows 包统一标记“侧栏可玩”。

安装器包通常还需要安装和发现启动程序，不能把 setup.exe 自身当作游戏进程。该环节必须有用户明确的安装操作、独立环境/权限验证与最终程序身份校验；首轮原生实验优先用自有便携 EXE，安装器的侧栏运行资格默认不开放。

## 7. 运维和交付门槛

原 S 档业务机可继续承担 API/数据库和受限上传转发，但 Windows 检测不能套用网页解析的 512 MiB 限额。新增独立扫描资源或受控检测服务，并按所选扫描器测量 CPU/内存/超时。500 MiB 包、备份和下载流量也增加成本；旧的 30—40 USD/月网页预算不能当作本次完整总价。

上线前必须通过：便携 ZIP、独立 EXE、真实安装器下载与 hash；跨作者/跨目标越权；扫描不可用时 fail closed；Range 续传与中断、磁盘不足、目标碰撞；禁用后新下载拒绝；Harness/VS Code/Cursor 的真实保存位置与进度。

**分发闭环和原生侧栏实验分别交付报告。**网页功能区通过、Windows 下载通过、Windows 功能区运行通过是三种不同状态，在大厅和兼容列表中明确显示。
