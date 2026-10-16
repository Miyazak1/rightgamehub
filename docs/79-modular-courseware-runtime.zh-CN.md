# 结构化课件模块运行时与可控热插拔契约

状态：R1 已实现并通过三科参考课件闭环
版本：v1.0
日期：2026-10-16
关联文档：[74 Agent 原生互动课件平台](./74-agent-native-interactive-courseware-platform.zh-CN.md)、[75 课件托管与外部嵌入](./75-courseware-embed-service-roadmap.zh-CN.md)、[77 好奇心驱动的情境化互动课件](./77-curiosity-driven-scenario-courseware-architecture.zh-CN.md)

## 1. 决策

结构化课件保留完整模块分层，不把不同职责压缩成单体页面或单一学科引擎。运行时采用：

> **统一 Runtime Kernel + 可选模块 + 能力依赖 + 分区状态 + 可控热插拔 + 固定 Release。**

模块化不等于运行时从互联网安装代码。正式 Release 中的所有模块必须在构建阶段解析、校验、固定版本、计算摘要并打入自包含产物；运行时 Registry 只解析当前 Release 内已批准的本地模块。开发预览可以替换模块，正式教学现场仍可复现。

## 2. 模块类型与必要边界

| 类型 | 唯一职责 | 不负责 |
| --- | --- | --- |
| `domain` | 学科状态、约束、确定性求值与可观察量 | 场景叙事、布局、得分 |
| `scenario` | 学科对象与世界对象的映射、近似和有效范围 | 覆盖学科求值 |
| `construction` | 对象目录、连接、配置、撤销和方案快照 | 注入任意规则 |
| `challenge` | 目标、资源、成功、失败、评分和重试 | 维护第二套科学事实 |
| `component` | 视觉、输入和无障碍交互 | 保存权威结果 |
| `instrument` | 探针、轨迹、图表、表格和比较投影 | 改写被观察状态 |
| `journey` | 问题、开放节奏、检查点、提示和复盘 | 操纵科学结果 |
| `embed` | 宿主命令、尺寸、语言、进度和脱敏事件 | 访问父页面 DOM、身份或 Creator API |

模块均可选。一个 Concept Widget 可以只有 `domain + component`；Guided Lab 可以增加 `instrument + journey`；Sandbox Challenge 再组合 `construction + scenario + challenge`。平台支持三种模式，不强制每个课件伪造三种模式。

## 3. Module Manifest

机器契约位于 `packages/contracts/courseware/module-manifest-v1.schema.json`，实现位于 `packages/courseware-runtime/`。每个模块必须声明：

```json
{
  "format": "mooyu.courseware-module",
  "schemaVersion": 1,
  "id": "math.functions",
  "version": "1.0.0",
  "kind": "domain",
  "apiVersion": 1,
  "entry": "./math-functions.mjs",
  "integrity": "sha256:<64 lowercase hex>",
  "hotSwap": "paused",
  "stateSchemaVersion": 1,
  "capabilities": ["observable.function-value"],
  "commands": ["coefficient.set"],
  "dependencies": []
}
```

`version` 标识实现版本；`apiVersion` 标识模块接口兼容面；`stateSchemaVersion` 标识持久状态格式。三者必须独立，不能用实现版本推断状态可迁移。

依赖通过 `id + apiVersion + capabilities` 描述兼容性，Builder 在 Release lock 中记录实际选择的模块版本与摘要。可选依赖缺失不能阻止运行；硬依赖缺失、API 不匹配或能力不足必须 fail-closed。

## 4. 生命周期

```text
register → resolve → activate → dispatch / observe
                         ↓
                    deactivate → dispose
```

- `register`：验证清单和模块定义，不执行学科逻辑；
- `resolve`：拓扑解析依赖，拒绝环和不兼容能力；
- `activate`：初始化该模块独占的可序列化状态；
- `dispatch`：Kernel 校验并路由声明过的命令；
- `observe`：只读派生，不修改状态；
- `deactivate`：停止响应并释放运行连接；
- `dispose`：释放最终资源，不可恢复。

模块不得直接取得其他模块的可写引用。跨模块协作只能通过命令、只读观察量和 Kernel 提供的上下文完成。

## 5. 状态所有权

`CourseState` 是逻辑上的单一事实来源，但物理结构按模块分区：

