# 墨鱼工坊交互课件托管与外部嵌入方案

状态：E0.6 本地参考实现已完成模块锁、Embed v1/v2、三科三模式与双宿主状态迁移；生产网关、跨浏览器和完整无障碍人工验收待完成
版本：E0.6
日期：2026-10-16
关联文档：[74 Agent 原生互动课件插件平台](./74-agent-native-interactive-courseware-platform.zh-CN.md)、[76 中国普通高中知识地图](./76-china-high-school-knowledge-map.zh-CN.md)、[77 好奇心驱动的情境化互动课件架构](./77-curiosity-driven-scenario-courseware-architecture.zh-CN.md)、[16 上传发布与运行隔离](./16-publishing-runtime-spec.zh-CN.md)、[34 匿名目录与 Runtime Edge](./34-m1-runtime-edge-catalog.zh-CN.md)、[60 私密信息设计与安全禁区](./60-private-information-security.zh-CN.md)

## 1. 决策摘要

墨鱼工坊建设一套自有的交互、可视化课件体系。课件由创作者和 Agent 在本地制作，经墨鱼工坊校验后形成不可变 Release，并由墨鱼工坊服务器统一托管运行。学校、课程网站、博客和其他教育平台通过受控 iframe 调用，不下载源码、不安装运行时，也不复制课件到各自服务器。

产品定义为：

> **墨鱼工坊负责制作、验证、托管和更新高质量互动课件；外部平台像嵌入视频一样嵌入课件。**

2026-10-15 的架构校准进一步冻结：墨鱼工坊不是拍照识题产品，也不是站内 AI 编辑器。它的核心是让不同 Agent 制作的高质量交互课件，经过共享运行时和确定性学科引擎构建后，发布一次并在多个网站安全复用。外部网站负责用户和课程编排，墨鱼工坊负责课件本身。

首版冻结以下决定：

1. 复用现有 `kind=courseware`、上传、服务端复验、不可变 Release 与 Runtime Edge；
2. 外部调用首选跨域 iframe，不首发 npm 包、远程脚本或可复制源码；
3. 外部网站只面对稳定的 `embed.mooyu.fun` 网关，不直接依赖 Release 子域名；
4. 生产教学场景固定具体 Release；`current` 通道只用于低风险、主动跟随更新的场景；
5. 首版课件运行时保持静态、确定、无模型密钥和无任意外网请求；
6. 外部平台负责自己的用户、班级、课程和成绩册；墨鱼工坊不要求取得其账号凭据；
7. 首版不保存学生自由文本、题目图片、聊天记录或身份信息；
8. 实时 AI 导师、LTI、xAPI、付费授权和私有课件均后置，不阻塞公开课件嵌入；
9. 墨鱼工坊的主要投入继续放在课件质量、组件、模板和 Agent 创作能力，而不是为每个外部平台建设定制教学系统。
10. 官方长期主线采用 `structured-courseware`：一个状态模型同时驱动画面、动画、数据、图表、测量和检查点；
11. 现有静态 Web ZIP 以 `legacy-web` 兼容层继续运行，不阻塞迁移，也不冒充结构化课件；
12. 拍照、OCR 和自动识题不进入主路线；未来若有真实需求，只作为独立上游输入适配器。
13. 科学模型与场景体验分离：同一确定性引擎支持多个具体情境；知识正确不自动等于场景有趣，官方推荐还需要教师审校和学习者试玩证据。
14. 自由实验与科学挑战是结构化运行时的一等能力：适合实验的旗舰课件至少达到 F2 建构自由度，游戏目标、失败、成功和评分必须来自同一科学状态。

## 2. 为什么采用托管嵌入

### 2.1 对墨鱼工坊

- 一份课件只发布和维护一次；
- 安全修复、撤下和兼容提示有统一入口；
- 不可变 Release 保证学校固定版本不会被静默替换；
- 组件、无障碍和移动端改进可以形成新的明确版本；
- 可以衡量真实的课件启动、完成和错误，而不收集学生隐私；
- 墨鱼工坊保留课件品牌、来源、许可证和质量状态。

### 2.2 对外部平台

- 一段 iframe 即可接入；
- 不承担课件代码供应链、依赖安装和静态资源部署；
- 不需要理解课件使用 Canvas、SVG、WebGL2 还是 WASM；
- 可以选择只显示课件，也可以监听结构化完成事件；
- 可以固定 Release，自主决定升级时间；
- 无需向墨鱼工坊提供长期账号 token 或学生数据库权限。

### 2.3 不采用的首发方式

| 方式 | 首版结论 | 原因 |
| --- | --- | --- |
| 复制 ZIP 到外部平台 | 不采用 | 版本、撤回、安全状态和来源会分叉 |
| npm/React 组件直接集成 | 不采用 | 与外部构建链、框架和升级周期强耦合 |
| 远程 `<script>` 注入页面 | 禁止 | 可访问宿主 DOM，隔离边界过弱 |
| 外部平台代理课件资源 | 不采用 | 缓存、Range、CSP、撤回和摘要难以保证 |
| iframe 托管嵌入 | 采用 | 跨框架、低接入成本、隔离清晰、便于固定版本 |

## 3. 范围与非目标

### 3.1 首版范围

