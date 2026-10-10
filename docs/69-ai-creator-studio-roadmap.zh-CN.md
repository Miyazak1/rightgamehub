# Agent 优先的结构化创作与发布路线

状态：方向已调整；用户自己的 Agent 负责本地创作，平台提供只读工具服务、校验和发布
更新日期：2026-10-10

## 1. 决策

GameHub 不承担通用模型调用，也不建设另一套网页 AI IDE。用户在自己的 Agent、编辑器或本地工具中完成主要创作，模型凭据保存在用户本机；平台只接收结构化成果并负责校验、预览、构建、版本和发布。

```text
用户 Agent / 本地编辑器
  -> 读取版本化的 GameHub 工具目录与任务约定
  -> 用户本地源码与第三方工具（按需、经同意）
  -> 结构化创作包
  -> 本地 Creator Validator
  -> 平台待发布草稿
  -> 平台再次校验
  -> 固定编译器
  -> 隔离预览
  -> 用户确认
  -> 不可变 Release
```

平台不接收模型 API Key，不代理模型请求，不按 token 向用户提供模型额度。Agent 可以使用任意服务商，但只能向平台提交符合协议的数据和素材。

## 2. 各端职责

### 用户 Agent

- 理解自然语言需求并生成结构化源码；
- 使用用户自己的模型账户和本机凭据；
- 修改、扩写、批量生成和整理素材；
- 运行 `npm run creator:validate -- <目录>`；
- 通过平台账号授权提交待发布草稿。

### 平台

- 发布 Agent 可读取的工具目录、创作包协议、JSON Schema、模板和本地校验器；
- 进行服务端 schema、安全和大小检查；
- 保存待发布修订，并使用 ETag 防止并发覆盖；
- 使用版本固定的可信编译器生成 Web ZIP；
- 通过现有 Web Validator、隔离 Runtime 和审核链路；
- 管理封面、说明、许可证、版本、分享、收藏和社区传播。

### 浏览器发布确认页

- 只读查看 Agent 提交的不可变修订；
- 查看隔离预览与校验错误；
- 选择版本名称并确认发布；
- 不编辑 Bingo 单元格，不承担长对话、批量生成、模型连接和密钥保存。

### Agent 本地创作工具包

平台提供版本化的机器可读目录，让用户自己的 Agent 知道所需源码格式、产物、校验命令和授权边界。平台不嵌入、不远程运行，也不要求用户手工学习这些编辑器：

| 工具 | 用途 | 进入平台的成果 |
| --- | --- | --- |
| 像素素材约定 / Piskel | 像素角色、动画和图块 | PNG、GIF、spritesheet，作为游戏素材 |
| Bitsy 适配 | 微型探索与短篇叙事游戏 | 本地源码与 `index.html` Web 项目 |
| PuzzleScript 适配 | 规则驱动的网格解谜 | 本地规则源码与 `index.html` Web 项目 |
| Twine / Twee 3 适配 | 分支剧情和互动小说 | 本地 Twee 源码与 `index.html` Web 项目 |

Agent 默认只读取 GameHub 已安装插件中的签名目录，在用户工作区内生成和修改文件。需要下载、安装或运行第三方编译器时必须先说明并获得用户同意；不能把模型凭据、平台 token、提示词或无关本机文件发送给 GameHub。用户作品仍需先通过本地 Doctor，再经过平台 Web ZIP Validator 与隔离 Runtime；工具的开源许可证不自动替用户作品选择许可证。

工具服务的三个级别：

- `ready`：GameHub 提供完整结构化模板、校验和提交通道；
- `guided`：GameHub 提供源码/产物约定与本地 Doctor，编译能力取决于用户本机已有工具；
- `asset-only`：只生成或整理素材，不能独立作为可玩作品发布。

## 3. 唯一事实来源

创作阶段的源文件以用户本地项目为准。平台保存的是一次提交后的待发布快照和不可变修订，不和本地项目做双向实时同步。

一次提交后，网页端不再修改内容。若要继续调整，应回到原 Agent、Bingo 游戏或外部创作工具，重新导出并明确提交新修订，不能静默覆盖平台上更新过的版本。

## 4. 创作包 v1

当前模板位于 `templates/creator-bingo`：

机器可读 schema 位于 `packages/contracts/creator-package`，Agent 应优先读取 schema，而不是从页面文案猜测格式。

```text
creator-manifest.json
source/
  bingo.json
assets/                 可选，后续协议开放
README.md               可选
LICENSE                 使用第三方内容时建议提供
```

`creator-manifest.json`：

```json
{
  "format": "gamehub.creator-package",
  "version": 1,
  "studio": "bingo",
  "schemaVersion": 1,
  "title": "我的年代作品 Bingo",
  "source": "source/bingo.json"
}
```

安全边界：

- `source` 只能指向包内 `source/` 下的 JSON；
- 不接受绝对路径、`..`、符号链接和越界文件；
- 单个结构化源码不得超过 1 MiB；
- Bingo 只接受标题、说明、行列标题和坐标单元格，不接受 HTML 或 JavaScript；
- 本地校验只是快速反馈，平台必须重新校验，不能信任客户端报告。

本地命令：

```bash
npm run creator:validate -- ./templates/creator-bingo
npm run creator:validate -- ./my-bingo --json --output ./artifacts/creator-package-report.json
```

## 5. 平台数据映射

| 创作包字段 | 平台字段 |
| --- | --- |
| `studio` | `creator_drafts.studio_key` |
| `schemaVersion` | `creator_drafts.schema_version` |
| `title` | `creator_drafts.title` |
| 源 JSON | `creator_drafts.content` |
| 每次提交或网页修正 | `creator_draft_revisions` |
| 首次构建 | 创建或绑定 Work |
| 固定编译输出 | Upload、Validator、Release |

