# 游戏排行榜接入 v1

排行榜是按发布清单启用的平台能力。Web ZIP 和 GitHub 静态构建产物使用同一份 `platform.json`；网页、Cursor / VS Code 和 Harness 共用宿主与 SDK。独立 Windows EXE 暂未提供对应客户端宿主。

## 从模板开始

在创作中心选择「让 AI 添加排行榜」可生成任务说明；如需自行接入，进入「技术文档与官方模板」下载 `gamehub-competition-score-template.zip`。解压后包含可编辑的 `game.js`、`index.html`、`platform.json`、浏览器版 `gamehub-sdk.js` 和本说明。修改完成后将这些文件放在 ZIP 根目录上传，不必给平台增加作品白名单。

本仓库开发者执行 `node scripts/build-competition-template.mjs` 生成同一模板。带打包工具的工程也可以直接引用工作区 `@gamehub/web-game-sdk`；这里不要求从公共 npm 安装尚未发布的包。

## 声明指标

```json
{
  "version": 1,
  "entry": "index.html",
  "capabilities": ["competition"],
  "competition": {
    "version": 1,
    "boards": [{
      "key": "best-score",
      "modeKey": "classic",
      "title": "经典高分榜",
      "rulesetVersion": 1,
      "period": "all-time",
      "verification": "client_reported",
      "metrics": [
        {"key": "score", "label": "得分", "unit": "分", "min": 0, "max": 1000000},
        {"key": "moves", "label": "步数", "unit": "步", "min": 1, "max": 10000}
      ],
      "ranking": [
        {"metric": "score", "direction": "desc"},
        {"metric": "moves", "direction": "asc"}
      ]
    }]
  }
}
```

- 每个发布版本最多 3 张榜，每榜 1–4 个整数指标；整数绝对值不超过 10^12，并受声明的 min / max 约束。
- key 和 modeKey 使用小写英文字母开头，可含数字与短横线，最长 48 字符。
- 按 ranking 的顺序比较：asc 越小越好，desc 越大越好。完全同分按平台接受时间、运行 ID 确定顺序。
- `all-time` 是当前规则的总榜，`daily` 是北京时间日榜。每位玩家只保留该榜该周期的最佳成绩。
- 每个作品独立保存定义。相同 key / rulesetVersion 的声明必须完全一致；修改指标、规则、顺序或验证器时递增 rulesetVersion。新旧版本不混排。
- ZIP 校验通过后，由平台的受控策略建立发布授权；游戏不能上传用户 ID、榜单内部 UUID、角色、SQL、比较函数或服务端代码来获取权限。

## 开始、提交与重试

直接用模板自带浏览器 SDK：

```html
<script src="gamehub-sdk.js"></script>
<script type="module">
const gamehub = GameHubSDK.createGameHubClient();
const boards = await gamehub.competition.listBoards();
const board = boards.find(item => item.key === 'best-score');
const requestId = crypto.randomUUID(); // 网络重试必须复用
const run = await gamehub.competition.start({boardId: board.id, requestId});

// 在游戏真正结束时提交；直到确认前不要改变本局的提交内容。
const submission = {metrics: {score: 1200, moves: 40}};
const result = await gamehub.competition.finish(run.id, submission);
if (result.status === 'accepted') console.log('已保存', result.metrics);
</script>
```

申请运行需要登录；游客仍可自由游玩和查看公开榜单。会话令牌仅存在可信宿主中，游戏 iframe 不接触平台账号令牌。作品、发布版本和 preview / production 渠道由服务端绑定。

`start` 重复请求返回同一运行；同一个 requestId 改绑别的榜单会冲突。`finish` 对同一局同一内容重试只记一次，修改已提交内容会返回冲突。遇到网络超时应重试原请求，也可调用 `competition.get(run.id)` 查询。用户主动放弃时调用 `competition.abandon(run.id)`。

运行最长 2 小时；日榜运行最晚在当天北京时间午夜截止，不允许把旧局提交进新一天。每个账号每小时最多申请 60 局。preview 运行可以验证和查看回执，但不写入公开榜。

