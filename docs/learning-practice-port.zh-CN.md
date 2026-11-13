# 墨鱼解题与练习：独立数学练习接入

实现分支：`codex/learning-practice-port`，Right 基线为 `40eeb87099f55c0a5400e0244c384c519667bb5b`（`codex/agent-account-integration`）。根目录旧分支和其他工作树的未提交修改不属于本次接入。

源项目为 Moodlelike，固定提交 `a144ae0e7b8e9bb3e832819bfa546ec6e4bdbbe4`（`codex/math143-student-release`）。界面、布局、交互和 CSS 使用墨鱼风格重新实现，没有引入源站 Agent 页面或 CSS。复用范围为冻结数学引擎、经过核验的图示适配及公式排版逻辑；练习服务适配为 Right 的 Fastify、PostgreSQL 和账号。

## 产品范围

- 学习 → 解题与练习 → 数学练习；独立路由 `/learn/practice` 和 `/learn/practice/:batchId`。
- 12 个原生数学知识点、基础/中等/困难、3/5/10 题、中英文题目。
- 准备状态和实际等待时间、答案自动保存、刷新恢复、服务端核对、提交确认、完整解析与图示、错题回顾、练习历史和知识点作答统计。
- 每个批次固定参数；下一批继承知识点、难度、题量和语言。通过已曝光的数学身份排除重复题目，不只比较题目数据库 ID。
- 当前是普通数学选择题练习，不是任意拍题解答、主观题步骤评分、独立诊断或考试测量。正确率不被命名为实测掌握度。
- 没有导入源站生产用户、历史作答或旧题库。空间坐标没有冻结生成范围，因此不冒充可生成知识点；物理、化学处于筹备状态。

## 可扩展目录

`packages/practice-core/src/catalog.mjs` 保留学科、课程体系、学段、知识点、难度和题型的独立 ID。沿用课件 `primary`、`lower-secondary`、`upper-secondary`、`higher-education` 编码。CSCA 目前没有完成逐项学段标注，因此它的 `stageIds` 为空，界面不会把题目擅自归到小学或大学。

新增学科时提供服务端能力适配器（`capabilities()`、`generate(config)`），返回被验证的私有题目文档。随后注册课程/知识点及真正支持的难度、题型与学段。课程标准和知识图谱应通过显式映射连接，不能按中文标题推断。当前播放器与评分只开放单选题；其他题型必须配套评分和显示契约后再开放。

## 服务端边界

- 固定归档：`artifacts/math-lab/csca-math-lab-1.43.0.zip`，SHA256 `10b51845d51093711050d3fbd290ca73e78b6a094d0e8bd74fab1096df0fd3a2`。
- `question-engine/math-v143` 安装入口校验归档和 1,152 个运行文件，恢复到被忽略的 `.local/math-lab/1.43.0`；不要编辑冻结文件。需要 Node `>=22.16 <23`。
- worker 不继承服务端数据库和 Provider 凭据，禁止 HTTP 出网，并有队列、超时与内存限制。Mooyu worker 额外构造按答题/复盘阶段绑定的图示，不修改冻结算法。
- `apps/api/src/practice/engine.mjs` 重新校验 cell、scope、seed、Oracle、solver、admission 和题型，建立内容版本与数学身份。
- 发布事务保存核验证据与题目私有答案、预约用户曝光，再将批次置为 ready。浏览器只能收到明确白名单字段；未核对的题目不返回答案、解析、源证据或复盘图示。
- 新增迁移 `0117_learning_practice.sql`：私有题目、批次、曝光。用户使用 Right 的 UUID 与 bearer 认证，不接受客户端指定用户。
- 批次 JSONB 包含不可变题目快照、选项保存、核对状态和用时。批次完成后的汇总和错题由持久化作答计算，重复提交不重复累计。
- 准备任务在批次表中持久化，使用租约令牌、90 秒租期、20 秒续租、过期重领和有限崩溃恢复。重启 API 后可以恢复；题目生成在数据库事务外进行。提交和修改使用行锁与 revision；续批通过 previous_id 唯一约束避免重复。
- `PRACTICE_ENABLED=false` 暂停新增生成；已准备练习与历史记录仍可读取。该开关通过 Compose 环境显式传递。

