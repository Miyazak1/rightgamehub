# GitHub 材料日期与来源归档的兼容修复

分支 `codex/fix-github-source-archive-date` 基于 `bb585044`，包含前一轮公开预检契约修复。仅修复 GitHub 来源归档边界的日期表示，不更改共享来源校验、论文流程、数据库结构或线上计划。

## 线上记录所证实的停更过程

2026-11-16 用户提供的宝塔只读输出显示：10 月 28、29 日公开计划成功，10 月 30、31 日失败；两次均在 `blog.project.single@2` 的 `collect-evidence` 阶段报 `AGENT_SOURCE_ARCHIVE_INVALID`。后续成稿与发布阶段的 `AGENT_RUN_TERMINATED` 是同一 Run 中止的结果。10 月 31 日北京时间 10:00:21 左右，累计两次失败使计划被暂停，`enabled=false`、`next_fire_at=NULL`。11 月 16 日进程仍在运行、有心跳，但启动保持既有暂停状态。

线上同时登记了有效的 `blog.project.single@1` 和 `@2`，因此之前发现的预检版本不一致是独立缺陷，不是这两次生产失败的直接错误。现有输出确认了归档失败与暂停的因果链，尚未展示那两次原始材料的具体字段值。

## 已复现并修复的日期缺陷

GitHub 材料工具接受并保留秒精度 UTC 字符串，例如 `2026-10-29T09:00:00Z`。归档构造器原样把 `metadata.pushedAt` 放入 `version.publishedAt`，但共享归档校验要求与 `Date.toISOString()` 完全一致的标准表示。相同时间的 `…00Z` 被拒绝，而 `…00.000Z` 被接受，错误与线上相同。

只在 GitHub 归档边界把完整秒精度 UTC 日期补为 `.000Z`。不解析或修复其他格式；无效日期仍由原有严格校验拒绝。不修改上游材料、原始元数据、引用定位或内容哈希。已有毫秒日期与空日期保持不变，论文及其他来源仍使用原校验。旧测试夹具一直使用带毫秒的日期，未覆盖这一接口交界。

回归覆盖新旧 GitHub 证据格式、原始数据与哈希不变、已有日期表示、无效日期与哈希拒绝，以及真实 REST 适配器形状到归档构造器的完整本地链路；不访问 GitHub、不调用模型、不发布文章。

2026-11-16 验证：新增四项回归在修复前两项稳定报 `AGENT_SOURCE_ARCHIVE_INVALID`，修复后四项全部通过；来源归档及 GitHub 材料相关定向回归共九项通过。全仓库 361 个文件实际运行结果为 1595 项通过、1 项失败、1 项超时取消、80 项依赖条件跳过。未通过项为发现页和平台 Agent 网页用例的本地加载/执行超时，独立复测仍未通过，不能认定整轮通过。保留完整记录于 `.runtime/agent-blog-archive-date/` 和 `.runtime/agent-blog-audit/archive-date-*.tap`。未修改这两个页面或其测试的断言、超时条件，也未因本次修复部署或恢复生产计划。

## 可选的生产原始字段只读确认

在现有宝塔终端执行下列命令，只查看失败 Run 中已保存材料的时间字段，不读取正文、模型输入或密钥，不更新源码或数据库。可用于进一步确认两次生产失败的具体日期值。

```bash
docker exec -i gamehub-production-postgres-1 psql -X -v ON_ERROR_STOP=1 -U gamehub -d gamehub <<'SQL'
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
SET LOCAL TIME ZONE 'Asia/Shanghai';
SELECT r.created_at,r.workflow_version,
  artifact.content_json->>'schemaVersion' AS artifact_schema,
  artifact.content_json#>>'{metadata,pushedAt}' AS raw_pushed_at,
  artifact.content_json#>>'{sourceVersion,fetchedAt}' AS raw_fetched_at
FROM agent_tool_artifacts artifact
JOIN agent_run_actions action ON action.id=artifact.action_id
JOIN agent_runs r ON r.id=action.run_id
WHERE r.workflow_key='blog.project.single' AND r.status='failed'
  AND r.created_at>='2026-10-30T00:00:00+08:00'
  AND r.created_at<'2026-11-01T00:00:00+08:00'
ORDER BY r.created_at DESC,artifact.id LIMIT 10;
COMMIT;
SQL
```

代码修复不会清除失败记录、重新派发 Run 或恢复暂停的公开计划。生产修复部署后仍须核实预检和既有运行状态，再单独恢复计划。论文保持关闭。
