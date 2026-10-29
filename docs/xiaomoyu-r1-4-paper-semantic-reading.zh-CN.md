# 小墨鱼 R1.4 单篇论文语义阅读基座

版本：v1.0
状态：实现完成，等待生产部署与真实开放论文运行验收
更新日期：2026-10-27

## 1. 阶段目标

R1.4 不是“让模型总结 PDF”，而是在既有 Agent Foundation 上增加一个私有、证据约束、失败关闭的单篇论文语义工作流。它复用 Run / Stage / Action、Provider Gateway、Policy、预算、租约、审计事件与研究证据账本，不创建第二套机器人运行时。

本阶段只承诺：

- 读取已经由 R1.3 判定为 `trusted-text` 的公开 arXiv 全文版本；
- 用确定性页窗重建可验证的输入结构；
- 明确区分作者主张、论文报告的实验结果、小墨鱼推断、未知与冲突；
- 把每个非未知结论绑定到冻结证据片段；
- 保存不可变、可审计、只读的私有语义分析；
- 为后续“只根据本文证据追问”冻结严格输出合同；
- 保持论文分析与博客公开发布完全隔离。

本阶段不承诺 OCR、复杂表格/公式语义、多论文比较、论文真伪判定、实验复现、私有文件外发或论文内容自动公开发布。

## 2. 不可突破的边界

只有同时满足以下条件的版本才允许进入模型调用：

1. `access_level = fulltext-open`；
2. 来源类型为 `pdf`；
3. 发布者为 `arXiv`；
4. 权威等级为 `official-primary`；
5. 版本 URL 属于 `https://arxiv.org/`；
6. R1.3 等级为 `trusted-text`；
7. 允许用途精确为 `analysis / citation / comparison`；
8. 证据数量为 1 到 96，且每条证据都有页码、冻结文本与摘要。

用户上传文件、私有论文、受限全文、元数据或摘要、`limited-text` 和 `blocked` 版本全部在 Provider 调用前失败关闭。本阶段没有“用户确认后例外发送”的旁路。

## 3. 五阶段工作流

工作流：`paper.single.semantic-shadow@1`

```text
verify-eligibility
  → reconstruct-sections
  → extract-semantics
  → verify-semantics
  → persist-analysis
```

### 3.1 verify-eligibility

重新读取论文身份、来源、访问等级、版面摘要、解析质量和证据清单。准入结果只保存摘要，不复制全文。

### 3.2 reconstruct-sections

按页码确定性建立最多 64 个页窗。页窗不是模型猜测的章节标题，也不冒充原论文目录。重建产物包含 `manifestSha256`，后续阶段必须重新计算并匹配。

### 3.3 extract-semantics

Provider 只收到公开 arXiv 的有界证据，单条文本最多 1200 字符。一次运行最多调用模型一次，要求严格 JSON Schema，低温度，不允许使用外部知识补全事实。

模型输出的结论类型：

- `author_claim`：作者明确提出或主张；
- `observed_result`：论文明确报告的实验或观测结果；
- `xiaomoyu_inference`：小墨鱼基于本文证据作出的解释；
- `unknown`：本文证据不足；
- `conflict`：本文不同证据之间存在冲突。

### 3.4 verify-semantics

确定性验证器检查：

- 页窗与输入完全一致；
- 证据编号存在且未越界；
- 非未知结论至少有一个 `supports`；
- 冲突结论同时包含 `supports` 与 `contradicts`；
- 未知结论不得伪造证据；
- 所有证据编号转换为冻结 EvidenceSpan UUID；
- 产物摘要、模型、提示词与策略版本全部写入证明。

### 3.5 persist-analysis

在 `research.paper.analyze@1`、L2 策略授权和有效租约下保存：

- `agent_paper_semantic_analyses`；
- `agent_paper_semantic_evidence_links`。

