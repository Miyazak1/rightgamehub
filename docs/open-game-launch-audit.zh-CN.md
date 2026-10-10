# GameHub 首批开放游戏上线验收台账

状态：首轮公开数据核对完成，内容与人工试玩验收进行中

更新日期：2026-10-10

本台账用于决定哪些作品可以进入 GameHub “开放游戏计划”的首批推广。当前公开目录已有 14 款作品，数量达到 O1 的 10—20 款目标；13 款远程作品的启动描述和入口首页均返回 HTTP 200，“猜百科”按设计由平台内置运行，不依赖远程 Release。这个结果只证明公开入口可达，不证明玩法、移动端、声音、存档、素材权利或作者关系已经验收。

当前不能宣布 O1 内容验收完成。发布关系已经由管理员在生产后台修正，线上现有 9 款社区收录作品均显示未认领并可认领。公开数据仍有两类必须处理的问题：两款仓库没有可检测的许可证文件但平台标记为 MIT；`2048` 标记为 GitHub 导入却没有公开固定 Commit。

## 验收状态定义

| 状态 | 含义 | 是否可进入首批推广 |
| --- | --- | --- |
| 来源初审通过 | 仓库、许可证和发布关系没有发现公开数据冲突，仍需人工试玩与素材检查 | 条件通过 |
| 待补内部证据 | 没有公开仓库，需由发布者提供作者身份、素材来源或授权记录 | 否 |
| 待修正 | 公开字段之间存在冲突，或缺少固定来源、上游署名 | 否 |
| 阻塞 | 当前许可证或发布关系可能误导用户，修正前不得作为开放游戏推广 | 否 |
| 不进入首批 | 测试作品或运营定位不符合首批精选标准 | 否 |

## 首轮作品台账

