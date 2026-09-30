# GameHub 联机游戏作者接入指南

更新日期：2026-09-30。适用于发布为 Web ZIP、使用平台权威房间和对局服务的游戏设计者与开发者。

## 1. 开始前需要决定什么

作者需要定义“游戏规则”，不需要重做账号、房间、WebSocket、重连和回放基础设施。开始接入前准备：

- 模式名称、人数上下限、是否公开、是否需要邀请码；
- 初始状态、玩家可见状态、私密状态；
- 命令类型及参数，例如 `move`、`place`、`pass`；
- 合法性判断、状态转换、终局和超时行为；
- 确定性的规则版本号，以及旧对局如何继续回放。

规则适配器在服务端受信环境运行。不要把胜负、积分或计时只写在浏览器里，也不要让 Web ZIP 上传任意服务端脚本。

## 2. 包结构

```text
my-game.zip
├─ index.html
├─ assets/...
├─ game.js
└─ platform.json
```

`platform.json`：

```json
{
  "version": 1,
  "entry": "index.html",
  "capabilities": ["multiplayer"]
}
```

把 `@gamehub/web-game-sdk` 随构建工具打入本地产物。当前 SDK 以 GameHub 仓库 workspace 包提供；对外开放作者前必须发布带完整性校验的 SDK 制品或官方模板，作者不应复制私有协议实现。运行包不能依赖 CDN，也不能把 `node_modules` 原样当浏览器模块上传。可用 Vite、esbuild 或其他 bundler 生成自包含的 `game.js`。

## 3. 最小客户端

```js
import { createGameHubClient } from '@gamehub/web-game-sdk';

const gamehub = createGameHubClient();
const offStatus = gamehub.on('multiplayer.status', ({ status }) => {
  renderConnection(status);
});
const offRoom = gamehub.on('multiplayer.room', room => {
  renderLobby(room);
});
const offStarted = gamehub.on('multiplayer.match.started', match => {
  currentMatchId = match.id;
  gamehub.multiplayer.matches.subscribe(match.id, 0);
});
const offMatch = gamehub.on('multiplayer.match', ({ match, snapshot, events }) => {
  renderAuthoritativeState(match, snapshot, events);
});

await gamehub.connect();
const player = await gamehub.getPlayer();
const modes = await gamehub.multiplayer.listModes();
await gamehub.multiplayer.connect();

const room = await gamehub.multiplayer.rooms.create({
  modeId: modes[0].id,
  visibility: 'invite',
  capacity: 2
});
await gamehub.multiplayer.rooms.subscribe(room.id);
```

加入已有房间时必须同时传入该作品返回的 `modeId`：

```js
await gamehub.multiplayer.rooms.join(roomId, modeId, joinCode);
await gamehub.multiplayer.rooms.subscribe(roomId);
```

## 4. 命令与画面

客户端只发送意图，不提交新局面：

```js
await gamehub.multiplayer.matches.command(currentMatchId, {
  type: 'move',
  from: 'b2',
  to: 'b3'
});
```

正确模式是：

- 用户输入后可做短暂的视觉预测，但必须能被下一份权威快照覆盖；
- 不自行增加服务端 `revision`，不伪造事件序号或服务器时间；
- 命令失败时读取 `multiplayer.error`，恢复最后确认状态；
- 重连、切回页面或收到 revision 冲突后重新订阅同步；
- 动画与音效从事件派生，核心棋盘/牌局从权威状态派生。

不要在命令中放密码、token、完整聊天记录或大块二进制数据。单条桥请求上限为 32 KiB。

## 5. 隐藏信息

如果游戏含手牌、阵营或战争迷雾，规则适配器必须实现“按玩家生成视图”。平台把每名玩家应见的 snapshot/event 发给对应订阅者；浏览器不能先收到完整状态再用 CSS 隐藏。

回放也要明确公开、参与者可见或管理员可见范围。发布前用两个账号验证 A 看不到 B 的私密字段。

## 6. 断线与退出

- `multiplayer.status` 可能依次出现 `connecting`、`connected`、`reconnecting`、`closed`。
- 重连期间禁用不可安全重试的按钮，并显示轻量状态；不要判负。
- 命令 ID 和服务端幂等保证处理网络重试，但 UI 仍要防止用户重复点击。
- 页面退出时调用 `gamehub.close()`；平台也会在 PlayerCore 销毁时强制释放。
- 认输使用 `matches.resign(matchId)`，不要发送自定义“我输了”的普通命令冒充终局。

## 7. 交付给平台的规则说明

首款游戏接入时，作者需提交一份版本化规则契约：

1. `gameKey`、`modeKey`、`rulesVersion`；
2. 玩家数、座位、初始状态 schema；
3. 命令 schema 与每条拒绝原因；
4. 确定性状态转换和终局条件；
5. 玩家私有视图与管理员视图；
6. 回合/总局/掉线超时策略；
7. 至少包含合法局、非法命令、重复命令、断线恢复和回放重建测试向量。

平台据此实现并部署受信规则适配器。适配器升级不得悄悄改变旧对局；进行中对局继续绑定创建时的 `rulesVersion`。

## 8. 发布前检查表

- Web ZIP 离线包含全部运行资源，并声明 `multiplayer`。
- 两个不同账号可完成建房、加入、准备、开始和终局。
- 刷新或短暂断网后回到同一局面。
- 非法操作被服务端拒绝，客户端不会自行判定成功。
- 私密字段不会出现在另一玩家消息、日志或回放中。
- 同一命令重试不会走两步；同一终局不会结算两次。
- 游戏不读取父页面 DOM，不请求平台 token，不直连 realtime 地址。

平台桥的安全边界、完整方法和事件表见 [52 Web 游戏多人安全桥](./52-web-game-multiplayer-bridge.zh-CN.md)，底层房间与权威对局设计见 [多人平台基础设施设计](./multiplayer-platform-infrastructure-design.md)。