API 的请求、返回类型和 OpenAPI 位于 `packages/contracts/src/practice-schema.mjs` 及 generated 目录；客户端方法沿用平台认证和刷新逻辑。

## 开发与验证

```powershell
pnpm install --frozen-lockfile
npm run practice:setup
npm run practice:test:engine
npm run test:practice
pnpm --filter @gamehub/web build
```

`test:practice` 没有设置测试库时只运行无数据库检查。完整链路必须指定专用本机库，脚本拒绝其他数据库名或非本机地址；不读取 `.env`：

```powershell
docker run -d --name mooyu-practice-acceptance `
  -e POSTGRES_PASSWORD=practice_local_test -e POSTGRES_DB=mooyu_practice_acceptance `
  -p 127.0.0.1:55438:5432 postgres:16-alpine
$env:PRACTICE_TEST_DATABASE_URL='postgresql://postgres:practice_local_test@127.0.0.1:55438/mooyu_practice_acceptance'
npm run test:practice
npm run practice:dev
```

浏览器验收地址为 `http://127.0.0.1:4188/#/learn/practice`。这个启动器只绑定本机，使用独立 `practice_review` schema 和固定验收账号；它不是生产认证入口，也不能用于公网部署。真实平台由 `createRuntime` 接入正式认证、迁移和练习 worker。

验收覆盖：真实冻结引擎、答案与解析保密、用户隔离、保存恢复、revision 冲突、核对后答案锁定、提交与续批幂等、数学身份去重、任务租约恢复及错题统计。旧平台 API、契约、迁移和学习入口需保持回归通过。浏览器检查覆盖数学公式、核验图示、开始等待、答题、复盘、续批与手机宽度。

## 构建与发布

API Dockerfile 在镜像构建时安装并核验冻结引擎，运行时不依赖源项目路径或主机缓存。归档只进入服务端镜像，不进入 Web 静态资源。Web 使用 KaTeX 的本地字体；Webview 的 CSS 打包器内嵌字体，保持离线显示。

本次不部署正式站，不迁移源站数据库。发布前应按本项目既有流程应用 0117、构建 API/Web，使用当前平台账号完成一次真实开始、保存、提交和续批验收；不要在根目录旧分支上直接切换或覆盖正在修改的文件。

## 本次验收记录（2026-11-13）

- 冻结运行包和上游数学门禁：4 项通过。
- 专用 PostgreSQL + 真实出题完整链路：3 项通过，包括租约重领、重试配额、跨批数学身份去重和答前保密。
- 相关 API、契约、客户端、学习入口与迁移静态回归：90 项通过；该轮未设置数据库变量的一项数据库检查另行执行并通过。
- 完整 117 个迁移在专用空库应用、重复执行及原有用户/作品等链路回归通过。
- Web 生产构建、Harness 构建、API Linux 镜像构建通过。练习页面及 KaTeX 在 Web 中按需加载。
- Linux 断网容器：12 知识点 × 3 难度，36/36 真实出题与 Oracle 检查通过。
- 浏览器：开始准备、选择保存、刷新恢复、核对、切题、提交确认、评分复盘、续批、历史和错题回顾、学习入口、中英文界面均验证；390 和 320 像素宽度检查通过。长行内公式在自身范围滚动，不撑宽整个页面。
- 本机界面截图保存在 `.runtime/practice-review/practice-centre.jpg` 和 `mobile-question-320.jpg`，不提交测试数据或截图到正式资源目录。

构建仍有项目既有的大包体积提示和部分旧 i18n 重复键提示；本次构建未因此失败，也没有改动无关模块。

## 来源与授权

Moodlelike 为用户指定并授权本次内部移植的项目，源仓库是 source-available，并没有开源授权。其原始声明保留于 `question-engine/SOURCE-LICENSE.txt`。冻结归档中的第三方依赖和声明随归档保留；没有将整体项目或外部题库改标为 MIT。KaTeX 按依赖自带许可保留。若未来对外分发，应随交付保留各自来源与适用声明。