`creator_drafts` 的产品名称改为“待发布草稿”，而不是云端 AI 项目。`creator_generation_jobs` 表保留为已部署兼容结构，当前不注册生成服务或公开生成 API；未来只有在确实需要记录 Agent 候选修订时才重新设计用途。

## 6. 当前实现保留与停用

保留：

- `creator_drafts`、不可变修订和乐观并发；
- Bingo 结构化数据模型；
- Bingo 固定编译器；
- 隔离 iframe 预览；
- Work、Upload、Validator、Release 和 Runtime 链路；
- Agent 提交后的只读隔离预览和发布确认。

停用：

- 平台内 `structured-template-v1` 生成引擎；
- `/v1/creator/drafts/{draftId}/generations*` API；
- 平台生成次数、并发生成和模型用量产品设计；
- “AI 创作工坊”“平台帮你生成”的入口与承诺。

数据库迁移不回滚，不删除已存在的生成记录。代码和接口停用不等于破坏历史数据。

## 7. 发布认证与密钥边界

模型 Key 和平台登录凭据是两类秘密：

- 模型 Key 只由本机 Agent 使用，平台永远不需要它；
- 平台登录 token 由 Agent 的系统凭据存储保存，只用于提交和查询自己的草稿；
- 创作包、日志、浏览器 iframe、作品 ZIP 和公开 Release 中禁止出现任何凭据；
- 游戏运行时不能调用创作草稿 API，也不能读取 Agent 主机凭据。

后续 Agent 发布入口应使用设备授权或现有宿主登录桥，不要求用户把平台 token 写入项目文件。

当前实现已经复用两种现有安全存储：VS Code / Cursor 使用 `SecretStorage`；Harness、Codex 与 Claude Code 的便携发布命令使用 Git Credential Manager。没有现成登录态时，便携命令启动 GitHub 设备授权，只显示一次性 URL 与代码。提交命令不接受 token、secret 或 key 参数，也不会从创作包读取凭据。

## 8. 分阶段实施

### P0：方向收敛（已完成）

- 将网站文案改为 Agent-first；
- 移除平台内生成按钮、服务注册和公开 API；
- 保留待发布草稿、只读预览和发布闭环，移除平台内 Bingo 编辑入口；
- 增加 Bingo、Bitsy、PuzzleScript、Twine 和像素素材的 Agent 可读工具目录；
- 增加创作包 v1 模板、校验命令与自动测试。

### P1：Agent 本地工具服务（本次）

- 便携插件内置版本化工具目录与 `creator-toolkit` 命令；
- `list/show/prompt` 让 Agent 直接读取能力与任务约定，无需用户手工打开外部编辑器；
- `doctor <目录>` 在本地检查入口、体积、可执行文件、明显凭据、本机路径和远程运行依赖；
- 网站只负责解释本地工作流、复制 Agent 任务和接收完成后的成品；
- 下载、安装或执行第三方程序，以及登录、上传和发布，全部要求用户明确授权。

### P2：Agent 提交通道（已完成首个可用切片）

- 已增加“读取 manifest → 本地校验 → 创建草稿”的共享提交核心；
- VS Code / Cursor 提供“GameHub: 提交当前创作包”命令，使用已有侧栏登录态和 `SecretStorage`；
- Harness / 本地命令提供 `npm run creator:submit -- <目录>`，只从 Git Credential Manager 读取登录态；
- Codex / Claude Code 便携插件包含同一发布器与官方 Bingo 模板，Agent 可在用户授权后复制模板、编辑并提交；
- 服务端不信任本地报告，会重新规范化和校验 Bingo 内容；
- 提交成功返回草稿 ID 和可打开的草稿地址，且不会自动公开；
- 首次提交后，本地 `.gamehub/draft.json` 只保存草稿 ID、revision、平台 origin 和内容摘要，不保存 token；
- 再次提交会读取远端 revision 并更新同一草稿，内容未变化时不产生空修订；检测到网页端新修订时停止，不做静默覆盖。

完成条件：用户能在任意 Agent 中修改官方模板，通过一条命令得到平台待发布草稿，并在网页确认发布。

### P3：更多结构化类型

按照真实需求逐个增加 `puzzle`、`story`、`world` schema 和固定编译器。每种类型必须先具备：

1. 可版本化的结构化源格式；
2. 无网络、无任意脚本的固定编译器；
3. 本地与服务端一致的核心校验；
4. 可重复构建测试；
5. 许可证和来源记录。

不再以“上线一个网页编辑器”作为类型完成标准。

## 9. 验收标准

- 平台服务不包含模型供应商密钥，也没有按模型产生的平台费用；
- 官方 Bingo 创作包通过本地校验，路径穿越和越界单元格被拒绝；
- 平台内不存在可触发模型或模板生成的公开入口；
- Bingo 待发布草稿可只读预览、构建并发布，修改必须回到原创作端；
- 平台创作页不再出现第二套 Bingo 编辑器；
- Agent 能读取 Bingo、Bitsy、PuzzleScript、Twine 和像素素材的版本化能力说明；
- Bitsy、PuzzleScript 和 Twine 的本地结果有明确的 Doctor 与 Web ZIP 发布路径，像素素材被明确标记为非独立作品；
- 浏览器页不把外部站点伪装成平台工具，也不要求用户手工掌握第三方编辑器；
- 已部署数据库无需降级，历史发布版本不受影响；
- 新类型只能通过结构化协议和固定编译器进入平台。
