# G2 受控静态站 Builder

状态：安全底座已实现；GitHub 构建队列、作者 UI 和生产启用尚未完成

更新日期：2026-10-01

## 1. 当前里程碑

G2 的首个实现只处理“不需要依赖安装、不执行仓库脚本”的静态站。输入必须是固定 Commit 对应的 GitHub 仓库归档，输出是标准 Web ZIP，之后仍必须进入现有 Validator、Release 和 Runtime Edge。

```text
固定 Commit 归档
-> static-v1 固定方案
-> 无网络隔离 Builder
-> 不可变 Web ZIP + SHA-256
-> 现有 Validator（下一里程碑接线）
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
- Vite + 锁文件只识别为 `planned`，尚不执行依赖安装。

## 2. 安全边界

Builder 不应拥有数据库、Redis、对象存储、GitHub App 私钥、部署凭据或 Docker Socket。控制层负责取得固定 Commit 归档并通过受限信箱交付；Builder 服务必须使用非 root、只读根文件系统、临时目录、全部 capability 丢弃、`no-new-privileges` 和 `network_mode: none`。

在依赖代理、网络出口策略和构建镜像摘要固定前，不开放 Vite/React/Vue 的脚本执行。作者不能提交自定义 shell、Dockerfile、GitHub Actions 或安装命令。

## 3. 后续接线

1. 增加 `source_revisions`、`build_jobs` 与 `release_provenance` 迁移。
2. 将已实现的独立信箱与 Builder 镜像接入生产 Compose 的无网络服务。
3. Builder 产物作为内部上传进入现有 Validator，失败构建不得产生 Release。
4. 增加作者构建列表、状态、日志摘要、预览和手动发布 UI。
5. 完成 G1 真实 GitHub App 验收、备份恢复和资源告警后才允许生产启用。
