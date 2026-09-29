# 网页上传、自动发布与运行隔离技术规范

版本：TD-1.1 · 状态：待实现与安全验收 · [技术总纲](./13-technical-design.zh-CN.md)

本篇配额、MIME 与执行文件拒绝规则针对 web_zip；Windows ZIP/EXE/安装器使用 [19](./19-windows-package-spec.zh-CN.md) 的专门分支。插件内上传与有限授权见 [18](./18-multi-host-client-spec.zh-CN.md)。

## 1. 初始配额与时间限制

以下为试运行配置默认值，不是已测性能或永久产品承诺。所有限制在服务端执行，插件与可选网站负责提前提示。

| 项目 | 默认限制 |
| --- | --- |
| ZIP 实际字节 | 100 MiB = 104,857,600 bytes |
| 实际解包总量 / 单文件 | 300 MiB / 100 MiB |
| 文件数 / 路径深度 | 5,000 / 16 层 |
| 路径 / 文件名长度 | 规范路径最多 512 UTF-8 字节、单段最多 160 字节 |
| manifest | 16 KiB，严格 Schema |
| 每作者作品 / 常规版本 | 5 件 / 每个构建目标 3 版 |
| 每作者存储 | 5 GiB，含保留的原始包、运行资产和待清理资产 |
| 上传接收并发 | 全局 2，每作者 1 |
| 检查并发 | 全局 1 |
| 开始上传时限 / 接收总时限 | 创建后 30 分钟 / 接收后 15 分钟；连续 60 秒无数据中止 |
| 解包子任务 | 内存 512 MiB、最多 1 CPU、进程数 32、120 秒墙钟、1 GiB 可写空间 |
| 存储传输步骤 | 单步骤 300 秒；失败按 14 的瞬时重试规则 |

配额申请在 `creator_usage` 行锁内完成：预留 `declaredBytes + 300 MiB`，完成后转换为实际用量，失败或过期恰好释放一次。更新版本也受配额限制。每天按对象清单和任务状态对账，发现差额告警，不把客户端上传百分比用于计量。

HTTP 初始限流建议：创建上传每作者每小时 10 次；公开目录每 IP 每分钟 120 次；启动描述每 IP 每分钟 60 次；匿名举报每 IP 每小时 5 次。运行资产单独按带宽和请求预算管理，不能使用会打断一个 5,000 文件作品加载的 API 限流阈值。共同出口用户的影响需在试运行调整。

## 2. ZIP 接收：可硬限制的最小路径

1. API 校验作者授权或单任务 upload grant、发布权限、归属、配额和任务有效期；原子取得 receiving 状态，拒绝同任务并发写入。
2. 接收 `application/zip` 原始 body。若 Content-Length 已知，先检查与声明一致并不超限；无论有无该头都按实际接收字节计数，超限立即中止。
3. 流式计算 SHA-256，以固定小块写 R2 私有隔离桶；不得一次读完整 ZIP 到内存。实现可用 multipart，部件建议 8 MiB、每上传最多两个在途部件，总缓冲有硬上限。
4. 只有对象写入完成、实际字节与哈希符合声明后，才将上传任务设为 uploaded。断连、超时、hash 不符或存储失败中止 multipart，并标记任务失败。
5. `complete` 再核对对象存在、大小和任务状态，幂等入队。worker 读取时重新计算 hash，不能只把 ETag 当 SHA-256。

隔离对象键由服务端生成，例如 `quarantine/<uploadId>/<randomId>.zip`，不能来自 fileName。成功对象只读，不给作者重复覆盖的路径。作者没有桶凭据或任意对象读取能力。

首版业务域上传流量直达本机 HTTPS 代理；代理关闭整包缓冲并配置匹配的字节/超时限制。如果增加 CDN/WAF 到此路由前，必须重新核验其请求体上限，不能把 100 MB 当作 100 MiB。R2 直传可在以后优化，当前不依赖 presigned PUT 来提供最大字节保证。

## 3. 解包进程与任务协调分离

协调 worker 领取任务、下载固定对象、调用受限解析程序、上传检查结果并提交数据库。它不得 import 或执行 ZIP 内的模块、package.json 脚本或二进制。