- 已公开且通过服务器复验的 `courseware` Release；
- 公共 HTTPS 网站 iframe 嵌入；
- 固定 Release 与 `current` 两种解析方式；
- 中文、英文、主题、尺寸和全屏等有限宿主参数；
- `ready`、开始、场景、检查点、目标完成、课程完成和尺寸事件；
- 受限的本地进度导入、导出；
- 外部来源域名、启动、完成、错误的聚合统计；
- 撤下、暂停、版本不兼容时的统一失败页；
- 公开接入文档、复制代码和参考宿主页。

### 3.2 明确非目标

- 不接管外部平台的注册、班级、选课和成绩册；
- 不要求外部平台安装墨鱼工坊插件；
- 不在 iframe 内读取父页面 DOM、Cookie 或 Local Storage；
- 不接收外部平台长期 access token；
- 不上传键盘原文、自由文本答案、聊天记录或题目图片；
- 不允许课件声明任意 API 地址、模型供应商或远程脚本；
- 不为单一合作方修改课程包格式；
- 不在首版承诺 SCORM、LTI、QTI、xAPI；
- 不把实时 AI 推理设为所有课件的基础依赖。
- 不建设拍照、OCR、摄像头采集或题库识别入口；
- 不在首版建设站内拖拽式课件编辑器；
- 不让每个课件自行实现一套不兼容的时间轴、状态、图表和进度协议；
- 不因参考产品展示了某种功能就复制其产品身份、视觉品牌或全部功能。

## 4. 角色与责任

| 角色 | 负责 | 不负责 |
| --- | --- | --- |
| 课件作者/Agent | 教学目标、交互、来源、测试、修订 | 平台用户数据和部署密钥 |
| 墨鱼工坊创作工具 | 模板、Doctor、预览、构建、打包 | 自动公开发布 |
| 墨鱼工坊平台 | 复验、Release、托管、嵌入网关、撤回、聚合运行质量 | 外部平台的学生档案 |
| 外部平台 | 展示位置、用户身份、课程编排、是否记录结果 | 课件代码执行与资源分发 |
| 学习者 | 与课件交互、主动导出或保留本机进度 | 向墨鱼工坊提供额外身份 |

## 5. 总体架构

```text
Agent / 作者工作区
  └─ Courseware Toolkit
       ├─ Doctor / Test / Build / Package
       └─ 用户确认提交与发布
                    │
                    ▼
墨鱼工坊平台
  ├─ Creator API / Upload / Validator
  ├─ Work + Immutable Release + Assets
  ├─ Runtime Edge（实际课件字节）
  └─ Embed Gateway（稳定外部来源、策略与协议中继）
                    │
                    ▼
外部网站 iframe
  ├─ 纯展示：无需 SDK
  └─ 深度接入：Host SDK + MessageChannel
                    │
                    ▼
外部平台自己的用户、课程与进度系统（可选）
```

### 5.1 为什么需要 Embed Gateway

现有 Runtime Edge 使用 Release 专属来源，有利于隔离，但不适合作为外部集成的长期公共接口：Release 来源会变化，外部网站也难以安全维护大量允许来源。

`embed.mooyu.fun` 作为稳定网关承担：

- Work/Release 状态解析；
- 固定 Release 与 `current` 通道选择；
- 嵌入来源策略；
- 稳定的宿主通信来源；
- 加载、错误、暂停和撤下界面；
- 与 Release iframe 建立内部受信通道并转发白名单事件；
- 不把平台登录 Cookie、Creator API 或内部地址暴露给课件。

网关不修改课件字节，不把不同 Release 合并为可变资源。

### 5.2 结构化课件生产链

官方长期主线不是让每个作者独立发明一个网页，而是把创作自由放在结构化项目中，把运行一致性收敛到共享运行时：

```text
Agent + 墨鱼工坊插件
  → 课程目标、来源、现象候选、场景族、兴趣假设、模型、工具、检查点
  → Courseware Project（Schema 可验证）
  → Doctor / Journey / 数值断言 / 无障碍检查
  → 固定 Builder
       ├─ Runtime Kernel
       ├─ 固定版本 Domain Pack
       ├─ Component + Instrument Registry
       └─ 课程内容与本地资源
  → 自包含静态 Release
  → Runtime Edge
  → Embed Gateway
  → 外部网站 iframe / Host SDK
```

这条链路仍然只在构建阶段使用 Agent。学习者打开课件后，动画、求值、判定和图表由固定版本的本地运行时完成，不调用创作者的 Agent，不需要模型 Key，也不依赖墨鱼工坊 API 才能完成核心流程。

### 5.3 运行时产品模型

每个结构化课件由九部分组成：

| 部分 | 作用 |
| --- | --- |
| Course Document | 标题、语言、学习目标、先修、误区、来源和完成条件 |
| Domain Model | 数学函数、物理对象、算法状态等学科对象和确定性规则 |
| Scenario Pack | 把学科对象映射为具体世界、角色、物体和有效范围 |
| Scene Experience | 好奇心钩子、学习者目标、选择、约束、可见后果和复盘桥梁 |
| Construction Kit | 可添加对象、连接规则、建构命令、撤销、复位、实验快照和自由度等级 |
| Challenge Rules | 科学状态驱动的目标、资源、失败、成功、评分、多策略和重试 |
| Instrument | 探针、轨迹、数据表、图表、向量、能量和比较等观察工具 |
| Journey | Explore、Model、Analyse、检查点、提示和总结 |
| Presentation | 组件布局、语言、主题、动效、缩放和可访问性 |

