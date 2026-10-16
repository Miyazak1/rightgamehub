# 中国普通高中知识地图、场景组合与互动课件覆盖方案

状态：K0/K1 已落地；数学、物理、化学首轮原子图谱、课标来源核对与首套教材映射已完成；具名学科专家审校与 C4/C5 浏览器实测待完成
版本：K0.6
日期：2026-10-15
关联文档：[74 Agent 原生互动课件插件平台](./74-agent-native-interactive-courseware-platform.zh-CN.md)、[75 交互课件托管与外部嵌入](./75-courseware-embed-service-roadmap.zh-CN.md)、[77 好奇心驱动的情境化互动课件架构](./77-curiosity-driven-scenario-courseware-architecture.zh-CN.md)

## 1. 决策

墨鱼工坊先建立中国普通高中完整知识地图，再以知识地图指导 Domain Pack、Instrument 和互动课件开发。这里的“先”表示先冻结范围、层级、关系和覆盖口径，不表示必须等所有学科的每个原子节点都人工复核完，才能开始任何运行时开发。

采用两条并行但有门禁的工作流：

```text
课程标准与知识地图 K 轨
  K0 权威来源与 Schema
  K1 全学科顶层目录
  K2 学科原子知识图谱
  K3 误区、表征、实验与评价
  K4 持续审校和版本迁移

结构化课件运行时 R 轨
  Runtime Kernel
  Domain Pack
  Instrument
  Courseware
  Release / Embed
```

Runtime Kernel 可以与 K0、K1 并行，因为状态、时间轴、语言、主题和嵌入协议是通用基础；但某个学科的 Domain Pack 和正式课件进入规模开发前，该学科对应知识簇必须完成知识地图和来源门禁。

## 2. 权威范围

全国共同基线以教育部现行《普通高中课程方案和语文等学科课程标准（2017年版2020年修订）》为第一事实来源。课程标准中的必修、选择性必修和选修分别记录，不把“高考常考”误写为“课标必修”。

来源优先级：

1. 教育部课程方案和各学科课程标准；
2. 教育部审定的普通高中教学用书目录；
3. 各版本教材，仅用于章节顺序、案例和术语映射；
4. 省级教学与考试文件，作为地区扩展，不覆盖国家层；
5. 教师资料、题库和网络内容，只能提供候选误区、案例与题型，不定义知识边界。

权威入口：