生产解析程序放在独立的 rootless 容器中运行：固定且锁定镜像、只读根文件系统、关闭网络、移除 capabilities、no-new-privileges、非 root UID、只读输入文件、仅本任务输出目录可写。由主机的专用协调服务启动固定参数容器；不向业务 API 暴露容器控制接口，也不向解析容器挂载 Docker/Podman socket。

解析容器没有数据库、R2、云元数据或宿主工作区凭据；输出为受限目录和 JSON 检查报告。协调进程读取报告时再次验证路径、大小、文件类型和 Schema，不能把子进程打印的路径直接拿去上传或删除。

内存/CPU/进程/磁盘/时间限制必须在所选 Linux 机器上实测生效；rootless 环境若不能落实 cgroup 限制则不开放投稿。容器共享内核，不代表未知输入绝对安全，仍需更新解析库和宿主补丁。需要真正执行游戏的动态复核放在独立测试环境，不放在业务机器或解析容器。

## 4. 必须拒绝的包结构

- 非 ZIP、加密 ZIP、分卷 ZIP、不支持的压缩方式、损坏的目录/CRC，以及头部和实际字节不一致。
- `..`、绝对路径、盘符、UNC、反斜杠、NUL、控制字符、符号链接、硬链接、设备文件、特殊文件。
- 规范化后重复、Unicode NFC 冲突、大小写折叠冲突，以及文件与目录相撞；不得覆盖先前条目。
- Windows 保留设备名、尾随点/空格等跨平台歧义路径；网关无法无歧义映射的路径字符应在上传时拒绝并说明原因。
- `%`、`?`、`#` 等本基线不接受的文件名字符，避免不同 URL 解码层对同一资产产生不同映射。
- 超过实际展开字节、单文件、文件数、深度或任务时限；不能只信 central directory 中声称的大小。

路径实现要求：验证每个 path segment，输出目标经 resolve 后必须严格位于新建任务根目录下；创建普通文件时使用不跟随链接且排他创建的方式。输出目录事先为空、只能由本任务访问；创建后仍检查 inode 类型和实际大小。清理程序同样先验证绝对路径在专用任务根目录内。

允许 zip 中压缩率很高但符合总量约束的正常文件；不要只凭压缩比作唯一裁决。拒绝 `.exe/.dll/.bat/.cmd/.ps1/.sh` 等明确的桌面/安装脚本以及嵌套归档；不递归解压包内 ZIP。不把这一扩展名规则当作恶意脚本检测的充分条件。

上传限制采取格式、实际容量、随机存储键、权限和独立存储等多层措施；平台的具体数值和自动发布流程为本项目设计。[OWASP 文件上传建议](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)

根目录必须有普通文件 `index.html`，不自动尝试运行任意目录。WASM、glTF/glb、音频和二进制 data 保持文件名及相对引用。建议作者使用相对路径；依赖服务器 rewrite、未打包 npm 模块和远程 CDN 的包需重新导出。

## 5. 检查与兼容结论

解析 `platform.json`，缺省采用 15 的基础能力；检查文件清单、根入口和声明的入口/资源是否存在。可确定的 HTML/CSS 本地引用缺失应给出错误，但不声称静态检查能发现 JS 动态拼接路径或证明作品逻辑无 bug。

默认拒绝外部网络、摄像头、麦克风和多线程请求。当前策略未支持的能力进入 review_required，管理员可以要求重打包或拒绝；不得通过编辑数据库随意批准运行策略无法兑现的权限。正常包自动通过，侧栏 SDK 优化标记需另做兼容验证。

兼容模板应分别记录入口 MIME、WASM 单线程、音频启动、屏幕尺寸和是否使用 eval/Worker。默认模板不允许 JS eval 和 Web Worker；需要这些能力的引擎导出暂不承诺兼容，不能为通过一个样本直接放开整个域策略。

封面先用平台生成占位图；如接受作者图片，只允许有限尺寸 PNG/JPEG/WebP，经受限解码重编码后放到 media 域。SVG、HTML 和未经处理的作者文件不在可信业务域执行。

## 6. 不可变发布与竞态处理

每个上传任务创建唯一 releaseId，重试不另建 Release。每次处理使用独立 attempt 前缀：

```text
runtime/<releaseId>/<attemptId>/assets/<validated-relative-path>
runtime/<releaseId>/<attemptId>/asset-manifest.json
runtime/<releaseId>/<attemptId>/complete.json
```