运行时只维护一个 `CourseState`。动画、画面、数字、图表、解释、检查点和导出进度都从它派生。这样才能保证：

- 学习者拖动参数时，所有视图同步而不是各自更新；
- 时间轴暂停、步进、回放和复位可重现；
- 宿主保存的有限进度可以校验后恢复；
- Agent 和 Validator 能对命令序列做稳定断言；
- 同一学科工具可以被多个课件复用，而不是复制粘贴 UI。

参考图揭示的核心产品逻辑不只是 Explore、Model、Analyse、工具栏和时间轴，而是把可靠模型放进具体问题与可探索场景，让学习者先因现象产生问题，再构建、运行、测量和解释。拍照识题、摄像头入口和参考产品的品牌视觉不纳入本方案。

## 6. URL 与版本契约

### 6.1 固定 Release

```text
https://embed.mooyu.fun/v1/works/{workId}/releases/{releaseId}
```

适用于学校课程、作业、教材和任何需要复现的正式场景。相同 URL 的课件字节、课程 Manifest、组件版本和教学行为必须保持不变。

### 6.2 当前公开版本

```text
https://embed.mooyu.fun/v1/works/{workId}?channel=current
```

适用于作品官网、博客和愿意自动跟随作者发布的场景。每次打开时解析当前公开 Release，不保证跨时间复现。

### 6.3 产品详情页

```text
https://mooyu.fun/w/{workId}
```

详情页用于查看作者、来源、许可证、语言、适用阶段和质量状态，不作为 iframe 运行地址。

### 6.4 允许的查询参数

首版只接受并规范化：

```text
locale=zh-CN|en
theme=light|dark|system
motion=full|reduced|system
controls=full|minimal
```

未知参数拒绝或忽略，不得把 API 地址、账号、token、模型 Key、任意 CSS 或脚本作为查询参数。

## 7. 外部嵌入代码

最小接入不需要 JavaScript：

```html
<iframe
  src="https://embed.mooyu.fun/v1/works/WORK_ID/releases/RELEASE_ID"
  title="二次函数形状探索"
  loading="lazy"
  referrerpolicy="strict-origin-when-cross-origin"
  allow="fullscreen"
  sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-downloads"
  style="width:100%;aspect-ratio:16/9;border:0"
></iframe>
```

规则：

- 外部平台可以收紧 sandbox，不得要求墨鱼工坊放开摄像头、麦克风、定位或支付；
- 下载能力只在 Release 已批准 `fileExport` 时有效；
- 外部页面不得移除课件中的作者、来源、许可证或质量标识；
- 课件若声明不同推荐比例，复制代码生成器应输出对应 `aspect-ratio`；
- 外部平台必须为 iframe 提供可读 `title`。

## 8. Embed Protocol v1

### 8.1 连接

简单展示无需建立连接。需要接收事件或恢复进度时，外部宿主加载官方轻量 Host SDK。SDK：

1. 校验 iframe 来源必须为 `https://embed.mooyu.fun`；
2. 生成随机 nonce；
3. 通过 `postMessage` 发送一次连接请求和 `MessageChannel` 端口；
4. 网关校验 `event.source`、父页面来源和嵌入策略；
5. 后续通信仅使用已绑定端口，不在全局消息总线上广播学习数据；
6. 页面卸载、Release 撤下或账号上下文变化时关闭通道。

### 8.2 信封

```json
{
  "protocol": "mooyu.courseware.embed.v1",
  "version": 1,
  "type": "event",
  "id": "uuid",
  "name": "courseware.completed",
  "payload": {}
}
```

约束：

- 单条消息不超过 32 KiB；
- `id` 必须为 UUID；
- 未知字段、事件和命令拒绝；
- 高频交互先在课件内部聚合，不逐帧发送；
- 默认每秒不超过 20 条，持续超限关闭通道；
- payload 不接受 HTML、函数、URL、二进制或任意嵌套对象。

### 8.3 课件到宿主事件

| 事件 | 最小字段 | 用途 |
| --- | --- | --- |
| `courseware.ready` | `workId`、`releaseId`、`locale`、`capabilities` | 可以开始通信 |
| `courseware.started` | `startedAt` | 学习者开始交互 |
| `scene.entered` | `sceneId` | 当前教学场景 |
| `checkpoint.attempted` | `checkpointId`、`attempt`、`outcome` | 结构化检查点摘要 |
| `objective.completed` | `objectiveId`、`completedAt` | 目标完成 |
| `courseware.completed` | `objectiveIds`、`checkpointSummary`、`durationBucket` | 课程完成摘要 |
| `courseware.resized` | `height`、`aspectRatio` | 宿主调整布局 |
| `courseware.error` | `code`、`recoverable` | 运行错误，不发送堆栈和内部路径 |

`checkpoint.attempted` 不得发送学生输入原文，只允许 `correct`、`incorrect`、`skipped` 等有限枚举和次数。

### 8.4 宿主到课件命令

