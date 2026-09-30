# 服务端权威规则适配器教程

适配器身份由 `workId + modeKey + rulesetVersion` 唯一确定，导出必须实现：`createInitialState`、`getTurn`、`getPlayerView`、`getSpectatorView`、`serializeState`、`deserializeState`、`hashState`、`validateCommand`、`applyCommand`、`handleResign`、`handleTimeout`。

同一状态、命令、玩家、seed 与平台传入时间必须产生相同输出。禁止访问网络、文件、全局随机数或本机时钟。随机性只能来自平台记录的 seed；时间只能来自上下文的 `now`。

`validateCommand` 拒绝非当前玩家、越权字段和非法参数。`applyCommand` 返回新 state 与公开 event；event 不能泄露秘密命令参数。`handleResign` 与 `handleTimeout` 必须返回 `completed`、`result`、`terminationReason` 和每位玩家的 `playerResults`。

模板 `templates/multiplayer-turn-based/rules/adapter.cjs` 是可运行的极小示例。它用单文件 CommonJS 导出，内容摘要和 identity 会被 Creator Doctor 检查。平台审核后才在受控环境重新构建、计算 SHA-256、写入 `gamehub.rules-manifest.v1` 并离线 Ed25519 签名。

行为改变必须升级 rulesetVersion；不得替换同版本字节后重签。旧版本需保留到活动对局、回放和审计保留期结束。