全部资产上传并验证哈希后，写包含文件路径、大小、MIME、哈希的清单，再写完成标记。对象存储不存在“原子移动目录”的假设；发布事务直接引用已完整写好的 attempt 前缀。没有数据库允许状态的前缀始终不可公开。

数据库事务锁定 Work/对应 WorkTarget/Release/任务并确认 lease_token，按 14/19 校验权限和该目标 publish_generation，写 assets、版本元数据、目标指针与审计。任一步失败均不改变该目标旧 current_release，其他目标不受影响。

竞态规则：

| 场景 | 必须结果 |
| --- | --- |
| complete 重复、消息重投、worker 重启 | 同一 job/release，至多一次可见发布效果 |
| A 上传先开始但晚于 B 完成 | A 不覆盖 B 的较新发布意图，A 留为 ready |
| 检查中作者撤下/管理员禁用 | 序号或状态校验阻止自动重新公开 |
| 对象已写完、事务失败 | 旧版本仍可用；重试或清理未引用 attempt |
| 旧租约任务与新 worker 同时完成 | 只有当前 lease_token 能提交；旧产物为孤立候选 |
| 版本更新后旧玩家仍在读取 | 在旧版 serving enabled 和保留期内按原版返回，不偷偷换资源 |

## 7. 运行网关的每次读取

只接受 `r-<32位小写十六进制releaseId>` 的运行 host，以及 GET/HEAD。先从 host 解析 ID，再从内部状态接口取得可信前缀；不得把任意 Host、路径或 query 直接拼成对象存储键。

处理顺序固定为：

```text
校验 host、方法和路径
  → 检查发布/禁用状态（未过期短缓存或权威 API）
  → 读取并验证该版本的资产清单
  → 清单内精确匹配规范路径
  → 查内部边缘缓存
  → 未命中才从私有存储读取
  → 叠加平台生成的安全头，返回客户端
```

请求路径只做一次严格 UTF-8 解码，拒绝编码斜杠/反斜杠、无效转义、点段和超长路径；根 `/` 映射 index.html。query 不参与资源路径和执行，只在合法资产匹配后忽略；对象 URL 不向上游转发作者提供的参数。不存在的资源返回真实 404，不用 index.html 兜底成假成功。

状态允许缓存最长 30 秒，不使用过期允许结果兜底。API 超时且没有新鲜允许结果则返回 503。资产与状态分开缓存；不允许 CDN、Worker 前置缓存或桶公开地址绕过这一步。

内部资产缓存键含 releaseId、文件 hash、policyVersion；仅缓存完整 200 的不可变实体。返回浏览器的 HTML 和资产都设置 `Cache-Control: no-store`，内部 Cache API 使用单独 response 副本和缓存头。这样用户下次网络读取经过状态检查；已加载代码和主动保存的资源仍无法追回。缓存按清单字节键管理，查询参数不能无限制造缓存项。

Cloudflare 的 Cache API 缓存局限于写入的数据中心，单次 `cache.delete` 不是全球失效。因此正确性依靠短时状态门禁，清除资产缓存仅作辅助；部署时关闭可在 Worker 前直接返回内容的缓存路径。[Cloudflare Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/)

状态响应、清单与内存缓存都设边界；parsed manifest LRU 总上限建议 8 MiB。`HEAD`、条件请求和 Range 也先过门禁。首版支持单一字节 Range，正确返回 206/Content-Range；无效或多个范围返回 416；不把部分内容写入完整实体缓存。

撤下后拒绝新网络读取的内部验收目标为 60 秒内，包含最长 30 秒状态缓存与网络余量；这是目标，不是已测 SLA。已有 frame 的内存、浏览器离线副本、截图和用户下载无法收回。

## 8. MIME、安全头与 iframe 权限

MIME 来自平台认可的扩展/文件检查映射：HTML `text/html; charset=utf-8`、JS `text/javascript`、WASM `application/wasm`、JSON `application/json`，图片/字体/音视频正确映射；允许的引擎二进制使用 `application/octet-stream`。未知可执行类型拒绝发布，任何作者自带响应头均忽略。