| 命令 | 字段 | 边界 |
| --- | --- | --- |
| `host.setLocale` | `locale` | 必须在 Release 声明语言中 |
| `host.setTheme` | `theme` | `light`、`dark`、`system` |
| `host.setMotion` | `motion` | 不得覆盖用户系统的 reduced-motion 限制 |
| `host.pause` | 无 | 页面隐藏或宿主主动暂停 |
| `host.resume` | 无 | 恢复动画和计时 |
| `host.restoreProgress` | `schemaVersion`、`state` | 仅限课件声明的有限状态 |
| `host.exportProgress` | 无 | 返回可迁移状态，不返回内部缓存和自由文本 |

首版不提供 `execute`、`eval`、DOM 查询、任意跳转、任意网络请求和模型调用命令。

### 8.5 Embed v2：模式控制与有界状态迁移

冻结的 Embed v1 继续只承担最小学习事件与宿主控制，不追加字段或改变语义。需要跨站恢复实验现场的宿主显式协商 `mooyu.courseware.embed.v2`，并使用以下新增命令：

| 命令 | 作用 | 约束 |
| --- | --- | --- |
| `host.setExperience` | 切换教材实验、自由实验或场景挑战 | 只接受课件已声明的模式 ID |
| `host.exportState` | 导出当前实验现场 | 返回绑定 Work/Release 的严格快照 |
| `host.restoreState` | 恢复实验现场 | 重新校验全部变量、对象与进度后原子恢复 |

v2 快照只包含 `sceneId`、`experienceMode`、最多 64 个标量变量、最多 64 个有界对象和脱敏进度；总消息不超过 64 KiB，仍维持每秒 20 条上限。变量名和对象 ID 使用受限标识符，拒绝 HTML、URL、函数、任意深层对象、学生答案原文和身份信息。固定 Release 的状态不得恢复到其他 Work 或 Release。任何不合法快照均以 `EMBED_STATE_INVALID` 失败，不得部分应用。

## 9. 进度与数据责任

### 9.1 默认模式

- 未接 Host SDK：进度仅保存在 iframe 所属站点的本机空间；
- 墨鱼工坊不要求登录；
- 关闭聚合分析不影响课件核心功能；
- 清理浏览器数据会清除本机进度，界面需明确说明。

### 9.2 外部平台托管进度

外部平台可以在自己的账号体系中保存 `host.exportProgress` 返回值，并在下一次加载后调用 `host.restoreProgress`。墨鱼工坊不需要知道外部 userId。

进度对象必须满足：

- 不超过 64 KiB；
- 包含课件 ID、Release ID、Schema 版本和状态摘要；
- 不包含姓名、邮箱、学校、班级、自由文本答案、聊天记录和图片；
- 固定 Release 的状态只能恢复到同一 Release，跨版本迁移由新 Release 显式声明；
- 宿主应把进度视为不可信输入，课件必须重新校验。

### 9.3 墨鱼工坊聚合数据

首版最多记录：

- Work/Release；
- 来源站点的规范化 origin 或不可逆聚合标识；
- 启动、有效交互、完成和错误计数；
- 粗粒度设备、语言和性能桶；
- 不设置跨站个人追踪 ID。

不得记录外部页面完整 URL、查询参数、学生标识和消息 payload 原文。

## 10. 安全模型

### 10.1 来源隔离

- 外部平台只嵌入 `embed.mooyu.fun`；
- 网关内部加载精确 Release 来源；
- 网关校验 Release ID、Work 状态、当前发布关系和撤回状态；
- Release 继续使用现有 CSP、Permissions Policy、MIME 和不可变资产规则；
- 外部宿主无法读取 iframe DOM、课件本机存储和内部消息端口；
- 课件无法读取父页面 DOM、Cookie、Local Storage 或认证头。

### 10.2 `frame-ancestors`

公开课件首版允许 HTTPS 父页面嵌入；开发预览可单独允许 loopback。作者或管理员可以关闭外部嵌入。域名白名单后置到 E4，但协议和数据库字段预留。

禁止把静态“embed key”当作秘密放进前端。未来私有内容应使用短期、限定 Work/Release/Origin、可撤销的签名 ticket。

### 10.3 权限

- 课件 Manifest 的能力只是申请，Release 记录服务器批准结果；
- Embed Gateway 不扩大 Release 权限；
- 外部网站的 `allow` 属性只能进一步收紧，不能为课件增加未批准能力；
- 首版不开放摄像头、麦克风、地理位置、剪贴板读取、支付和任意弹窗；
- 分享、下载和全屏沿用现有受限能力和用户手势要求。

### 10.4 撤回和失败关闭

Release 被撤回、Work 被暂停、摘要不一致或网关无法确认状态时：

- 不继续加载缓存课件；
- 显示不泄露内部原因的统一不可用界面；
- 向已连接宿主发送有限错误码；
- 不自动切换到另一个 Release；
- 固定版本是否升级由外部平台决定。

## 11. 可访问性与响应式要求

所有允许外部嵌入的正式课件必须通过：

- 320 px 窄屏与常见平板横竖屏；
- 鼠标、键盘和触控主要路径；
- 焦点可见、合理 Tab 顺序和跳过重复区域；
- 图形文字替代和不依赖单一颜色表达；
- `prefers-reduced-motion`；
- 200% 缩放；
- 中文和英文布局；
- iframe 高度变化不会造成无限 resize 循环；
- 课件内容不可用时仍有可读文字回退。

## 12. 对现有系统的复用与新增

### 12.1 直接复用