两张表只允许插入，不允许更新或删除。每次分析绑定 Run、Action、论文版本、模型、提示词版本、策略版本、证据清单摘要和分析摘要。工作流没有 `blog.article.publish` 能力，也不会创建博客文章。

## 4. 证据约束追问合同

`paper.semantic.follow-up-answer@1` 已冻结但尚未开放用户入口。回答必须包含：

- 明确的答案文本；
- 使用到的 finding key；
- 使用到的 EvidenceSpan 编号；
- `none / bounded / insufficient-evidence` 三种不确定性之一。

若为 `insufficient-evidence`，不得附带证据；其他答案至少引用一条本文证据。R1.5 接入交互入口时只能读取已冻结分析和原证据，不允许退回“凭模型记忆回答”。

## 5. 预算、权限与幂等

- 每个 Run：1 次 Provider、0 次工具、最多 60,000 输入 Token、7,000 输出 Token、1,200 秒；
- 所有 Provider 调用仍经过现有模型目录、密钥保险箱、月度预算、熔断器与用量账本；
- 行为人格、权限和模型配置在 Run 创建时冻结；
- Provider Action 使用 Run 级幂等键；
- 分析以论文版本 + 策略 + 提示词 + 模型形成版本边界；同一 Action 重放返回原记录，内容漂移失败关闭；
- 任何未知发送结果由通用 Runtime 进入 `uncertain`，不自动重发。

## 6. 单服务器运行

R1.4 不增加常驻容器。它复用同一台服务器上的 PostgreSQL、迁移、模型密钥和 API 镜像，通过显式 Compose profile 一次运行：

```bash
cd /www/gamehub/deploy

AGENT_PAPER_SEMANTIC_ENABLED=true \
AGENT_PAPER_SEMANTIC_AGENT_USER_ID='<小墨鱼 user UUID>' \
AGENT_PAPER_SEMANTIC_PAPER_VERSION_ID='<trusted-text 论文版本 UUID>' \
AGENT_PAPER_SEMANTIC_REQUEST_ID="$(cat /proc/sys/kernel/random/uuid)" \
docker compose --env-file .env.prod -f compose.prod.yml \
  --profile agent-paper-semantic-run run --rm agent-paper-semantic-run
```

运维要求：

- `AGENT_SECRET_ENCRYPTION_KEY` 必须与后台保存模型 Key 时使用的根密钥一致；
- `AGENT_PAPER_SEMANTIC_AGENT_USER_ID` 必须是小墨鱼真实 Agent 账号；
- 每次人工重试使用新的 request UUID；同一 request UUID 只用于同一论文版本的幂等回放；
- 命令输出只包含运行和分析 ID，不输出论文正文或模型密钥；
- profile 默认关闭，不影响每天 10:00 的公开博客调度器。

## 7. 后台观测

后台“论文阅读基座”卡片显示解析数量、可信文本、私有语义分析数、受限/阻断数和最新分析摘要。运行时间线显示五个阶段、模型与工具用量、错误代码以及结论节点/证据关系/局限数量。后台只读，不提供改写分析或绕过准入门禁的按钮。

## 8. 测试与验收

冻结评测集覆盖作者主张、实验结果、小墨鱼推断、未知和限制项。真实 PostgreSQL 集成测试验证：

- 一个公开、可信 arXiv 版本完成五阶段运行；
- 恰好一次 Provider 调用；
- 结论与证据 UUID 关系正确；
- 语义分析和关系表不可修改；
- 不产生博客文章；
- 受限全文在 Provider 调用前被拒绝。

发布前还必须通过全量 Agent 单测、真实 PostgreSQL 套件、Web 生产构建、API 生产镜像、Compose 配置渲染和 `git diff --check`。

## 9. 下一阶段

R1.5 优先实现私有、本文内追问：读取现有分析与 EvidenceSpan，生成严格证据约束回答并保存问答审计。之后才进入多论文可比性门禁与比较；论文导读公开发布仍需独立产品、版权和发布策略评审，不能沿用博客项目发布权自动开启。