首版不接收需要服务器还原 Content-Encoding 的预压缩 `.br/.gz` 导出，要求未预压缩构建；以后支持时另立按实体编码的哈希和头策略，不靠猜测文件后缀。

所有运行响应设置 `X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`；HTML 还要有平台生成的 CSP 和 Permissions-Policy。下面是默认模板，实施时将折行合并为一个有效 HTTP 头，并以实际嵌入链测试：

```text
Content-Security-Policy:
  default-src 'none';
  script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:;
  media-src 'self' blob:;
  font-src 'self' data:;
  connect-src 'self';
  worker-src 'none';
  frame-src 'none';
  object-src 'none';
  base-uri 'none';
  form-action 'none';
  sandbox allow-scripts allow-same-origin;
```

`unsafe-inline` 为接受单 HTML 小游戏的兼容选择，只用于隔离运行域；不允许普通 JS unsafe-eval。WASM 编译是否被目标 Chromium 正确允许要实测。`worker-src 'none'` 阻止本策略下创建 Worker/Service Worker，不提供离线安装；运行域不可复用任何旧的不受限部署。

TD-1.1 的公开免费游戏响应不设置 frame-ancestors 或 X-Frame-Options，以接纳实际桌面 Webview 的完整祖先链；不靠父站来源授予权限。业务账户页面仍限制嵌入，游戏的 sandbox、独立域、子资源 CSP 与游戏通道限制保留。frame-ancestors 会检查全部祖先，不能只核对最内层 iframe 的 URL；三宿主都要实测。[MDN frame-ancestors](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors)

iframe 固定 `sandbox="allow-scripts allow-same-origin"`、`referrerpolicy="no-referrer"`。默认无 forms、popups、downloads、top-navigation 和原生桥。批准 pointerLock 时 iframe 与 HTTP sandbox 同时添加 `allow-pointer-lock`；不靠 manifest 直接授权。fullscreen 经 Permissions-Policy 和 iframe allow 按批准能力委派，用户操作触发。

Permissions-Policy 默认拒绝 camera、microphone、geolocation、usb、serial、hid、payment、display-capture 和 clipboard 权限；fullscreen 只为相应游戏开放。必须测试宿主上层策略，子 frame 无法扩大父层禁止的权限。

业务网站另用可信代码的严格 CSP，不使用这份允许内联作者脚本的模板。插件自身受宿主 CSP 限制，不能自动修改宿主全局安全策略。

这些措施降低脚本、资源请求和导航风险，不承诺绝对无网络或不会自导航。运行域没有凭据，作者 API 另行鉴权；SDK 采用 15/18 的精确游戏 origin 握手和专属端口。用户代码异常导航不得获得宿主权限，父层超时或发现异常后释放。

## 9. 清理、保留与可恢复性

- receiving 过期、连接丢失和失败上传：中止未完成 multipart；隔离对象进入清理队列。存储生命周期规则作为遗漏清理的兜底。
- 原始已处理 ZIP 默认保留 7 天供故障排查，之后删除；私有草稿没有公开入口，保存其验证后资产以备作者发布。
- 每件作品的每个目标保留 3 个常规版本。超过时选择同目标非当前最旧版，至少 24 小时后转 revoked，再清理；待清理资产仍计入作者总配额。不能保证超出保留期的旧游戏继续动态加载。
- 未被数据库引用的 attempt 产物保留至少 24 小时，确认没有有效任务租约后清理；GC 不能只按对象创建时间删除。
- 撤下先改数据库再清理，不以“删文件完成”作为生效条件。重新发布和恢复只能由明确的作者/管理操作发生。
- 所有清理记录目标、原因、字节和结果，任务可重试。审计不记录作品正文、游戏输入或完整 session Cookie。

## 10. 开放投稿前的强制验证样本

至少包括：路径穿越/UNC/链接/重复路径/解压炸弹/损坏 ZIP、大小谎报、中途断连、并发超额、复核包；跨作者修改、草稿猜地址、直接桶访问；禁用后缓存命中、API 故障时不继续放行；恶意 postMessage、请求宿主端口/平台写接口、顶层跳转、摄像头和 Worker 注册；WASM MIME、模型/音频 Range 与缺失文件。

静态包检查、执行隔离、账号授权和浏览器策略分别验收，不用一次“安全扫描通过”替代它们。完整测试编号和交付记录见 17。
