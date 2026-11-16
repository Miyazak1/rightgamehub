# GitHub 文章公开工作流版本预检修复

分支：`codex/fix-blog-public-workflow-contract`，基线为已发布的 `cae18091074217809d6fe9c59e9edf94c49c452e`。本轮只改公开工作流预检及其回归测试，不变更数据库结构、发布权、计划开关、提供商配置或论文开关。

## 修复行为

公开 Bootstrap 与 GitHub 成稿执行器已使用 `blog.project.discovery-shadow@3` 和 `blog.project.single@2`，预检仍检查 `blog.project.single@1`。因此只有新版有效时会误报未准备好，而只有旧版有效时又可能错误放行。

预检改为直接引用执行器使用的两份 Manifest，将它们的 key/version 配对作为 PostgreSQL 参数传入。判定数量取同一清单长度，不再复制版本号；查询仍要求精确版本处于 active。旧版本可以保留，但不会替代所需版本，也不会增加计数。论文工作流不参与 GitHub 公开工作流数量计算。

真实 PostgreSQL 回归覆盖：新版登记、旧新版共存、旧版无法代替已退休的新版、旧版退休后新版仍有效，以及论文流程不能代替缺失的 GitHub 发现流程。所有验证均不创建业务 Run、不调用提供商、不生成文章。

2026-11-16 验证结果：全仓库 360 个测试文件，1593 项通过、0 失败、80 项依赖条件跳过；新增真实 PostgreSQL 回归另跑 6 项全部通过；公开运行、计划和运营接口定向回归 14 项全部通过。宝塔命令已通过 Bash 语法检查，SQL 在本轮临时 PostgreSQL 的只读事务中执行通过。临时数据库关闭磁盘同步以加速建表，本次不测试物理崩溃耐久性。测试报告保存在 `.runtime/agent-blog-audit/`；没有部署生产服务或恢复暂停的计划。

## 宝塔只读现场检查

以下命令可直接用于修复部署前的现有版本，不依赖本次新增文件。只读取提交、容器状态、调度日志和运行状态；SQL 显式使用只读事务，并限制单条查询时间。不读取 `.env.prod`、令牌、文章正文或模型输入。不运行 Bootstrap、恢复计划、触发文章或重启服务。

```bash
bash <<'BASH'
set -euo pipefail
cd /www/gamehub
git log -1 --oneline
docker ps -a --filter label=com.docker.compose.project=gamehub-production --format 'table {{.Names}}\t{{.Status}}'
for id in $(docker ps -aq --filter label=com.docker.compose.project=gamehub-production --filter label=com.docker.compose.service=agent-blog-public-scheduler); do
  docker logs --tail 100 "$id" 2>&1
done
MOOYU_PG=$(docker ps -q --filter label=com.docker.compose.project=gamehub-production --filter label=com.docker.compose.service=postgres)
test -n "$MOOYU_PG" || { echo '未找到运行中的生产 PostgreSQL 容器'; exit 1; }
docker exec -i "$MOOYU_PG" psql -X -v ON_ERROR_STOP=1 -U gamehub -d gamehub <<'SQL'
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
SET LOCAL TIME ZONE 'Asia/Shanghai';
SELECT now() AS checked_at;
SELECT workflow_key,workflow_version,status FROM agent_workflow_definitions
WHERE workflow_key IN ('blog.project.discovery-shadow','blog.project.single') ORDER BY workflow_key,workflow_version;
SELECT agent_user_id,enabled,next_fire_at,last_fire_at,
  config_json->>'mode' AS mode,config_json->>'consecutiveFailures' AS consecutive_failures,
  config_json->>'suspendedAt' AS suspended_at,config_json->>'suspensionReason' AS suspension_reason,
  config_json#>>'{worker,heartbeatAt}' AS heartbeat_at
FROM agent_schedules WHERE workflow_key='blog.project.discovery-shadow';
SELECT logical_fire_at,status,error_code FROM agent_schedule_fires
WHERE schedule_id IN (SELECT id FROM agent_schedules WHERE config_json->>'mode'='foundation-public')
ORDER BY logical_fire_at DESC LIMIT 10;
SELECT r.updated_at,r.workflow_key,r.workflow_version,r.status AS run_status,
  s.stage_key,s.status AS stage_status,s.error_code,s.available_at
FROM agent_runs r JOIN agent_run_stages s ON s.run_id=r.id
WHERE r.workflow_key IN ('blog.project.discovery-shadow','blog.project.single') AND s.error_code IS NOT NULL
ORDER BY r.updated_at DESC,s.ordinal DESC LIMIT 15;
COMMIT;
SQL
BASH
```

重点结合日志中的 `AGENT_BLOG_PUBLIC_RUNTIME_WORKFLOWS_NOT_READY`、`AGENT_WORKFLOW_NOT_ACTIVE` 与数据库的有效版本判断契约问题；通过 `suspendedAt`、`suspensionReason` 和最近 fire/stage 错误定位实际暂停原因。修复预检不会自动登记缺失合同、恢复暂停计划或重放失败 Run，必须先确认线上事实。
