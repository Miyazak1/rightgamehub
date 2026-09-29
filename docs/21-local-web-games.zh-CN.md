# 本机网页 ZIP 上传与右栏游玩

日期：2026-09-24。当前范围为 Harness 本机试运行；正式线上规范仍以 [16 上传运行隔离](./16-publishing-runtime-spec.zh-CN.md) 为准。

## 使用与验收目标

上传网页 ZIP → 自动检查 → 生成名称与默认封面 → 点击“开始游戏” → Harness 右栏游玩。刷新或重启后仍可找到游戏；支持结束、重新开始和全屏。EXE 和普通下载 ZIP 的原始分发能力继续保留。

ZIP 根目录必须包含 `index.html`；相对路径资源须全部打包。当前拒绝依赖网络 CDN、Worker、JS eval、服务器路由重写或 `.gz/.br` 预压缩资源的构建，不承诺所有游戏引擎导出兼容。此阶段没有云端目录、作者账户、持久存档或 EXE 播放器。

运行 `node scripts/build-web-samples.mjs` 生成 `artifacts/星星收集-web.zip` 和 `artifacts/旋转立方体-web.zip`。每包有 HTML、独立 JS 模块、CSS、JSON、SVG 和最小 WASM 文件，适合验证真实多文件链路。最小 WASM 编译通过不等于 Unity/Godot 大型导出验收。

## 实际数据流

1. 插件可信 UI 经 Harness 已认证 `/api/gamehub/upload` 上传原始文件，按原流程保存 SHA-256 和大小。
2. ZIP 调用固定解析程序；读取文件内容但不执行、导入或安装作者代码。输入超过网页上限或检查失败时，只保留原始下载与错误原因。
3. 解析到新建的随机 `.partial` 目录；逐文件实际字节计数、CRC 与 SHA-256 校验。完整成功后原子更名为 `web/<uploadId>`，再提交同一上传记录。只有已提交、当前策略版本、状态 ready 的记录能取得运行会话。
4. `POST /api/gamehub/launch?id=...` 创建短期能力 URL；前端使用 opaque sandbox iframe 加载资源。资源不经过 Harness 业务源，也不复用 Harness Cookie。
5. 结束、换游戏、关闭、隐藏或卸载时移除 iframe，并调用已认证 `/api/gamehub/stop` 撤销后续资源读取。断连或浏览器异常退出的残留会话最长 2 小时失效；每资源服务最多 16 局。

文件清单只存宿主元数据，不返回到游戏目录 API；资源请求必须精确命中清单。资源 GET/HEAD 支持单 Range，路径只解码一次，不做 index.html 兜底；路径越界、非法 Host、其他 Origin、写请求、过期能力和未列出的文件被拒绝。

## 边界与配额

| 项目 | 实现 |
| --- | --- |
| 网页 ZIP / 单资源 / 总展开量 | 100 MiB / 100 MiB / 300 MiB |
| ZIP 条目 / 路径深度 | 5000 / 16 |
| 路径规则 | 无穿越、盘符、反斜杠、链接、Windows 设备名、大小写/NFC 歧义或 URL 歧义字符 |
| 格式 | STORE/DEFLATE，拒绝加密与特殊文件；不执行嵌套包或安装器 |
| 本机总量 | 原始文件 + 已提交展开资源共同计入 2 GiB；最多 50 次上传记录 |
| 解析进程 | 固定 Node 程序，192 MiB V8 堆，120 秒时限，最小环境变量，受限输出目录 |
| 游戏源 | `127.0.0.2` 随机端口，只绑定环回，与 Harness 的主机不同 |
| 权限 | iframe + CSP sandbox，仅 allow-scripts；无 same-origin、宿主消息桥、Worker、表单提交、外部联网或持久存储 |
| CORS | 不携带凭据，只用于 opaque iframe 加载模块、WASM、字体、fetch 资源 |
| 封面 | 可信 UI 生成默认封面，不在 Harness 源渲染作者 HTML/SVG |

这些措施不代替公开平台的扫描、OS 容器、网络隔离、作品 ACL、配额事务与垃圾回收。CSP 限制资源和 fetch 目的地，但不保证阻断作者页面的所有自导航，因此不宣称绝对无网络。强制终止可能留有未提交文件；单存储目录只允许一个服务写入。当前资源地址只适合浏览器与 Harness 同机，不能直接用于远程 Harness 或公网。Header 策略按实际实现记录，与正式独立域允许 same-origin 的存档方案有意分阶段实施。