未开放能力、账号退出、作品撤下、版本停用和授权撤回均可能终止提交；请展示错误并保留自由游玩入口，不要把失败显示为“已经上榜”。

## 休闲榜与回放验证榜

`client_reported` 校验指标形状、范围、身份、频率和幂等，界面标记为休闲榜；不证明分数真实。

`replay_verified` 当前只开放平台固定 `tile-merge-v1` 验证器。它是 4×4 的 2048 合并规则与固定 Mulberry32 随机算法，指标允许 `score`、`max-tile`、`moves`。参考配置和接入源码见 `samples/competition-2048/`，规则在 `packages/competition-rules/tile-merge-v1.mjs`。

```js
await gamehub.competition.finish(run.id, {
  evidence: {format: 'tile-merge-v1', moves: 'LURD'}
});
```

使用平台签发的 run.seed 初始化游戏，只记录改变棋盘的有效移动，最多 8192 个方向。平台复算指标，非法动作或与自报指标不一致会被拒绝。完整种子会暴露未来随机序列，因此“规则回放已验证”不表示真人操作、强反作弊或实时公平。全新玩法可以先接休闲榜；需要已验证榜时必须增加经过平台审阅的验证器，上传任意代码不会自动启用。

## 查询、展示与隐私

详情页从 `GET /v1/works/{workId}/leaderboards` 获取定义，并通过 `GET /v1/works/{workId}/leaderboards/{boardId}` 获取成绩。页面自动适配指标数量、排序文案、周期、本人名次和分页。未声明榜单的游戏不显示空占位。

查询支持 limit（1–50）、offset、日榜 date；数据不缓存。SDK 内的 `competition.leaderboard(boardId,{limit,offset,date})` 单次最多返回 10 人，以保持桥消息大小有界。公开榜仅展示活跃账号的公开成绩，遵守双向屏蔽；未公开的本人最佳成绩仍可见，但没有公开名次。

猜百科通过兼容适配保留旧日榜和题目隔离；旧成绩仍标为休闲榜。它不为新游戏定义核心字段。

## 运维与当前范围

- 迁移为 `0053_competition_boards.sql`；成绩与云存档独立，云存档保持关闭也可以上榜。
- 不新增服务。当前仅运行平台自带、输入有界的回放算法；每次 finish 的 JSON 最大 16 KiB。
- 全平台运行记录上限 20,000 条，达到时暂停签发新局，保留已签发局提交、榜单读取与自由游玩。该上限是小服务器首期保护，不代表已证明任意规模负载可承载。
- 复用现有 worker，每分钟最多清理 200 份超过 7 天的原始回放、200 条过期超过 1 天的未完成/放弃运行。已接受的指标、提交摘要、最佳成绩和治理记录保留；原始回放过期后不能再从动作复算。
- 管理员可调用 `/v1/admin/competition/runs/{runId}/decision`，以 invalidate / restore 和必填理由作废或恢复成绩；平台从保留的成绩记录重新选择该玩家最佳值并记录审计。
- 这版完成声明、发布绑定、运行、成绩、查询、SDK 和动态展示。团队榜、Elo、关注榜、自己附近、任意验证器源码审核、异步重算任务和独立 Windows 宿主仍是后续能力。

## 2048 现有作品升级

接入包基于 `Miyazak1/2048` 的固定提交 `478b6ec346e3787f589e4af751378d06ded4cbbc`，保留 MIT 许可和作者署名。`scripts/build-competition-2048.mjs` 生成并校验包，`apps/api/bundled/2048-competition-v1.json` 保存来源与 SHA-256。

部署脚本通过原有上传/配额/隔离校验流程为现有作品发布新版本，保留旧版本及其 ID。排行挑战另起一局，返回自由模式时恢复进入挑战前的棋盘。自由模式沿用原游戏存储逻辑；正式运行沙箱禁止 iframe localStorage，原游戏会使用仅当前页面有效的内存存储，因此这次接入不承诺 2048 刷新续玩。需要持久本机存档时应另外接入平台 `localSave`，不能放宽沙箱权限。平台已有游戏的本机存档和关闭云存档的设置不受影响。未来直接从未改造的上游源码重新发布时，需保留此 SDK 接入代码和 platform.json。