| 作品 | 线上运行证据 | 公开来源证据 | 初审状态 | 下一步 |
| --- | --- | --- | --- | --- |
| 猜百科 | 平台内置；目录标记公开；远程启动接口按设计返回 `BUILT_IN_GAME` | 平台官方，无外部仓库 | 待补内部证据 | 核对题库来源、内容许可、桌面与移动端完整玩法 |
| 2048 | Release 入口 HTTP 200 | [Miyazak1/2048](https://github.com/Miyazak1/2048)，Fork，MIT；社区收录、未认领；平台标记 GitHub 导入但未返回固定 Commit | 待修正 | 补齐当前 Release 对应 Commit，明确上游项目和修改关系 |
| OI 重开模拟器 | Release 入口 HTTP 200 | [Miyazak1/oi-remake-game](https://github.com/Miyazak1/oi-remake-game)，Fork，MIT；固定 Commit `d5264cc16a4ec7f193260b0e049c9884573fd848` | 来源初审通过 | 核对上游署名与素材，完成人工玩法验收 |
| 年代排排看 | Release 入口 HTTP 200 | [tom-james-watson/wikitrivia](https://github.com/tom-james-watson/wikitrivia)，MIT；社区收录、未认领 | 来源初审通过 | 记录 ZIP 实际取材版本；完成人工试玩后邀请作者认领 |
| 一笔成蛇 | Release 入口 HTTP 200 | [hithismani/finger-snake](https://github.com/hithismani/finger-snake)，MIT；社区收录、未认领 | 来源初审通过 | 记录 ZIP 实际取材版本；完成人工试玩后邀请作者认领 |
| 你画 AI 猜 | Release 入口 HTTP 200 | [qw486759/quick-draw-game](https://github.com/qw486759/quick-draw-game)；社区收录、未认领；仓库没有可检测的许可证文件，平台当前标记 MIT | 阻塞 | 获得作者授权或可核查许可证；在此之前移除 MIT、开放源码和可二创承诺 |
| 0hh1填格游戏 | Release 入口 HTTP 200 | [florisluiten/0hh1](https://github.com/florisluiten/0hh1)，MIT；社区收录、未认领 | 来源初审通过 | 记录 ZIP 实际取材版本，完成人工玩法与素材验收 |
| 宝石回放 | Release 入口 HTTP 200 | [ErickPetru/js13k-jewelsback](https://github.com/ErickPetru/js13k-jewelsback)，MIT；社区收录、未认领 | 来源初审通过 | 记录 ZIP 实际取材版本，完成人工玩法与素材验收 |
| 全员答题中 | Release 入口 HTTP 200 | [yobin-tim/quiz-runner](https://github.com/yobin-tim/quiz-runner)，MIT；社区收录、未认领 | 来源初审通过 | 记录 ZIP 实际取材版本，完成人工玩法与素材验收 |
| HexGL赛车 | Release 入口 HTTP 200 | [BKcore/HexGL](https://github.com/BKcore/HexGL)，MIT；社区收录、未认领 | 来源初审通过 | 记录 ZIP 实际取材版本；核对仓库内音频等第三方素材许可证 |
| Orbital Order | Release 入口 HTTP 200 | [aftongauntlett/js13k-demo](https://github.com/aftongauntlett/js13k-demo)；社区收录、未认领；仓库没有可检测的许可证文件，平台当前标记 MIT | 阻塞 | 核实作者授权与许可证；授权明确前移除 MIT、开放源码和可二创承诺 |
| 桌猫 | Release 入口 HTTP 200 | 发布者 ZIP 上传，无公开仓库和开放许可 | 待补内部证据 | 保存原创或授权声明、素材清单，完成存档和移动端边界验收 |
| Bingo Platform | Release 入口 HTTP 200 | 发布者 ZIP 上传，无公开仓库和开放许可 | 待补内部证据 | 保存原创或授权声明、素材清单，完成创建与游玩流程验收 |
| 迷阵 | Release 入口 HTTP 200 | 发布者 ZIP 上传，无公开仓库和开放许可；简介明确为联机测试作品 | 不进入首批 | 保留为测试作品并排除推广，或补齐正式名称、玩法说明和权利资料后重新评估 |

## 公开仓库版本快照

下表记录 2026-10-10 核对时各仓库默认分支的最新 Commit，用于调查，不表示线上 ZIP 与该 Commit 一致。只有平台 Release 来源证明返回的 Commit 才能作为线上版本的固定来源。

| 仓库 | 默认分支 | 核对时最新 Commit | 许可证文件 |
| --- | --- | --- | --- |
| `qw486759/quick-draw-game` | `main` | `d02f5543e747dd76e01c9d824b5e4a61a66472a4` | 未发现 |
| `tom-james-watson/wikitrivia` | `master` | `18d12eb3e305ecce56bac5d8b3cc5939f70d7856` | `LICENSE.md`，MIT |
| `hithismani/finger-snake` | `main` | `bb50eeedefe64aa6385b40b48f17d451afc2967c` | `LICENSE`，MIT |
| `yobin-tim/quiz-runner` | `main` | `56eb84028f6c5df849d353a2469d362333651ea6` | `LICENSE`，MIT |
| `aftongauntlett/js13k-demo` | `main` | `3d9fe2af2384b04404266b50805d8cd896a5dab8` | 未发现 |
| `florisluiten/0hh1` | `master` | `25910e580d6ea6bc1dfbfd29b2637e47844a96f9` | `LICENSE`，MIT |
| `ErickPetru/js13k-jewelsback` | `master` | `4bf9b434c83feeb9265b3e8cced0e1bbbcd414b9` | `LICENSE`，MIT |
| `BKcore/HexGL` | `master` | `6addc95a2fce3bf05f4d751823cc054c61a16d68` | 根目录与音频目录均有许可证文件 |
| `Miyazak1/2048` | `master` | `478b6ec346e3787f589e4af751378d06ded4cbbc` | `LICENSE.txt`，MIT |
| `Miyazak1/oi-remake-game` | `main` | `d5264cc16a4ec7f193260b0e049c9884573fd848` | `LICENSE`，MIT |

## 每款作品必须完成的人工验收

人工验收使用当前线上 Release，不使用仓库演示站代替。每项记录测试日期、浏览器或设备、结果和问题链接。

1. 从作品详情点击“立即游玩”，首次加载和刷新均成功；控制台没有阻塞性错误。
2. 在三分钟内能够理解目标、完成至少一轮核心玩法，并能正常重新开始或退出。
3. 键盘、鼠标、触控、声音和全屏按作品声明验证；不支持的能力要在玩法说明中写清楚。
4. 390 px 手机宽度没有横向溢出、不可点击控件或被遮挡的核心内容；明确不支持移动端的作品不得标记为移动端可玩。
5. 本地存档、刷新恢复、清档行为和版本升级边界与作品说明一致；没有存档能力时不得暗示云端保存。
6. 检查运行时外部请求、第三方脚本、字体、音频、图片和模型来源；未声明的网络权限或素材权利问题直接阻塞。
7. 作品标题、作者、仓库、许可证、来源方式、发布关系和认领状态与后台记录一致。
8. ZIP 上传且关联仓库的作品明确显示仓库仅为参考来源，除非能证明当前 Release 对应固定 Commit。

## 修正顺序

### P0 来源和许可证

1. 处理 `你画 AI 猜`、`Orbital Order` 的 MIT 标注与公开仓库证据不一致问题。
2. 修复 `2048` GitHub 导入 Release 缺少固定 Commit 的问题，并补充上游署名。

生产后台已经将第三方策展作品统一修正为社区收录。2026-10-10 再次读取公开目录时，9 款社区收录作品均为 `unclaimed` 且 `claimEligible=true`，发布关系修正项已完成。

### P1 人工玩法和素材验收

从“来源初审通过”的作品开始，优先完成 `OI 重开模拟器`、`年代排排看`、`一笔成蛇`、`0hh1填格游戏`、`宝石回放`、`全员答题中` 和 `HexGL赛车`。每完成一款，再从已修正或已补证的作品中补入，直到至少 10 款全部通过。

### P2 作者邀请和推广准备

只有许可证、素材、运行和发布关系全部通过后，才向社区收录作品的作者发送认领邀请。邀请材料必须包含线上体验链接、当前固定或参考版本、平台做过的修改、下架方式和认领后的权限。

## O1 放行条件

O1 内容验收完成需要同时满足：

- 至少 10 款作品通过全部人工验收；
- 每款通过作品的作者或发布关系、许可证和素材来源可以核查；
- GitHub 导入作品的线上 Release 能追溯到固定 Commit；
- ZIP 上传作品不把仓库默认分支误称为线上固定版本；
- 所有社区收录作品显示未认领、审核中或已认领，不显示为平台作者原创；
- 发现页桌面和移动端筛选、来源标签及认领入口完成线上冒烟测试；
- 阻塞作品不进入首页推荐、专题推广和作者联合发布。

## 核对证据边界

- 线上目录：`GET https://mooyu.fun/v1/works?limit=50`，核对日期 2026-10-10。
- 线上启动：13 款远程作品的 `GET /v1/works/{workId}/launch` 和返回入口首页均为 HTTP 200；“猜百科”返回预期的 `BUILT_IN_GAME`。
- 仓库证据：GitHub 官方仓库元数据、默认分支 Commit 和仓库文件树，核对日期 2026-10-10。
- 未执行：完整交互玩法、移动端触控、声音、存档、所有素材权利和真实作者授权核验。这些项目必须由人工验收记录补齐，不能由 HTTP 200 或仓库许可证自动代替。
