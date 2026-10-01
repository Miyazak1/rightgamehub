# G2 受控静态站 Builder

状态：代码闭环完成，默认关闭；待生产迁移、镜像摘要固定和真实仓库验收

更新日期：2026-10-01

## 1. 当前里程碑

G2 的首个实现只处理“不需要依赖安装、不执行仓库脚本”的静态站。输入必须是固定 Commit 对应的 GitHub 仓库归档，输出是标准 Web ZIP，之后仍必须进入现有 Validator、Release 和 Runtime Edge。

```text
固定 Commit 归档
-> static-v1 固定方案
-> 无网络隔离 Builder
-> 不可变 Web ZIP + SHA-256
-> 现有 Validator
-> 作者确认发布
```

已实现：

- `static-v1` 固定构建方案及规范化配置摘要。
- GitHub 归档单根目录校验、路径逃逸/特殊文件/加密/异常压缩拒绝。
- 与现有 Web Validator 对齐的文件数、单文件、展开大小和产物大小上限。
- 不执行 `package.json`、Vite 配置或任意作者命令；检测到构建描述即拒绝错误方案。
- 只输出当前 Runtime Edge 支持的静态文件类型；README、许可证与 Git 元数据不进入运行产物。
- ZIP CRC、大小和 SHA-256 来源证明；确定性文件排序。
- 原子请求/响应信箱、请求过期、租约心跳、取消信号和输出摘要复核。
- 独立非 root Builder 镜像；镜像不包含 API 服务、数据库客户端配置或部署凭据。
- `source_revisions`、`build_jobs` 和 `release_provenance` 记录固定源码、规范化配置、构建镜像与最终产物摘要。
- 后台 Source Worker 下载固定 commit 归档、续租、检查存储容量，并把产物作为内部上传交给现有 Validator。
- 作者 API 和 UI 支持发起构建、查看状态、失败码与历史，并在校验完成后明确发布。
- 生产 Compose 将 Builder 设为无网络、只读根文件系统、非 root、丢弃全部 capability，限制为 2 CPU、2 GiB 和 128 个进程。
- Vite + 锁文件只识别为 `planned`，尚不执行依赖安装。

## 2. 安全边界

Builder 不应拥有数据库、Redis、对象存储、GitHub App 私钥、部署凭据或 Docker Socket。控制层负责取得固定 Commit 归档并通过受限信箱交付；Builder 服务必须使用非 root、只读根文件系统、临时目录、全部 capability 丢弃、`no-new-privileges` 和 `network_mode: none`。

在依赖代理、网络出口策略和构建镜像摘要固定前，不开放 Vite/React/Vue 的脚本执行。作者不能提交自定义 shell、Dockerfile、GitHub Actions 或安装命令。

## 3. API 与状态

- `POST /v1/creator/works/{workId}/builds`：按 `Idempotency-Key` 创建 `static-v1` 构建。
- `GET /v1/creator/works/{workId}/builds`：读取最近 50 次构建。
- `GET /v1/creator/works/{workId}/builds/{buildId}`：读取单次状态。
- `POST /v1/creator/works/{workId}/builds/{buildId}/publish`：仅发布已校验、未过时且许可证已识别的版本。

状态依次为 `queued -> preparing -> building -> packaging -> validating -> ready`；失败进入 `failed`，来源出现新 commit 后旧的未完成构建进入 `superseded`。

## 4. 生产启用

功能默认关闭。启用时至少需要：

```dotenv
GITHUB_SOURCE_IMPORT_ENABLED=true
SOURCE_BUILD_ENABLED=true
SOURCE_BUILDER_EXECUTION_MODE=isolated
SOURCE_BUILDER_IMAGE_DIGEST=sha256:<已部署镜像的 64 位摘要>
```

生产配置拒绝未固定的 Builder 镜像摘要，也拒绝 `local` 执行模式。Worker 领取任务时会再次比较任务记录与当前部署摘要；镜像变化后的旧排队任务会失败，新任务使用新摘要重新排队，避免来源证明记录错误镜像。

## 5. 上线前验收

1. 在测试数据库执行迁移 `0036_github_source_builds.sql` 与 `0037_source_build_image_identity.sql`，并验证回滚/恢复方案。
2. 构建并部署 Builder 镜像，把实际镜像摘要写入 `SOURCE_BUILDER_IMAGE_DIGEST`。
3. 用公开和私有仓库各验证一次固定 commit 下载、静态子目录、失败重试与连接撤销。
4. 验证恶意 ZIP、`package.json`、符号链接、超限文件和缺失入口均不会产生 Release。
5. 验证许可证未识别、源码已更新和校验失败的构建均不能发布。
6. 完成容量告警、备份恢复与失败任务运维演练后再设置 `SOURCE_BUILD_ENABLED=true`。
