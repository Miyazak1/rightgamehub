# 联网 SDK、事件与错误参考

## 客户端方法

入口：`createGameHubClient()`。先 `connect()`，再调用 `getPlayer()`；多人对象提供 `listModes()`、`connect()`、`disconnect()`，以及 `rooms.list/create/get/join/leave/ready/start/subscribe/unsubscribe` 和 `matches.subscribe/unsubscribe/command/resign`。

`rooms.join(roomId, modeId, joinCode?)` 必须同时提供当前作品返回的 modeId。`matches.command(matchId, command)` 只提交游戏意图；客户端不能提交 winner、eventSeq、服务端时间或完整新局面。

## 事件

- `multiplayer.status`：`connecting`、`connected`、`reconnecting`、`closed`。
- `multiplayer.room`：权威房间快照。
- `multiplayer.match.started`：房间开始后给出同一 matchId。
- `multiplayer.match`：对局、当前玩家裁剪后的 snapshot 与增量事件。
- `multiplayer.match.event`：已提交的权威事件。
- `multiplayer.match.terminal`：完成或中止；客户端不得自行伪造。
- `multiplayer.error`：桥、作用域、revision 或规则拒绝。

## 常见错误

`MODE_NOT_ALLOWED` 表示跨作品或未启用模式；`REVISION_CONFLICT` 表示本地基线过旧，应重新订阅；`NOT_YOUR_TURN` 由规则拒绝；`BRIDGE_TIMEOUT` 表示父页面通道未按时响应；`RULESET_NOT_AVAILABLE` 表示平台尚未安装受信规则，管理员不能先注册模式。

桥请求最大 32 KiB；realtime 消息最大 16 KiB。完整协议方法白名单以 `packages/web-game-sdk/src/protocol.mjs` 为准，实时消息类型以 `packages/multiplayer-protocol/src/index.mjs` 为准。
