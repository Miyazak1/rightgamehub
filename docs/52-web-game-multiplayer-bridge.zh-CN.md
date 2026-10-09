# Web 游戏多人安全桥（v1）

更新日期：2026-09-30。

## 1. 结论

GameHub 的 Web ZIP 继续运行在无平台凭据、默认无外网的隔离 iframe 中。声明并通过 `multiplayer` 能力检查的版本，由可信播放器在父页面建立 `MessageChannel`，把有限的玩家身份、房间和权威对局操作桥接给游戏。访问令牌、realtime ticket、WebSocket 地址及刷新凭据始终留在父页面。

协议标识为 `gamehub.web-game.v1`，当前版本为 `1`。作者侧入口包是 `@gamehub/web-game-sdk`；父页面实现位于 `@gamehub/platform-client/web-game-multiplayer-host`。

这不是任意 HTTP 代理。游戏不能借此请求任意 URL、读取邮箱、取得 token、打开文件或执行本机命令。

## 2. 信任边界

```text
隔离 Web 游戏
  └─ @gamehub/web-game-sdk（无 token）
       └─ 专属 MessagePort + nonce + v1 schema
            └─ 可信 PlayerCore / host bridge
                 ├─ Platform API client（Bearer 留在父页面）
                 └─ Realtime session（ticket 与 WebSocket 留在父页面）
```

- 父页面只接受 `event.source === 当前游戏 iframe.contentWindow` 的握手。
- 每次握手创建新端口；旧端口立即关闭。播放器停止或销毁时释放端口和 realtime 会话。
- 单条请求最大 32 KiB，只接受白名单方法、UUID 请求号和对象参数。
- 房间、模式和对局按当前 `workId` 限定；加入房间时服务端再次核对 `modeId`，不能用其他游戏的房间 ID 越界加入。
- `player.get` 仅返回 `id`、`displayName`、`avatar`；不返回邮箱、角色、认证状态或凭据。
- 对局命令由服务端规则适配器校验并生成事件，客户端结果不作为胜负或积分依据。

## 3. 发布能力

需要联机能力的 Web ZIP 在根目录提供：

```json
{
  "version": 1,
  "entry": "index.html",
  "capabilities": ["multiplayer"]
}
```

校验器目前允许 `fullscreen`、`pointerLock` 和 `multiplayer`。只有发布描述返回 `capabilities.multiplayer: true` 时 PlayerCore 才会创建桥；普通单机游戏不会建立身份或实时通道。

## 4. v1 方法面

| SDK 调用 | 桥方法 | 说明 |
| --- | --- | --- |
| `getPlayer()` | `player.get` | 取得最小公开玩家资料 |
| `multiplayer.listModes()` | `multiplayer.modes.list` | 只列出当前作品已启用模式 |
| `rooms.list(modeId)` | `multiplayer.rooms.list` | 列公开房间 |
| `rooms.create(input)` | `multiplayer.rooms.create` | 创建公开或邀请房间 |
| `rooms.get(roomId)` | `multiplayer.rooms.get` | 读取并纳入本次作用域 |
| `rooms.join(roomId, modeId, joinCode?)` | `multiplayer.rooms.join` | 以作品模式约束加入 |
| `rooms.leave/ready/start` | 对应 room 方法 | 房间生命周期 |
| `multiplayer.connect/disconnect()` | realtime 方法 | 建立或释放实时会话 |
| `rooms.subscribe/unsubscribe` | room 订阅方法 | 房间快照与状态 |
| `matches.subscribe/unsubscribe` | match 订阅方法 | 对局快照、增量与终局 |
| `matches.command(matchId, command)` | `multiplayer.matches.command` | 提交规则命令 |
| `matches.resign(matchId)` | `multiplayer.matches.resign` | 认输 |

事件包括 `multiplayer.status`、`multiplayer.room`、`multiplayer.match`、`multiplayer.match.event`、`multiplayer.match.terminal`、`multiplayer.match.started` 和 `multiplayer.error`。

## 5. 典型时序

1. 游戏调用 `connect()` 完成桥握手。
2. 调用 `listModes()`，选择当前作品的模式。
3. 创建或列出并加入房间，再建立 realtime 并订阅房间。
4. 玩家准备；房主启动后，房间频道广播 `multiplayer.match.started`，其中含 `matchId`。
5. 双方订阅对局，先接收权威快照，再根据 `revision` 提交命令。
6. 断线由父页面会话自动换取新 ticket 并恢复订阅；游戏根据新快照覆盖本地预测状态。
7. 终局以服务端 `multiplayer.match.terminal` 为准。

## 6. 当前边界

- 本增量完成通用 Web 游戏桥、作用域保护和 SDK 契约，不包含某款游戏的规则。
- 服务端规则适配器仍由受信部署代码注册；不能由作者 ZIP 动态上传并在服务器直接执行。
- 自动匹配、赛季积分和排行榜是后续平台增量；房间与权威对局不依赖这些功能。
- Windows 原生游戏不能使用浏览器 MessageChannel；以后使用同一业务语义的本机 Agent 通道，不把 Web bridge 直接暴露到进程外。

## 7. 验收

- 无 `multiplayer` 能力的版本不创建 bridge。
- 游戏只能看到精简身份，无法读取 token 或 realtime ticket。
- 跨作品 mode/room 被拒绝。
- 房间启动后参与者收到同一 `matchId`。
- 重连后可恢复房间和对局订阅；播放器退出后端口及 socket 被释放。
- API、Web 和生产镜像均能在 frozen lockfile 下构建。


2026-10-09 更新：通用桥也支持独立声明的 fileExport/shareLinks；最新能力列表与隔离约束见 [文件导出与分享指南](game-file-export-share-links.zh-CN.md)。只声明这些能力的游戏也会创建桥。