```text
CourseState
  ├─ kernel.clock
  ├─ kernel.preferences
  └─ modules
       ├─ math.functions
       ├─ scenario.rescue
       ├─ instrument.coordinate-probe
       └─ challenge.hit-target
```

每个模块只能返回自己的下一状态。Kernel 负责序列化、命令日志、快照和恢复。Domain 的可观察量可以被 Instrument、Challenge 与 Component 读取，但后者不得保存相互矛盾的科学副本。

任何模块状态和命令载荷必须是有界、无函数、无循环引用的结构化数据。相同 Release、初始快照和命令序列必须得到相同关键状态。

## 6. 热插拔等级

| 模块 | 允许等级 | 原因 |
| --- | --- | --- |
| `component`、`instrument` | `live` / `paused` / `session` | 可替换投影或交互，不应改变科学事实 |
| `scenario`、`construction`、`challenge`、`journey` | `paused` / `session` | 切换会改变约束、目标或学习过程 |
| `domain` | `paused` / `session` | 必须在稳定时间点检查状态兼容与迁移 |
| `embed` | `session` | 宿主信任通道不能中途换实现 |

- `live`：运行中可替换；
- `paused`：必须暂停后替换；
- `session`：当前会话不允许替换，必须重新创建 Runtime。

状态 Schema 未变化时可以保留该模块状态；发生变化时，新模块必须提供显式 `migrateState`。没有迁移器、依赖将被破坏或模块类型改变时拒绝替换。正式固定 Release 中发生的“热插拔”只在已打包模块之间进行，不改变 Release 字节与摘要。

## 7. 安全与构建边界

- 不接受远程 URL、裸包名或绝对路径作为模块入口；
- Builder 验证入口位于项目根内，并写入 SHA-256；
- 运行时不解析 npm、不访问组件市场、不下载代码；
- 模块能力是声明和申请，不自动扩大 iframe 权限；
- Release lock 固定模块 ID、版本、API、状态 Schema、入口和摘要；
- 服务端重新解析模块图和摘要，不信任本地构建报告；
- 已发布 Release 不随 Catalog 或 Runtime 升级而改变。

## 8. 当前实现

已实现：

- Module Manifest v1 JSON Schema；
- 严格清单校验和模块定义；
- Registry、能力依赖解析、循环/缺失/不兼容拒绝；
- 模块独占状态、声明命令、只读观察、快照与恢复；
- `live`、`paused`、`session` 热插拔门禁；
- 状态 Schema 变化时的显式迁移；
- 确定性、可选依赖、实时 Instrument 替换、Domain 暂停迁移的自动测试；
- Experience v1 向后兼容地放宽为模块可选，不再全局强制三种模式和 Instrument。
- `mooyu.courseware-module-lock` v1 与固定 Builder：锁定根模块、依赖图、模块清单和入口摘要；
- 浏览器安全装载器：同源读取、禁止重定向、Web Crypto 摘要复验、Blob ESM 导入和明确的启动错误事件；
- Runtime Edge 与本地预览的结构化 CSP：仅结构化课件开放 Blob 模块执行和同源资源读取；
- 数学二次函数、物理牛顿小车、化学平衡三个确定性 Domain Pack；
- 通用 Measurement、Workbench、Journey 与 Embed 模块，以及三科各自的 Challenge 模块；
- 三套课件均迁移为 `mooyu-structured-v1`，每套按需组合六个根模块；
- 服务端上传复验模块锁、模块图、入口 SHA-256 和发布清单，不信任本地构建报告；
- 学习专区构建输出完整不可变课件目录，不再只复制入口 HTML；
- 教材 / 自由 / 挑战三模式、快照恢复、语言切换、键盘与减少动态效果、Embed v1/v2 双宿主状态迁移自动验收。

## 9. 完成边界与后续演进

R1 的“可选、可组合、可控热插拔”底层闭环已经完成。后续新增知识点时，应优先复用 Runtime Kernel、通用 Instrument/Component/Journey/Embed，只增加必要的 Domain、Scenario、Construction 或 Challenge；不得为了单个课件继续向 Kernel 堆学科特例。

生产上线前仍需做部署环境中的跨浏览器人工验收、真实教师审校与学习者试玩。这些属于内容与发布运营证据，不改变 R1 模块契约，也不应阻塞创作者继续逐件上架课件。