- `works.kind=courseware`；
- Courseware Manifest、课程结构、来源和 Journey 契约；
- Creator Toolkit 的 Doctor、Test、Build、Package、Submit 和 Publish；
- Upload、Validator、Release、Assets 与 Runtime Edge；
- 作品详情、作者、许可证、语言、学科和适用阶段；
- 撤下、举报、审核和不可变摘要；
- `/learn` 学习专区。

### 12.2 新增组件

| 组件 | 职责 |
| --- | --- |
| Embed Gateway | 稳定来源、Release 解析、加载/错误页、通信中继 |
| Embed Protocol Contract | 消息信封、事件、命令、错误和上限 |
| Host SDK | iframe 创建、握手、来源校验、订阅、进度导入导出 |
| Embed Metadata API | 标题、比例、语言、版本、能力、状态和复制代码所需信息 |
| Embed Code Generator | 详情页/创作者中心生成固定版本代码 |
| Reference Host | 无框架 HTML 参考集成和协议测试页 |
| Embed Operations | 来源、启动、完成、错误、撤回与版本采用率 |

### 12.3 不修改的部分

- 不改变现有游戏、创意项目和普通工具的运行语义；
- 不给普通 Web ZIP 自动开放外部嵌入协议；
- 不允许外部来源绕过发布与服务器复验；
- 不改变现有 Release 字节；
- 不把外部平台用户映射为墨鱼工坊用户；
- 不因嵌入功能开放 Creator API 或后台接口。

## 13. 建议 API

以下为设计契约，尚未实现：

```text
GET  /v1/courseware/works/{workId}/embed
GET  /v1/courseware/works/{workId}/releases/{releaseId}/embed
GET  /v1/courseware/embed/protocols/v1
POST /v1/courseware/embed/tickets              # E4 私有内容，首版不实现
```

公开描述示例：

```json
{
  "data": {
    "version": 1,
    "workId": "uuid",
    "releaseId": "uuid",
    "title": { "zh-CN": "二次函数形状探索", "en": "Quadratic Shape Explorer" },
    "embedUrl": "https://embed.mooyu.fun/v1/works/.../releases/...",
    "aspectRatio": "16/9",
    "locales": ["zh-CN", "en"],
    "capabilities": ["fullscreen", "learningProgress", "learningEvents"],
    "releaseDigest": "sha256",
    "publishedAt": "ISO-8601",
    "embedStatus": "public"
  }
}
```

API 不返回 Runtime 内部存储路径、Creator 身份凭据、上传信息或未公开 Release。

## 14. 运维与性能

- Embed Gateway 无状态部署，Release 与 Work 状态使用短 TTL 缓存；
- 固定 Release 静态资源使用内容摘要和长期 immutable 缓存；
- `current` 解析和撤回检查不得被长期 CDN 缓存；
- 网关失败不回退到未知或旧 Release；
- 记录网关延迟、Release 加载失败、协议错误和外部来源聚合；
- 设置单 origin 和单 IP 的合理请求速率；
- 热门课件扩容优先依赖对象存储/CDN，不增加 API 容器负担；
- 生产前验证 CSP、TLS、Range、压缩、跨域 iframe 和主流浏览器策略。

首版建议目标，不构成商业 SLA：

| 指标 | 建议目标 |
| --- | --- |
| 网关 HTML P95 | 小于 300 ms（不含网络） |
| 已缓存首屏资源 | 小于 2 秒进入可交互状态 |
| 协议握手 | 小于 1 秒 |
| 网关可用性 | 99.9% 月度目标 |
| 固定 Release 错误切换 | 0 次自动换版 |

## 15. 四轨分阶段路线

实施分为“知识地图 K 轨”“课件运行时 R 轨”“场景体验 A 轨”和“外部嵌入 E 轨”。四条轨道共享知识版本、Release 与测试，但不能互相冒充完成：知识点已录入不代表已有高质量课件；模型正确不代表场景会让学生感兴趣；课件能在本地样本页运行，不代表生产嵌入已经上线；iframe 协议可用，也不代表知识覆盖、结构化运行时或体验验证已经完成。K 轨的完整方案见 [76](./76-china-high-school-knowledge-map.zh-CN.md)，A 轨见 [77](./77-curiosity-driven-scenario-courseware-architecture.zh-CN.md)。

### K0—K2：知识地图门禁

- K0 冻结教育部权威来源与知识节点、关系、教材映射和 Learning Cluster Schema；
- K1 完成中国普通高中全学科顶层目录；
- K2 按学科完成原子知识图谱、先修、误区、表征和可观察量；
- Runtime Kernel 可与 K0、K1 并行，正式 Domain Pack 与课件必须绑定通过 K2 审校的知识簇。

### R0：兼容底座（已完成）

- Courseware v1、三个参考包、Toolkit、Doctor、固定构建、服务端复验和不可变 Release；
- 现有参考包归入 `legacy-web` 兼容层，继续作为嵌入与安全回归样本；
- 冻结 `structured-courseware` 与 `legacy-web` 的能力差异，不破坏旧包。

### R1：Runtime Kernel 与数学函数母版（当前阶段）

目标：把“二次函数形状探索”从独立页面升级为首个真正共享状态的结构化课件。

交付：

