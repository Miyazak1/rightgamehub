# 桌面隔离服务：论文导入与阅读

本覆盖文件只用于独立的 `mooyu-desktop-business-test` 测试项目。它复用原有账号会话、独立 PostgreSQL/Redis、PDF 解析器和研究运行时，不连接正式 API/数据库，不注册模型或发布能力。当前源码未部署。

## 显式启用与边界

在原 `compose.desktop-business-test.yml` 后合并 `compose.desktop-paper-study-test.yml`；远程 HTTPS 测试还需保留原 `compose.desktop-business-remote.yml`。不合并论文覆盖文件时，原测试服务的行为和白名单保持不变。

覆盖文件提供三个步骤：原测试迁移/内容种子完成后，`business-paper-prepare` 在经过身份核对的测试库里幂等准备一个无登录凭据的内部操作账号及专用 Agent；`business-paper-worker` 复用研究运行时，仅处理本地 PDF 解析；`business-api` 在 worker 就绪后开放鉴权后的导入和读取。论文所有者仍是原有登录用户，执行 Agent 不是用户账号。准备操作不能从 HTTP 调用。

配置必须通过原隔离服务校验：数据库主机固定 `business-postgres`，用户名与库名固定 `desktop_business_test`，Redis 固定 `business-redis`；准备和执行阶段再次核对实际数据库身份及内容种子标记。不能把正式连接串传给这些入口。

新增开关为 `DESKTOP_BUSINESS_TEST_PAPER_ENABLED=true`，只在覆盖文件内开启。真实模型与发布开关强制为 `false`，传入启用值会被拒绝；模型密钥不会进入新配置对象。论文 worker 和准备容器不持有 GitHub OAuth 凭据，仅接入内部网络，不映射端口，也不接入 API 的出口或网关网络。

HTTP 白名单只新增：

- `POST /v1/me/paper-studies`：导入本人 PDF，既有 20 MiB/80 页、库配额和 Redis 限流继续生效。
- `GET/HEAD /v1/me/paper-studies`：读取本人列表。
- `GET/HEAD /v1/me/paper-studies/:id` 和 `/:id/source`：读取本人文档和原文。

所有路径继续使用原 Bearer 鉴权；匿名返回 401，其他账号不可读。`analyze`、`draft`、`publish`、文档修改/删除、通用上传和管理接口不在白名单内，返回真实 404。接口不自动创建研究分析或文章。

## 重启与就绪

文档、任务和解析检查点保存在测试 PostgreSQL。worker 使用固定 `desktop-paper-study-worker` 身份，保留既有租约、幂等和重启等待机制。异常退出后不会夺取仍存活实例的登记；等待有 5 分钟上限。

worker 健康检查使用容器内仅包含实例 ID 的临时标记，核对数据库中相同实例的近期心跳，避免上个进程的残留心跳冒充新进程就绪。API 的测试就绪响应额外返回 `paperStudy.enabled/ready`。`backgroundTasksEnabled=false` 仍表示其它自动业务任务关闭；唯一新增后台进程为显式授权的 PDF 解析 worker。

## 本地隔离验证

需要本机 Docker Desktop、已有测试镜像和本地公开 PDF 样本 `.runtime/paper-layout-audit/1706.03762v7.pdf`。不读取真实模型凭据，不连接外部 GitHub 授权或生产地址。

```powershell
node scripts/verify-paper-study-clean.mjs
node scripts/verify-desktop-business-instance.mjs --paper --keep
node scripts/verify-desktop-business-database.mjs
node scripts/stop-desktop-business-test.mjs
node scripts/verify-desktop-business-remote.mjs --paper
```

第一组 Compose 验证独立数据库迁移、账号登录、并发导入去重、真实 PDF 解析和读取、API/worker/Redis 重启、以及数据库中零 provider 调用/动作/生成内容。窗口验证通过原桌面账号桥接导入同一 PDF、实际渲染与翻页、禁用生成按钮、刷新和完整进程重启恢复、退出清理。`--keep` 仅供窗口验收，结束必须清理。

验证脚本为临时 PostgreSQL 使用仅本轮生效的 tmpfs 覆盖，保留 fsync，避免 Docker Desktop VHD 大量 DDL 提交造成超时；部署 Compose 的 PostgreSQL 仍使用命名数据卷。验证会重启 API、论文 worker、Redis 和桌面进程，不重启临时 PostgreSQL 容器，不将该测试宣称为数据库容器断电持久性验证。Redis 继续使用临时项目的命名数据卷以核对重启保留。