## 代码与依赖

- [网页包策略](../extensions/harness/src/web-policy.mjs)、[解析子进程](../extensions/harness/src/zip-worker.mjs)、[检查协调](../extensions/harness/src/prepare-web-game.mjs)。
- [独立资源服务](../extensions/harness/src/game-runtime.mjs)、[上传与启动 API](../extensions/harness/src/transfer-service.mjs)、[右栏客户端](../extensions/harness/src/client.cjs)。
- ZIP 解析器使用本机官方 Harness 已安装的 `yauzl 3.4.0` 与 `pend 1.2.0`；打包在插件 vendor 中，运行时不依赖 Harness 内部路径或额外联网安装。保留 MIT 许可证、源文件哈希和可复现构建脚本 [vendor-zip-reader.mjs](../scripts/vendor-zip-reader.mjs)。
- [网页游戏测试](../tests/web-games.test.cjs) 覆盖上传持久化、资源 MIME/CSP/CORS、运行能力撤销、路径越界/Host、损坏或恶意结构 ZIP、配额、失效会话。[传输测试](../tests/harness-transfers.test.cjs) 继续覆盖原有下载和校验。

## 验收记录

最终包：`@gamehub/harness-plugin@0.0.6`，SHA-256 `92fc98d76c9fef0dea931d140b157e97faabf3e529ae20f31648e010501ea85b`，13 个发布文件，约 33 KB。通过官方插件管理器安装，未改动 Harness 源码。测试使用独立 `gamehub-transfer-check` profile、3082 端口和 `.runtime/m0/gamehub-web-check-storage`；没有与用户运行中的 3081 实例共写存储。

| 验收项 | 实际结果 |
| --- | --- |
| 2D ZIP 真上传 | 在文件选择器选择 `星星收集-web.zip`，点击上传，生成可玩卡片；3133 bytes，7 个资源，展开 4042 bytes |
| 上传后游玩 | 从生成的卡片开始，iframe 加载独立资源源；点击画布得分由 0 变为 1 |
| 多资源加载 | 独立 JS 模块、CSS、JSON、SVG 图片和最小 WASM 编译都完成；画面显示实际加载结果 |
| 隔离探针 | 运行游戏内实际访问 parent.document 与 localStorage 均受阻，页面显示隔离检查通过 |
| 重新开始 | 新建运行会话，得分恢复 0；没有继续使用旧游戏内存 |
| 全屏 | 点击后播放器铺满屏幕、可退出并回到右栏；以实际画面和可见控件验收 |
| 重启与升级 | 从内部 0.0.5 升级到 0.0.6、重启测试服务，原游戏卡片和资源仍存在，首次点击再次成功加载 |
| WebGL2 ZIP 真上传 | `旋转立方体-web.zip`，3498 bytes，7 个资源，展开 4868 bytes；从卡片在右栏运行，出现立方体，帧数从 1 增至 721，暂停按钮变为“继续旋转” |
| 结束与隐藏 | 结束按钮移除 iframe；收起右侧栏后重新打开保持已释放状态。旧 WebGL2 资源 URL 实际请求返回 404，运行能力已撤销 |
| 自动测试 | `npm test` 共 20 项通过，包含原有 13 项及新增 7 项网页上传/隔离/无效包测试，多个恶意输入作为各测试内用例 |

0.0.5 首次浏览器载入曾停顿；手动重新开始后可运行。0.0.6 将焦点与滚动位置移至播放器，并加入 12 秒后一次自动重建 iframe、再次超时明确提示。最终版本重启后的首次启动已实测成功，未将此前停顿隐去或把单次成功当作长期稳定性证明。

未完成：跨机器与远程宿主、VS Code/Cursor、持久存档、大型引擎导出、恶意软件扫描、30 分钟稳定性、音频采样和长期并发验收。现有结论只覆盖本机两个自有上传样本。

体验方法：关闭原 Harness 启动窗口中的服务，重新双击 `start-gamehub-m0.bat`；页头确认 `0.0.6`。选择上述任一 ZIP 上传，等待检查完成，然后点击卡片上的“开始游戏”。旧版本已上传的 ZIP 需要重新上传才能触发网页检查，原文件下载不受影响。