- `CourseState`、命令、时间轴、序列化、语言、主题与动效偏好 Schema；
- Module Manifest、能力依赖、分区状态、生命周期与 `live / paused / session` 热插拔门禁；
- `math.functions` Domain Pack，首批支持二次函数族；
- Explore、Model、Analyse 三种真实模式；
- 参数控件、取点探针、坐标网格、数据表、比较视图和检查点；
- 同一状态驱动画布、数值、图表、解释与完成条件；
- 一屏优先的桌面布局和窄屏重排，不依赖页面整体滚动完成核心任务；
- 确定性 Journey、状态快照、键盘、触控、双语和 reduced-motion 测试。

完成门槛：

- 相同初始状态与命令序列得到相同关键状态和断言；
- 任一参数变化在一个渲染周期内同步所有派生视图；
- 暂停、步进、复位和进度恢复不会产生第二套状态；
- 1366×768 桌面视口无需页面整体滚动即可完成核心路径；
- 320 CSS px、200% 缩放和无动画模式仍能完成核心路径；
- 课件不依赖拍照、登录、联网 API 或实时模型。

### R2：Agent 创作契约与固定 Builder

- 冻结结构化 Course Document、Scene、Domain、Instrument 与 Journey Schema；
- `courseware.init/doctor/preview/test/build` 全链路支持结构化项目；
- Builder 固定 Kernel、Domain Pack 和组件版本并输出自包含静态 Release；
- 插件提供可查询的组件能力、示例和错误修复建议，而不是大段视觉提示词；
- 服务端重新执行相同 Schema、Journey 和安全校验。

完成门槛：Codex 与 Cursor/VS Code 中的 Agent 能从同一结构化模板创建、继续编辑、构建并得到摘要一致的 Release。

### R3：工具库与第二学科包

- 将探针、轨迹、图表、表格、比较、标注和检查点变成可复用 Instrument；
- 根据真实课件需求在物理因果或算法步进中选择一个迁移为第二 Domain Pack；
- 不预先实现通用全学科引擎，也不同时扩张多个不成熟学科包。

### A0—A3：情境体验轨

- A0 冻结科学模型与场景体验分离、兴趣假设不可自证的原则；
- A1 以牛顿动力学为首个场景族，把现有小车原型保留为经典实验与引擎基线；
- A1 将现有 F1 参数实验升级为 F2 建构沙盒，同时制作多个低保真情境与至少两个挑战变体，先验证目标、建构、策略、失败重试、反馈、测量和复盘，再投入高保真资产；
- A2 根据教师审校和学习者试玩保留旗舰场景，记录被淘汰方案和原因；
- A3 把验证后的场景族方法扩展到数学与化学，但不复制力学布局或预设永久的“青少年热门话题”。

完成门槛：同一 Domain Model 能驱动经典实验、F2 以上自由实验和至少一个通过试玩的具体挑战；场景结果不覆盖求解器，挑战支持多种策略与低成本重试，兴趣证据与科学质量分别展示，核心 Journey 可在两个外部宿主中完成。

### R4：生态与治理

- 签名组件和学科包目录；
- 版本兼容、迁移、撤销和受影响 Release 查询；
- 第三方包的权限、许可证、性能和教学质量门禁。

### E0：协议冻结与样本证明

目标：证明现有课件不改包即可被稳定外部嵌入。

交付：

- `mooyu.courseware.embed.v1` 信封、事件、命令和错误码；
- Embed Descriptor Schema；
- 无框架参考宿主页；
- 三个官方参考课件的嵌入验收页面；
- 固定 Release、`current`、撤回和来源策略测试；
- 数据字段清单和隐私审查。

完成门槛：

- Chrome、Edge、Safari、Firefox 至少各完成一次公开 iframe 加载；
- 三个样本均完成中文、英文、键盘、触控和窄屏路径；
- 不修改 Courseware v1 包即可运行；
- 未建立协议时仍可作为普通 iframe 学习。

### E1：公共 Embed Gateway

目标：任何 HTTPS 网站都能复制固定版本代码并安全运行公开课件。

交付：

- `embed.mooyu.fun` 服务与 TLS；
- 固定 Release 与 `current` URL；
- Work/Release 状态门禁；
- 加载、不可用、撤回和不兼容页面；
- CSP、Permissions Policy、referrer 和缓存策略；
- 最小 `ready`、`completed`、`resized` 中继；
- 公开元数据 API。

完成门槛：

- 固定 URL 多次访问解析同一 Release 和摘要；
- 发布新版本不会改变已固定 URL；
- 撤下 Release 后网关 fail-closed；
- 外部页面不能读取课件 DOM 或平台凭据；
- 网关不扩大任何 Release 能力。

### E2：Host SDK 与可迁移进度

目标：外部平台无需接入墨鱼工坊账号，也能保存和恢复有限进度。

交付：

- 无依赖浏览器 Host SDK；
- MessageChannel 握手、超时、关闭和来源校验；
- 事件订阅与命令 API；
- 进度 Schema、64 KiB 上限和跨版本拒绝；
- React/Vue 仅提供薄包装，不复制核心逻辑；
- 恶意消息、重放、洪泛和来源伪造测试。

完成门槛：

- 外部演示站可以保存、刷新和恢复课件进度；
- Host SDK 不接触外部平台登录凭据；
- 消息中不存在自由文本答案和个人信息；
- 不安装 SDK 时课件核心学习流程不受影响。

### E3：产品化接入

目标：作者和合作平台不需要阅读内部架构即可完成接入。

交付：

