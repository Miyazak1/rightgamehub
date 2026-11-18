# 发布激活后的容器识别与失败定位

生产日志确认：新镜像构建成功，迁移为 previous=161、total=161、applied=0，全部应用容器健康；随后 `deployed-images.txt` 已创建但为空，源码校验文件尚未创建。这将失败定位到首个服务的容器发现/镜像核验步骤，不能据此认定机器人工作流失败。

旧实现用当前 Compose 配置查询 `ps --status running --quiet SERVICE`，结果为空时由无提示的 `test -n` 退出。回归测试显式模拟“激活前可查询、激活后空结果”，验证该条件下旧查询确实为空，新发布流程仍能核对正确容器并完成。生产 Compose 为何返回空值仍不能仅凭这段日志确定；修复移除了这一依赖。

## 修复边界

- 通过 Docker Engine 项目标签盘点实际运行服务，再核对服务仍属于目标配置。仍然只更新当前运行的应用服务，排除 PostgreSQL、Redis 与一次性任务，不自动启动可选任务。
- 通过项目、服务标签解析容器，二次核验状态及标签身份。缺失、重复、身份变化及未知一次性标记均明确拒绝；不会任取一个容器继续。
- 镜像核验、源码哈希、数据库备份与 HTTP 验收使用已确认的容器 ID；不再依赖激活后 Compose 的 `ps` 或 `exec` 发现容器。
- 回滚前记录 phase/service/line/exit-code 和非敏感容器列表；保留原异常、数据库备份、旧镜像及恢复流程，不打印环境配置或开启 shell trace。
- 机器人 API、工作流、模型预算和网页内容相对于 `401d5086` 未改动；论文开关和线上配置仍保留。

## 验证

`release-container-discovery.test.cjs` 覆盖零容器、多副本、正常/缺失/未知 one-off 标签、实际 one-off、项目/服务身份变化及停止状态。

显式真实 Docker 测试使用唯一临时项目和 Redis 缓存镜像：通过新镜像覆盖层重建容器，核对新 ID 与镜像；加入活跃一次性容器后仍选择正常服务，加入第二正常副本后明确拒绝。容器不挂载业务目录，清理前核验专属标签及 tmpfs 挂载；只回收临时容器和测试标签。

- `.runtime/release-container-discovery-verified.tap`：6 项专项测试，0 失败、0 跳过，包含真实 Docker 与完整发布/回滚矩阵。
- `.runtime/release-container-discovery-final-full/`：372 个文件，1636 项通过、0 失败，95 项按环境跳过；真实 Docker 用例另行显式执行并通过，未将跳过计作通过。

继续使用固定提交提取 `deploy/update-blog-editorial-continuity.sh` 的更新方式。完整部署日志、退出码与服务日志保存到 `/www/backup/gamehub/update-editorial-*`；配置有本地修改或校验不通过时停止，不执行 reset/clean，不清除数据卷。