- [教育部关于印发普通高中课程方案和语文等学科课程标准（2017年版2020年修订）的通知](https://www.moe.gov.cn/srcsite/A26/s8001/202006/t20200603_462199.html)
- [教育部普通高中课程方案和各学科课程标准目录](https://www.moe.gov.cn/jyb_xxgk/xxgk/neirong/fenlei/kcjc/kcjc_js/kcjcjs_xkkcbz/)

知识地图不绑定人教版、沪教版或其他单一教材。教材适配采用独立 `TextbookMapping`，把教材册、章、节、页码或活动映射到稳定知识节点。

## 3. 不是一张扁平知识点清单

仅收集名词无法指导互动课件。知识地图至少包含六类节点：

| 类型 | 示例 | 课件意义 |
| --- | --- | --- |
| Concept | 函数、向量、化学平衡、细胞膜 | 定义、表征与边界 |
| Principle | 牛顿第二定律、遗传规律 | 因果和条件 |
| Method | 换元、控制变量、史料实证 | 可操作过程 |
| Model | 二次函数、理想气体、生态系统 | 状态和参数 |
| Experiment | 验证机械能守恒、滴定 | 装置、步骤、观察与误差 |
| Practice | 建模、论证、阅读、设计、表达 | 跨节点能力与任务 |

关系至少包括：

- `prerequisiteOf`：先修；
- `partOf`：属于课程模块或知识簇；
- `explains`：用于解释现象或结论；
- `contrastsWith`：容易混淆的对照；
- `representedBy`：公式、图像、语言、实验、空间或时间表征；
- `measuredBy`：可观察量和测量工具；
- `appliedIn`：问题、实验和真实情境；
- `extendsTo`：选择性必修、选修或跨学科延伸。

## 4. 知识节点契约

每个稳定节点至少记录：

```json
{
  "id": "cn-hs.math.functions.quadratic.shape",
  "subject": "mathematics",
  "curriculumLevel": "required",
  "module": "functions",
  "type": "model",
  "title": { "zh-CN": "二次函数图像与参数", "en": "Quadratic graphs and parameters" },
  "standardRefs": [{ "edition": "2017-2020", "section": "...", "requirement": "..." }],
  "prerequisiteIds": [],
  "relatedIds": [],
  "representations": ["symbolic", "graph", "table", "verbal"],
  "misconceptions": [],
  "observableVariables": ["a", "b", "c", "vertex", "axis", "roots"],
  "interactionCandidates": ["parameter-sweep", "probe", "compare", "trace"],
  "assessmentEvidence": [],
  "review": { "status": "draft", "sourceChecked": false, "subjectChecked": false }
}
```

正式节点必须满足：

- 有稳定 ID，不能使用教材页码充当 ID；
- 能追溯到课程标准或明确标记为教材/地区/拓展节点；
- 原文摘录与平台归纳分开保存；
- 先修和跨学科关系可机器检查；
- 误区、表征和交互候选是结构化字段，不埋在长段说明中；
- AI 生成只产生 `draft`，不能自动获得 `sourceChecked` 或 `subjectChecked`。

## 5. 从知识地图到课件

每个知识节点不是自动对应一个课件。开发单元是 `Learning Cluster`，通常由一个核心模型、若干先修节点、典型误区、表征转换和可观察量组成。

```text
Knowledge Nodes
  → Learning Cluster
      ├─ 学习目标
      ├─ 先修与误区
      ├─ 可交互模型
      ├─ 表征转换
      ├─ Instrument
      ├─ 现象候选与兴趣假设
      ├─ 场景族与场景组合
      ├─ 检查点
      └─ Journey
  → Domain Pack 能力
  → 一个或多个 Courseware Release
```

优先级不按“哪个页面容易做”决定，而按以下维度评估：

| 维度 | 问题 |
| --- | --- |
| 课程权重 | 是否属于共同必修或关键选择性必修？ |
| 先修中心度 | 是否连接大量后续知识？ |
| 交互增益 | 动画、操控、测量是否明显优于静态图文？ |
| 好奇心潜力 | 是否存在一个学习者能够理解、愿意追问且可亲手改变的现象？ |
| 场景自然度 | 话题与科学模型是否自然映射，而非给实验换皮肤？ |
| 实验自由度 | 能否从参数调节推进到对象建构、方案保存和自定问题？ |
| 玩法潜力 | 能否由科学状态形成目标、资源、失败、重试和多种策略？ |
| 误区强度 | 学习者是否常产生可通过操作暴露的错误模型？ |
| 引擎复用 | 开发一次能否覆盖多个知识簇？ |
| 确定性 | 是否能用本地确定性模型准确求值和验证？ |
| 评价价值 | 是否能设计可观察、非机械点击的学习证据？ |

## 6. 覆盖率定义

平台不发布一个容易误导的单一“已覆盖 X%”。至少分别显示：

1. **目录覆盖**：课程标准条目是否已经录入并建立稳定 ID；
2. **关系覆盖**：先修、组成、表征和跨学科关系是否完成；
3. **审校覆盖**：来源审校与学科审校是否完成；
4. **运行时覆盖**：Domain Pack 是否能表达和计算该节点；
5. **互动覆盖**：是否存在达到质量门槛的互动课件；
6. **学习深度**：仅讲解、可探索、可建模、可分析、可评价分别达到哪一级；
7. **可访问性覆盖**：键盘、触控、双语、文本替代、缩放和 reduced-motion 是否通过；
8. **发布覆盖**：是否有通过服务端复验并可固定嵌入的 Release。
9. **场景体验覆盖**：是否至少有一个通过科学硬门禁的情境场景，以及兴趣假设、试玩状态和淘汰记录。
10. **建构覆盖**：学习者自由度达到 F0—F4 的哪一级；只有 F2 以上可称“自由实验”。
11. **玩法覆盖**：是否存在由科学状态判定、支持多种策略和安全重试的挑战，而非装饰性积分。

建议的课件深度等级：

| 等级 | 含义 |
| --- | --- |
| C0 | 只有知识节点，没有课件 |
| C1 | 有正确的解释与静态表征 |
| C2 | 可操控参数并观察结果 |
| C3 | 可使用工具测量、比较和分析 |
| C4 | 能在具体情境中预测、建构、运行、测量、改进并解释；适合实验时达到 F2，挑战由科学状态判定；经典实验可以保留，但不能用装饰性故事或积分冒充情境与玩法 |
| C5 | 有迁移任务、学习者试玩证据、无障碍验收和外部固定版本实测 |

平台的“高质量覆盖”只统计 C4 及以上；C1、C2 不能因为页面可打开就计为完成。

## 7. 中国高中首期范围

知识目录保留教育部普通高中课程标准全部学科的顶层结构，用于长期兼容和跨学科引用；当前实施范围锁定为数学、物理、化学三科。只有这三科继续进行原子知识拆分、专家审校、教材映射、Learning Cluster 设计和互动课件生产。其他学科暂时只保留顶层目录，不以“已有学科根节点”宣称已经覆盖。

### 首期交付：数学、物理、化学

- 数学：优先建设函数与代数、几何、概率统计、数学建模等可视化推理与动态探究能力；
- 物理：优先建设运动、受力、能量、电磁、振动与波、热学和实验测量等统一模拟与分析能力；
- 化学：优先建设微观结构、反应过程、平衡、速率、有机结构和实验操作等多表征互动能力。

三科优先不是只完成知识点清单，而是分别达到“可审校、可选题、可制作、可嵌入、可验收”的完整闭环。生物学、地理、信息技术、通用技术及其他学科冻结在顶层目录阶段，待三科门禁通过后再重新排期。

### 第二批：结构、证据与时空关系明显的内容

- 历史的时间、空间、因果与史料关系；
- 语文和外语的结构、语用、阅读与表达过程；
- 思想政治中的制度、经济和社会关系模型。

### 第三批：体验和创作型内容

- 音乐、美术、艺术；
- 体育与健康；
- 劳动、综合实践及跨学科主题。

后续分批只描述长期方向，不构成当前实施承诺。对于不适合模拟的内容，可以采用时间线、地图、证据网络、对照阅读、结构标注、过程反馈等互动形态，不能为了统一引擎把所有学科都做成参数滑块。

## 8. 阶段与门禁

### K0：来源与 Schema

- 保存课程方案、各学科标准及版本摘要；
- 冻结 Node、Relation、StandardRef、TextbookMapping、LearningCluster Schema；
- 建立原文、归纳、AI 草稿和人工审校的来源边界。

完成门槛：任一节点都能说明“来自哪里、属于哪一层、由谁审校、发生过什么版本变化”。

### K1：全学科顶层目录

- 录入全部学科、课程模块和必修/选择性必修/选修结构；
- 建立跨学科顶层关系；
- 不追求首轮就拆到最细题型。

完成门槛：课程标准的每个内容模块都映射到至少一个稳定目录节点，不存在无归属的官方模块。

### K2：原子知识图谱

- 按学科拆分概念、原理、方法、模型、实验和实践；
- 建立先修、组成、对照、应用与表征关系；
- 收集典型误区和可观察量；
- 生成差异报告，发现重复、孤立节点和先修环。

完成门槛：准备开发的 Learning Cluster 必须达到 100% 来源追溯、无未解释先修缺口，并完成学科审校。

### K3：课件候选与覆盖矩阵

- 对知识簇进行交互价值和引擎复用评分；
- 为高价值知识簇提出多个现象与场景候选，分别记录科学映射和兴趣假设；
- 用低保真可操作原型与真实反馈筛选场景，不把团队偏好直接写成“学生兴趣”；
- 建立经典实验、情境场景、自由沙盒和迁移任务之间的场景组合，而非要求一个页面承担全部目标；
- 评估 F0—F4 实验自由度，验证对象建构、撤销、复位、方案快照和学习者自定问题；
- 为适合挑战的知识簇设计科学状态驱动的目标、资源、失败、重试和多策略，不强迫所有节点游戏化；
- 绑定所需 Domain Pack、Instrument、Journey 与评价证据；
- 生成学科、模块、课程层级和深度覆盖看板。

### K4：持续审校与迁移

- 课程标准更新时保留旧版本并生成节点差异；
- 教材换版只更新映射，不静默改变知识节点；
- 已发布课件固定自己的知识地图版本；
- 废弃节点需要迁移说明和受影响 Release 清单。

### 三科完成门禁

数学、物理、化学必须分别通过以下门禁，才可以称为该学科的首期版本“做好”：

1. 国家课程标准基线中的必修和选择性必修内容均有稳定知识节点、来源定位和层级归属；国家课标允许学校自主组合或设置的内容必须明确标成范围说明，不能伪造可穷举性；
2. 所有准备进入课件生产的节点完成学科专家审校，关键 Learning Cluster 不存在未解释的先修缺口、循环依赖或术语冲突；
3. 至少完成一套实际采用教材的版本、册次、章节到知识节点映射，并能把教材差异与稳定知识节点分开维护；
4. 每科形成覆盖矩阵，能够显示知识点覆盖、C0-C5 课件深度、缺口、复核责任人和更新时间；
5. 每科至少选择 2-3 个具有代表性的 Learning Cluster，完成 Domain Pack、Instrument、场景候选组合、Construction Kit、Challenge Rules、Journey、检查点和学习证据设计；
6. 代表性课件达到 C4，且至少一个达到 C5：适合实验的代表课件达到 F2 以上，至少一个挑战证明多策略与安全重试，并具有学习者试玩支持的情境场景，通过无障碍检查、固定版本复现和两个外部网站容器的嵌入验收；
7. 审校报告没有阻断项，未完成项必须作为公开、可追踪的差异存在，不能被“页面可打开”替代。

## 9. 当前落点

二次函数课件继续作为 Runtime Kernel 和 `math.functions` Domain Pack 的技术母版，但不能代表高中数学覆盖完成。正式扩展前先完成高中数学顶层目录，并详细完成“集合与逻辑—函数—方程与不等式—导数相关应用”周边知识簇，确认二次函数在先修和后续关系中的位置。

近期顺序：

1. K0：冻结知识地图 Schema 和权威来源清单；
2. K1：建立中国普通高中全学科顶层目录；
3. K2-Math：处理高中数学必修、选择性必修和 A-E 类选修审校队列，补充教材映射；
4. K2-Physics：审校现有物理图谱、实验与选修范围说明，补充教材映射；
5. K2-Chemistry：审校现有化学图谱、实验与灵活选修范围说明，补充教材映射；
6. K3：生成三科统一覆盖矩阵，并从每科选择 2-3 个代表性 Learning Cluster；
7. R1/R2：只围绕三科建设可复用 Domain Pack、Instrument、Journey 和外站嵌入验收；
8. A1/A2：用同一引擎提出多个低保真场景候选，先做教师审校和学习者试玩，再确定旗舰场景；
8. 三科完成门禁通过前，不继续拆分生物学、地理、信息技术、通用技术或其他学科。

在 K0、K1 完成前，不批量生产课件；在对应 Learning Cluster 通过 K2 门禁前，不把课件标记为“覆盖该知识点”；在 C4 质量门槛前，不计入高质量互动覆盖。

## 10. 首轮实施证据

截至 2026-10-15，路线图已经形成可执行资产，而不是只停留在文档：

- `packages/contracts/courseware/knowledge-map-v1.schema.json`：总目录、权威来源、学科、节点、关系、知识簇、教材映射与审校状态的严格契约；
- `packages/contracts/courseware/knowledge-map-fragment-v1.schema.json`：按学科拆分、独立维护并由总目录装配的分片契约；
- `curricula/cn-upper-secondary/2017-2020/catalog.json`：教育部 2017 年版、2020 年修订高中课程方案与 20 个学科标准的顶层目录；
- `curricula/cn-upper-secondary/2017-2020/subjects/mathematics.json`：高中数学课程层级与模块骨架，以及“二次函数—方程—不等式”互动课件知识簇；
- `curricula/cn-upper-secondary/2017-2020/subjects/mathematics-required-functions.json`：依据课标第 23-31 页拆分的预备知识和函数主题首批原子节点、关系与互动课件知识簇；
- `curricula/cn-upper-secondary/2017-2020/subjects/mathematics-required-geometry-data-modeling.json`：依据课标第 33-44 页拆分的几何与代数、概率与统计、数学建模与探究原子节点、关系与互动课件知识簇；
- `curricula/cn-upper-secondary/2017-2020/subjects/mathematics-selective-required.json`：依据课标第 45-58 页拆分的数列与导数、空间向量与解析几何、计数与概率统计、建模探究原子节点、关系与互动课件知识簇；
- `curricula/cn-upper-secondary/2017-2020/subjects/mathematics-electives.json`：依据课标 PDF 第 59-81 页拆分 A-D 类专题及内容要求，并记录 E 类课程类型、课标示例和大学先修方向；E 类由学校开发或选用，不被误写成全国统一固定清单；
- `curricula/cn-upper-secondary/2017-2020/subjects/physics-required.json`：依据物理课标第 20-32 页拆分必修 1—3 的运动、相互作用、能量、曲线运动与万有引力、静电场、电路、电磁场、电磁波和能源可持续发展节点，并形成 8 个互动课件知识簇；
- `curricula/cn-upper-secondary/2017-2020/subjects/physics-selective-required.json`：依据物理课标第 33-45 页拆分选择性必修 1—3 的动量与碰撞、振动与波、光学、磁场、电磁感应、交流电与电网、传感器、物态与热力学、原子核和波粒二象性节点，并形成 11 个互动课件知识簇；
- `curricula/cn-upper-secondary/2017-2020/subjects/physics-required-experiments.json`：依据物理课标第 52-53 页完整记录必修 12 项和选择性必修 9 项学生必做实验，显式绑定对应知识、可测变量、实验仪器、数据处理与误差分析候选；
- `curricula/cn-upper-secondary/2017-2020/subjects/physics-electives.json`：依据物理课标第 45-51 页拆分选修 1—3 的物理学与社会发展、技术应用、近代物理学初步内容，并形成 11 个互动课件知识簇；这些模块是国家课标提供的参考，不代表学校自设选修的完整集合；
- `curricula/cn-upper-secondary/2017-2020/subjects/chemistry-required.json`：依据化学课标第 19-35 页拆分必修课程五个主题，形成首批概念、原理、方法与社会实践知识簇；
- `curricula/cn-upper-secondary/2017-2020/subjects/chemistry-required-experiments.json`：依据化学课标附录 3 完整记录必修 9 项和选择性必修 9 项学生必做实验；两组实验均已由相应理论分片连接到知识节点；
- `curricula/cn-upper-secondary/2017-2020/subjects/chemistry-selective-required.json`：依据化学课标第 27-53 页拆分“化学反应原理”“物质结构与性质”“有机化学基础”三个模块及九个主题，并把 9 项选择性必修学生实验连接到对应理论节点；
- `curricula/cn-upper-secondary/2017-2020/subjects/chemistry-electives.json`：依据化学课标第 53-63 页建立“实验化学”“化学与社会”“发展中的化学科学”三个系列、十个建议主题和参考案例节点；明确保留学校在系列内、跨系列或围绕项目组合实施的空间；
- `scripts/report-knowledge-map-review.mjs`：按学科生成可领取的专家复核队列和覆盖差异，区分阻断缺口、非阻断缺口与基线范围说明；已生成 `reports/mathematics-review.json`、`reports/physics-review.json` 和 `reports/chemistry-review.json`；
- `scripts/report-three-subject-coverage.mjs`：生成 `reports/stem-focus-coverage.json`，机器化冻结数学、物理、化学三科实施范围，汇总完成门禁并按优先级列出每科前五个互动课件候选；
- `packages/contracts/courseware/courseware-brief-v1.schema.json`：冻结从 Learning Cluster 到课件制作任务的预生产契约，包含学习目标、误区、状态变量、命令、派生视图、工具、场景、检查点、双语 Journey、无障碍与双外站嵌入要求；
- `curricula/cn-upper-secondary/2017-2020/textbook-baseline.json` 与 `packages/contracts/courseware/textbook-baseline-v1.schema.json`：依据教育部教学用书目录、人教社第 11 套高中教材目录、出版社官方资源、国家智慧教育平台电子教材与地区实际采用目录，确定首套机器可读教材映射基线，共登记数学 5 册、物理 6 册、化学 5 册。这是平台首套基线，不代表全国只有一个教材版本；
- `scripts/generate-textbook-mappings.mjs` 与三份 `*-textbook-mappings.json`：为三科必修、选择性必修的原子节点生成可重复检查的教材章节映射；当前目标范围 280 个节点已全部映射（数学 121、物理 91、化学 68），`npm run knowledge-map:textbooks -- --check` 会拒绝生成物漂移；
- `curricula/cn-upper-secondary/2017-2020/courseware-briefs/`：已为“导数、函数变化与优化”“受力分析、牛顿定律与运动”“化学平衡、动力学与过程调控”分别建立 C4 目标规格；三个代表性知识簇的全部节点均已映射到上述教材基线，`textbook-mapping` 阻断项已经解除。三份规格仍因尚未通过具名学科教师审校而保持 `review-blocked`，可用于评审和任务拆分，但不能计为已批准生产；
- `scripts/validate-courseware-briefs.mjs` 与 `npm run courseware:briefs:check`：校验课件规格与知识簇节点、运行时要求和门禁状态不发生漂移，并要求学习目标同时被场景与检查点覆盖、双语 Journey 完整、键盘与减少动态效果可用、至少两个外站容器通过验收；
- `packages/contracts/courseware/courseware-coverage-v1.schema.json` 与 `courseware-coverage.json`：把实际可运行包绑定到知识簇，并将“代表性原型”“C4”“C5”分开计数；Doctor、双语、键盘、减少动态效果、宿主数量与真实浏览器旅程各自保留证据，不能把可打开的页面误报成 C4；
- `templates/courseware/`：已形成数学“二次函数形状探索”、物理“力与运动实验室”和化学“化学平衡调控实验室”三个全屏、双语、可嵌入的代表性包；三者通过 L0 Doctor 和契约测试，目前登记为 `representative-prototype`，在真实浏览器 Journey 与学科审校完成前不升级为 C4；
- `packages/contracts/courseware/curriculum-review-packet-v1.schema.json`、`scripts/report-courseware-review-packets.mjs` 与 `review-packets/`：为三个代表性知识簇生成可领取的审校工作表，逐项列出节点来源、术语、边界、先修关系、可观察量、误区、簇内外关系、运行时适配和已核验的教材章节映射；教材录入状态由实际映射自动生成，但所有学科审校决策仍保持 `pending`，不会用自动生成结果冒充专家结论；`npm run knowledge-map:review-packets -- --check` 可检查工作表是否随知识图谱保持最新；
- `packages/creator-tools/src/knowledge-map.mjs` 与 `scripts/validate-knowledge-map.mjs`：分片装配、引用完整性、先修环、审校顺序、覆盖状态和稳定摘要校验；
- `npm run knowledge-map:check`：本地和 CI 可重复执行的知识地图门禁；`npm run knowledge-map:review -- --subject physics` 可重新生成指定学科复核报告。

当前首期三科机器统计为 496 个来源核对节点、252 条关系和 89 个 Learning Cluster；数学为 181 个节点、95 条关系、26 个知识簇，物理为 185 个节点、86 条关系、36 个知识簇，化学为 130 个节点、71 条关系、27 个知识簇。三科必修与选择性必修原子节点的首套教材映射已达到 280/280；三科各有 1 个通过 Doctor 的代表性课件包，但 C4、C5 与真实浏览器双宿主验收仍为 0。数学必修、选择性必修和 A-E 类选修国家基线，物理课标明确列出的必修、选择性必修、全部 21 项学生必做实验和选修 1—3 参考模块，以及化学必修、选择性必修、全部 18 项学生必做实验和三个选修系列国家参考模块，已经形成首轮来源核对图谱；它们尚未通过具名学科专家审校。数学 E 类学校开发课程、学校自设物理选修与化学选修的自主组合均不属于国家基线的可穷举范围。因此校验结果会保留 `KNOWLEDGE_MAP_COVERAGE_INCOMPLETE` 警告，平台不得据此宣称“中国高中知识点已经完整覆盖”。

下一批执行顺序已收窄为：由具名数学、物理、化学教师处理现有审校包；工程侧补齐真实浏览器双宿主 Journey，把三个代表性原型逐项提升到 C4，再选择至少一个完成 C5 固定版本复现与无障碍实测。暂不开始生物学、地理和技术学科分片。课件只从已经具备来源、先修关系、可观察量和验收目标的 Learning Cluster 中立项。