- 作品详情和创作者中心的“嵌入课件”入口；
- 默认生成固定 Release 代码；
- 在线参数预览、尺寸建议和复制按钮；
- 中英文接入文档；
- 版本升级提示与采用率；
- 域名、错误和性能运营看板；
- 合作平台验收清单。

完成门槛：

- 新接入方仅使用公开文档，在 15 分钟内嵌入一个课件；
- 默认示例不使用 `current` 通道；
- 作者能够关闭外部嵌入；
- 支持团队可以根据 Work、Release、来源和错误码定位问题。

### E4：受控访问与合作治理

只有真实需求出现后实施：

- 按域名允许列表；
- 私有/授权课件短期签名 ticket；
- 调用额度、合作方标识和撤销；
- 合作方服务状态与变更通知；
- 更细的聚合完成漏斗；
- 内容授权与品牌显示规则。

不得使用可复制的永久前端密钥。ticket 必须短期、限定 Work/Release/Origin，且不代表学生身份。

### E5：教育标准与生态扩展

根据实际合作方需求选择，而不是预先全部实现：

- LTI 1.3 启动与成绩回传；
- xAPI 受限事件映射；
- QTI 检查点导入导出；
- SCORM 兼容包装；
- LMS 插件；
- 可选实时 AI 辅导能力；
- 课件组件和模板生态。

## 16. 工作包顺序

| 工作包 | 内容 | 依赖 |
| --- | --- | --- |
| CR-01 | `CourseState`、命令、时间轴和派生视图契约 | 74 的 Courseware v1 |
| CR-02 | `math.functions` Domain Pack 与二次函数母版 | CR-01 |
| CR-03 | 探针、数据表、比较、图表和检查点 Instrument | CR-01、CR-02 |
| CR-04 | 结构化项目 Schema、固定 Builder 与 Agent 插件支持 | CR-01—CR-03 |
| CR-05 | 结构化课件服务端复验与不可变 Release | CR-04 |
| CX-01 | 现象候选、兴趣假设、科学映射与场景组合规格草案 | K3、CR-01 |
| CX-02 | 牛顿动力学经典实验、F2 建构沙盒、三个低保真情境候选与至少两个挑战变体 | CX-01、受限 `physics.mechanics` 能力 |
| CX-03 | 教师审校、自由试验观察、挑战多策略/重试试玩和候选保留/淘汰记录 | CX-02 |
| CX-04 | 首个旗舰场景、体验契约校准与双宿主 Journey | CX-03、CE-02 |
| CE-01 | Embed Descriptor 与 Protocol v1 Schema | 74 的 Courseware v1 |
| CE-02 | Reference Host 与三样本跨域测试 | CE-01 |
| CE-03 | Embed Gateway 状态解析和固定 Release 页面 | CE-01 |
| CE-04 | CSP、frame-ancestors、缓存与撤回门禁 | CE-03 |
| CE-05 | Runtime 事件到网关的受限中继 | CE-01、CE-03 |
| CE-06 | 无依赖 Host SDK | CE-05 |
| CE-07 | 进度导入导出与 Schema | CE-06 |
| CE-08 | 详情页复制代码和创作者控制 | CE-03、CE-04 |
| CE-09 | 聚合运行质量与运营看板 | CE-03、数据审查 |
| CE-10 | 第一家外部平台真实验收 | CE-02—CE-09 |

近期运行时关键路径为 `CR-01 → CR-02 → CR-03 → CR-04`，同时完成 E0 人工验收。体验轨在 `CR-01` 后以 `CX-01 → CX-02 → CX-03` 做低保真验证，但 `CX-04` 必须等待试玩结果，不能因 UI 已完成而提前冻结。随后并行推进 `CR-05` 与 `CE-03—CE-05`。顺序不得倒置：先建立共享状态和确定性运行时，再扩展课件数量；先验证场景机制，再投入高保真资产；先冻结消息和安全边界，再做合作方定制；先固定公开 Release，再做私有授权。

## 17. 验收矩阵

| 编号 | 必须通过 |
| --- | --- |
| CE-A01 | 普通静态 HTML 页面只用 iframe 即可运行公开课件 |
| CE-A02 | 固定 Release URL 在新版本发布后仍加载原字节与摘要 |
| CE-A03 | `current` 仅跟随已确认公开的当前 Release |
| CE-A04 | 撤下、暂停、摘要错误和未知 Release 全部 fail-closed |
| CE-A05 | 外部父页面不能读取 iframe DOM、存储、Cookie 和内部端口 |
| CE-A06 | 课件不能读取父页面 DOM、Cookie、Local Storage 和认证信息 |
| CE-A07 | 未声明事件、命令、字段、超限消息和来源伪造被拒绝 |
| CE-A08 | 进度不包含自由文本答案、个人信息、图片和完整外部 URL |
| CE-A09 | 不接 Host SDK、禁用分析或游客未登录时仍可完成课件 |
| CE-A10 | 键盘、触控、窄屏、双语、reduced-motion 和 200% 缩放通过 |
| CE-A11 | 外部网站不能通过 iframe `allow` 增加 Release 未批准能力 |
| CE-A12 | 支持人员可按 Work、Release、来源和错误码追踪失败 |
| CE-A13 | 第一家外部平台无需访问源码即可完成固定版本接入和升级 |
| CR-A01 | 结构化课件只有一个可序列化事实状态，画面、数值、图表和检查点无平行真相 |
| CR-A02 | 相同 Release、初始状态、命令序列和随机种子产生相同关键结果 |
| CR-A03 | Agent 生成项目可被固定 Builder 复现，Release 不依赖作者机器、远程 CDN 或模型 Key |
| CR-A04 | Explore、Model、Analyse 中出现的功能均可操作且服务于声明的学习目标 |
| CR-A05 | 核心学习路径无需拍照、登录、外部 API 或页面整体滚动 |
| CX-A01 | 同一科学模型驱动经典实验和情境场景，场景脚本不能覆盖求解结果 |
| CX-A02 | 旗舰场景包含具体问题、有意义选择、可见后果、按需测量、解释和迁移 |
| CX-A03 | 兴趣状态区分团队假设、教师支持与学习者试玩支持，视觉完成度不能提升证据等级 |
| CX-A04 | 未通过试玩的候选可以保留为实验原型，但不能标记为官方高兴趣推荐 |
| CX-A05 | 适合实验的旗舰场景达到 F2 以上自由度，支持对象建构、撤销、复位和至少两组方案快照比较 |
| CX-A06 | 挑战的成功、失败和评分由科学状态判定，存在多种合理策略并允许低成本重试 |

