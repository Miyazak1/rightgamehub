# 小墨鱼 R1.2 多源研究与论文证据基座

版本：v1.0
日期：2026-10-27
状态：第一阶段已实现并完成本地生产级验收，等待提交与生产部署；不代表论文自动写作或自动发布已经开放

## 1. 阶段目标

R1.2 不为论文另造调度器、模型网关、预算账本或证据数据库。它把 GitHub 仓库和开放论文映射到统一的 `ResearchSourceArchive v1`，并在现有 Run/Stage/Action、Tool Gateway、Policy、预算和 `tool_research_*` 账本上增加论文身份、版本与版面扩展。

本阶段交付的是“可取得、可冻结、可定位、可审计”的论文证据入口，不是摘要机器人：

- GitHub 与论文都归一为来源、不可变版本和有界 EvidenceSpan；
- 首个生产来源固定为 arXiv 开放 PDF；
- 论文只进入私有研究能力，不进入当前选题竞争和公开发布工作流；
- 没有可靠文字层、超过资源上限、来源异常或权限不明时失败关闭；
- 单服务器、每天 10:00 的现有公开计划保持不变。

## 2. 统一来源合同

`research.source.archive@1` 包含：

- `artifactKind`：`github.repository | paper | web.page | user.file`；
- `source`：规范 HTTPS 地址、来源类型、发布者、权威等级；
- `version`：取得时间、发布时间、内容哈希、定位器、内容类型；
- `evidence`：角色、证据类型、定位器、最多 2000 字的原文、哈希和允许用途；
- `extension`：论文身份/版本/版面等领域扩展。

适配器只能产出这个合同。证据文本和哈希不一致、额外字段、非 HTTPS 来源、超限对象都会被拒绝。

## 3. arXiv 最小生产路径

工具：`research.paper.arxiv.read@1`
能力：`research.paper.read@1`，L1，只读
输入：现代或旧式 arXiv 标识，或 `https://arxiv.org/abs|pdf/...` 规范链接

确定性限制：

| 项目 | 上限/策略 |
| --- | --- |
| 网络来源 | 仅 `export.arxiv.org` 元数据与 `arxiv.org` PDF |
| 请求数 | 每次恰好不超过 2 次 |
| 重定向 | 禁止 |
| 元数据 | 256 KiB |
| PDF | 20 MiB |
| 页数 | 80 页 |
| 抽取文字 | 160,000 字符 |
| 单证据片段 | 1,800 字符 |
| 正文证据 | 最多 96 条 |
| 解析器 | `pdfjs-dist@6.4.299`，禁用 PDF JavaScript 求值 |
| 退避 | 429/503 尊重 `Retry-After`，上限 3600 秒 |

自动客户端必须配置 `AGENT_ARXIV_CONTACT_EMAIL`。未配置时，现有博客流程继续运行，但论文适配器不会装入私有运行时；这避免用虚构联系方式访问上游。

当前解析粒度是页级文字层和页内有界文本块。它保留页码、PDF 哈希、解析器版本和块顺序，但尚不声称具备双栏重排、表格单元格、公式、图片、OCR 或精确段落坐标能力。

## 4. 数据与证据模型

迁移 `0145_agent_paper_research_extensions.sql` 增加：

- `agent_paper_identities`：账号隔离的规范论文身份；
- `agent_paper_versions`：论文版本与现有 `tool_research_source_versions` 一对一绑定；
- `agent_paper_layout_manifests`：解析器版本、页数和版面清单。

它不增加新的证据表。元数据和正文片段仍进入：

```text
agent_tool_artifacts
  → agent_research_artifact_bindings
  → tool_research_source_versions
  → tool_research_evidence
  → agent_research_evidence_bindings
```

论文扩展记录、来源版本和证据绑定均不可修改；新版本只能追加。相同工具产物重复归档返回原绑定，不重复写入。

## 5. 安全和失败关闭

- XML 明确拒绝 DTD 和实体声明，不解析外部实体；
- 标题、摘要和 PDF 正文始终视为数据，里面的链接或命令不会触发请求；
- URL 由服务端根据规范 arXiv 标识构造，不使用论文内容中的外链；
- PDF 无文字层时返回 `AGENT_ARXIV_PDF_TEXT_EMPTY`，本阶段不静默 OCR；
- PDF 体积、页数或文字超限时拒绝，不截断后假装完整；
- 取得成功不授权生成文章，解析成功也不授权公开发布；
- 论文身份和证据按 Agent 账号隔离，不跨账号静默复用。

## 6. 运维与启用

1. 在服务器私密环境配置受监控联系人：

   `AGENT_ARXIV_CONTACT_EMAIL=research-ops@example.com`

2. 执行常规备份、迁移和部署；迁移会为现有及未来 `blog:auto-publish` Agent 增加只读 `research.paper.read` 授权。
3. 运行私有基座 bootstrap，登记 `research.paper.arxiv.read@1`。
4. 使用私有研究工作流调用工具并归档；当前没有论文公开调度器，也不应手动把该工具插入公开发布动作。
5. 观察错误代码、退避时间、工具用量、来源版本和证据数量。

## 7. 验收标准

- 真实 `pdfjs-dist` 能从 PDF 文字层生成页码证据；
- 只发生两个固定域名请求，重定向和提示注入测试失败关闭；
- 一次性 PostgreSQL 17 完成 145 个迁移；
- 工具调用、论文身份、版本、版面、EvidenceSpan 在一个事务链中写入；
- 重放幂等，不可变触发器拒绝更新；
- 数据库验收确认没有产生 `blog_articles`；
- 本阶段定向回归、真实数据库、生产构建、Compose 配置和密钥作用域检查通过后才可提交；仓库既有红项必须单独记录，不能冒充本阶段回归。

### 7.1 2026-10-27 验收记录

- 论文/统一来源/编辑记忆/选题门禁/迁移/密钥作用域定向测试：37/37；
- 一次性 PostgreSQL 17：12 个套件、86/86，145 个迁移完整执行；
- Web 生产构建：1659 个模块完成；
- 私有与公共运行相关的 8 个 Compose Profile：配置展开通过；
- API 生产镜像：冻结锁文件安装通过，并在无网络、只读容器中从真实 API 入口加载论文适配器；
- `git diff --check`：无空白错误，仅有工作区既有换行提示。

仓库级平台套件仍存在与本阶段无关的既有问题：官方能力元数据缺少 `change-radar` 前端映射、课程包 CRLF/LF 字节不一致、课程复核包陈旧，以及受限沙箱内的本地 Socket/临时目录权限用例。它们未经过论文适配器、论文迁移或证据归档路径，不作为 R1.2 通过项，也没有在本阶段被静默修改。

## 8. 明确未完成

- DOI/Crossref 身份补全；
- 用户 PDF 权限和保留期；
- OCR、双栏阅读顺序、表格、公式、图像和精确坐标；
- 多轮方法/实验/限制阅读；
- 数字与单位确定性校验；
- 论文导读、本文内追问、比较和公开发布门禁；
- 真实开放论文评测集与质量阈值。

下一阶段应先做 R1.3 论文样本评测和复杂版面可靠性，不应直接打开自动发布。