最后一条只在本机环回地址通过 HTTPS 验证测试域名/SNI、真实证书验证、导入读取和跨账号拒绝；使用每轮临时证书，不更改系统信任、不绕过 TLS、不申请公网证书。报告与凭据只保存在忽略的 `.runtime`，临时项目和数据卷在结束后删除。

## 未来远程更新条件

必须先审查并提交本次隔离服务适配，再导出新的确定提交。此前服务器准备的 `2b4b7cc7` 仅含持久化基座，不能通过重建该版本直接获得本覆盖文件。

未来更新前应备份测试项目的配置、旧镜像及 PostgreSQL/Redis/本地资源数据；沿用原测试数据库口令和 OTP key，不重新生成。仅向测试数据库应用迁移并运行专用准备任务，再更新测试 API 与论文解析 worker。既有 Caddy 已指向业务测试 API 时无需修改正式网关。保留关闭论文覆盖文件的配置回滚与数据库备份，不通过删除测试卷进行回滚。不更新正式 API、正式论文 worker、正式数据库或安装包。

## 2026-11-03 验证记录

- 干净目录 `check-w2cZnY`：246 项中 240 通过、6 项数据库测试按离线规则跳过，构建通过。
- 真实 HTTP/独立 PostgreSQL 与 Redis `persistence-877251e044ea4e0c9a774296cfa4d8f5`：9 项通过，覆盖并发去重、未完成上传提前拒绝、完整 PDF 读回、同 worker ID 崩溃检查点恢复、Redis 重启、账号隔离和关闭模型/发布；临时容器已清理。
- 完整业务隔离项目 `mooyu-business-check-1793700816850`：9 组检查通过，API、独立论文 worker、Redis 重启后原文与文档 ID 保留，provider 调用、执行动作、生成分析/草稿均为零。
- 本地 HTTPS 项目 `mooyu-business-remote-check-1793700522221`：10 组检查通过，涵盖 TLS/SNI、匿名及跨账号拒绝、原文完整读取、测试数据库完整备份恢复、Redis 数据保留、网关配置恢复、错误日志脱敏；项目与临时数据已清理。
- 实际 Electron 窗口 `electron-QPXXM6`：7 组检查通过，包含原平台目录/游戏、通过账号桥接导入真实 PDF、画布实际像素绘制、翻页、禁用生成、刷新、完整进程重启恢复及退出清理。第 2 页截图已人工查看，确实显示原文；不是仅检查画布存在。截图复用既有仅对 `UnknownVizError` 限定一次重试的助手。重载时旧 frame 的 IPC 仍被原有可信发送者检查拒绝，未放宽授权。

首次网络验收发现未认证的大上传提前拒绝后可能留下半读连接，后续请求无法正常复用；论文导入的早期鉴权拒绝和回环代理现会关闭不完整连接。回归分别用原始 HTTP 检查慢速未完成请求的 401/关闭行为，用正常请求检查完整 PDF 和后续读取；不会靠重试生成或放宽鉴权通过。

更早的 VHD 大量 DDL/恢复超时、脚本固定迁移数量、游戏脚本尚未初始化即点击、截图合成器失败及只检查画布尺寸的失败记录均保留在忽略目录；修正的是验收等待/诊断和上述连接处理，没有改写 PDF、生成内容或模型输出。没有真实模型调用、真实 GitHub 授权、生产连接、提交、推送或部署。

后续审查补齐了代理本地生成 503/超时的半读连接处理：所有提前错误响应现在使用同一规则，未读完的上传关闭连接；完整请求仍可复用连接。新增“上游不可达后恢复”“超时后继续读取”“完整请求遇到 503 后复用”三项回归；21 项定向测试及 Linux 镜像内 6 项代理检查通过。本轮独立 PostgreSQL/Redis 9 项、完整隔离服务 9 组重跑通过；干净目录更新为 249 项中 243 通过、6 DB 跳过及构建通过。默认 20 秒超时、鉴权、模型/发布关闭策略均不变。窗口与 Caddy 无变更，保留上述已通过的记录。