## 18. 风险与控制

| 风险 | 控制 |
| --- | --- |
| 外部网站希望直接改课件 DOM | 只提供主题、语言、尺寸和协议参数，不开放 DOM |
| 作者更新导致教学现场变化 | 正式场景默认固定 Release |
| 外部平台把 iframe 事件当权威成绩 | 明确事件是课件结果摘要；高风险成绩后续需签名或 LTI |
| 跨站追踪和未成年人隐私 | 不设置跨站个人 ID，不采集自由文本和学生身份 |
| 恶意父页面伪造进度 | 所有恢复状态重新校验；不把客户端结果当平台审核证据 |
| 热门课件拖垮 API | 静态资源 CDN、网关无状态、状态短缓存、速率限制 |
| 课件被撤下后 CDN 继续运行 | 网关每次解析状态；撤回时阻断新加载并执行缓存失效 |
| 不同合作方要求导致协议膨胀 | 只加入跨平台稳定语义；定制需求留在对方适配层 |
| 实时 AI 费用和安全责任扩散 | AI 能力使用独立契约，不进入 Embed v1 基础能力 |

## 19. 停止条件

出现下列情况时停止扩大范围，先修复基础：

- 三个参考课件尚未完成跨浏览器和移动端验收；
- 固定 Release 仍会被静默切换；
- iframe 或消息通道能够读取任一方凭据；
- 撤下状态无法及时阻止新加载；
- 事件包含自由文本、学生身份或完整外部 URL；
- 为第一家合作方必须修改 Courseware v1 包；
- Host SDK 成为课件完成学习的强制依赖；
- 外部嵌入影响现有游戏、社区或课件站内运行。

## 20. 当前状态与下一步

截至 2026-10-15：

- Courseware v1 契约、三个模板、Toolkit、本地构建、私有提交、服务器复验、不可变 Release 和 `/learn` 基础已实现；
- Embed Descriptor、冻结的 `mooyu.courseware.embed.v1`、增量 `mooyu.courseware.embed.v2`、无依赖参考 Host SDK、Learning SDK 脱敏中继、双 loopback origin 验收服务器和三个样本页已实现；三个官方课件均可由宿主切换中英文和三种体验模式，并各自包含中英文 Journey；
- 自动测试已覆盖固定 Release、`current`、撤回、来源、未知字段、消息上限、旧课件包兼容、动态语言、状态快照边界、键盘焦点样式、reduced-motion 和隐私字段丢弃；Chromium 已实际完成跨来源加载、MessageChannel 握手、三样本英文切换、360px 窄屏，以及从第一宿主导出数学沙盒现场并在第二宿主恢复同一系数与模式；
- 生产 Embed Gateway、公开元数据 API、进度产品化、详情页复制代码和真实外部域名部署尚未实现；
- 当前 Runtime Edge 可作为内部执行基础，但不得把 Release 专属来源直接宣布为稳定外部 API；
- 本地样本不表示外部网站嵌入能力已经上线；Safari、Firefox、Edge/Chrome 独立矩阵以及键盘、触控、200% 与 reduced-motion 的完整人工记录完成前，E0 不得标记最终验收通过。
- 参考产品研究已明确新的结构化方向：共享状态、工具化观察、时间轴和学科引擎；拍照识题被明确排除，现有独立 HTML 样本保留为兼容层而不是最终架构；
- 当前二次函数精修样本验证了课本式布局和一屏优先方向，但它仍是 R1 的视觉/交互母版，尚未证明 Runtime Kernel、Domain Pack 和固定 Builder 已完成。

下一步同时完成两件有明确边界的工作：

1. 完成 E0 人工验收与发现的问题修复，不提前宣称生产外部嵌入已上线；
2. 将三科引擎的数值、单位和边界回归继续提升为确定性门禁，并把 v2 双宿主导出/恢复浏览器旅程纳入发布验收。

R1 通过后进入 R2 和 E1；A1 可以并行验证边界明确的牛顿动力学场景族，但不借此建设通用全物理引擎。此前不扩张到拍照识题、在线编辑器、私有课件、付费、LTI、实时 AI 或合作方定制。
