# 游戏文件导出与分享链接（平台协议 v1）

## 给创作者和 AI 的任务说明

保留游戏现有能力与单机玩法。在 ZIP 根目录的 platform.json 声明 fileExport、shareLinks，使用本仓库 @gamehub/web-game-sdk（未发布公共 npm，需打包或复制官方 SDK）或严格遵守 gamehub.web-game.v1 桥协议。不要从 iframe 直接写磁盘、下载 HTML、访问账号令牌或调用带登录信息的 API。

```json
{"version":1,"entry":"index.html","capabilities":["fileExport","shareLinks"]}
```

支持的声明全集：fullscreen、pointerLock、multiplayer、localSave、competition、fileExport、shareLinks。未知能力或拼写错误仍拒绝上传。旧的失败上传不会自动重跑，更新平台后重新上传 ZIP。

## SDK 最小接入

```js
import { createGameHubClient } from '@gamehub/web-game-sdk';
const gamehub = createGameHubClient();
const capabilities = await gamehub.connect();
// 开局读取：正常游玩为 null；从平台分享路由启动才有数据。
const shared = await gamehub.shares.current();
if (shared?.payload?.kind === 'bingo-pack' && shared.payload.schemaVersion === 1) {
  // 先按游戏自身 schema 校验内容，再恢复；不要把分享文本当 HTML 执行。
  restoreValidatedPack(shared.payload.pack);
}
// 用户点击分享后调用；只提交标题和 JSON，不提交 userId/workId/releaseId。
const link = await gamehub.shares.create({
  title: '我的 Bingo 题包',
  payload: { kind: 'bingo-pack', schemaVersion: 1, pack: serialisePack() },
});
showCopyableLink(link.url); // 普通站内 URL，可由未登录玩家打开。
// JSON
const data = new TextEncoder().encode(JSON.stringify(serialisePack())).buffer;
const result = await gamehub.files.download({filename:'Bingo.json',mimeType:'application/json',data});
// PNG：const data = await pngBlob.arrayBuffer(); mimeType:'image/png'; filename:'Bingo.png'
showMessage(result.status === 'saved' ? '文件已保存' : '已交给浏览器下载，请查看下载列表');
```

data 必须为 ArrayBuffer。原生协议允许通过 MessagePort 转移该 ArrayBuffer；不接受 URL、路径、Base64 字符串或 Uint8Array 代替。当前 SDK 采用结构化克隆，最高复制 2 MiB。自写桥接的 files.download 等待时间应至少 **130 秒**（平台确认窗口最多 120 秒）；不要沿用普通 API 的 15 秒超时，尤其是旧 Bingo 客户端。

所有调用都应 catch 错误并保留用户数据。请勿把 download_started 文案写成“文件已经落盘”，勿自动重试分享创建以免生成多个链接。

## 限制和宿主行为

- PNG：最多 2 MiB，最多 4096×4096。校验签名、尺寸、分块边界和 CRC；拒绝 APNG、尾随数据及伪装的 HTML/EXE。
- JSON 导出：最多 256 KiB，深度最多 12、最多 20000 个节点。只接受 JSON 值。
- 文件名最多 120 字符，仅文字、数字、空格和安全标点，必须匹配 .png/.json；拒绝路径、控制字符、Windows 保留名。用户在原生保存窗口更改文件名后会再次校验。
- 分享：标题 1–120 字；payload 必须是 JSON 对象，UTF-8 最多 16 KiB、深度 12、节点 2000；禁止原型字段、非有限数字和二进制对象。
- 导出需平台确认，每个活动桥一次一项、每分钟最多 5 次。停止游戏、切换账号、超时会取消待完成的操作。
- Web：优先系统文件选择器；不支持时在平台用户点击后交给浏览器下载，返回 download_started。
- VS Code/Cursor：本机窗口通过 showSaveDialog 和 workspace.fs.writeFile 保存，写入完成返回 saved；远程窗口明确返回 FILE_EXPORT_UNSUPPORTED。
- Harness：可用文件选择器时返回 saved；嵌入浏览器不提供安全保存接口时明确返回 FILE_EXPORT_UNSUPPORTED，可在网页版继续。不会伪造成功。
- iframe 仍是 opaque origin，未增加 allow-same-origin 或 allow-downloads。所有宿主共用参数校验和桥接授权。

## 分享权限与生命周期

POST /v1/game-shares 同时要求账号 bearer 和可信父页保存的 X-GameHub-Session；只接受 production 会话且发布版本已获准 shareLinks。账号、作品、版本来自会话，不信任游戏参数。GET /v1/game-shares/:code 支持匿名，DELETE 要求创建者身份；详情和错误均 no-store。

链接使用随机 192-bit code，数据库只保存其 SHA-256。URL 为 GAME_SHARE_SITE_ORIGIN/#/s/:code，Compose 从 APP_DOMAIN 注入站点来源，禁止使用请求 Host 或 iframe 提供的跳转地址。独立本地测试可配置 http://127.0.0.1:端口。路由解析指定 workId/releaseId 后按正式启动描述启动；shares.current 每次重新读取当前启动的 code，不接受任何参数或任意 code 查询。

作品/目标撤下、私有、封禁，版本停用/退休、能力移除，分享创建者或作者被封禁，链接撤销或到期都会阻止读取。作品、目标和版本的 generation 与创建时绑定，撤下再发布也不会复活旧链接。新版本发布后，旧链接固定到仍可运行的旧版本，不会偷偷替换内容。

链接有效期 30 天；每账号每分钟 5 次、每天 20 次、最多 100 个有效链接；整站最多保留 10000 行。配额在数据库事务中串行检查，跨 API 实例仍有效，撤销不能绕过当天额度。公开读取每 IP 每实例每分钟最多 60 次，计数缓存最多 2048 项。API 每分钟批量清理至多 500 条到期数据/撤销满一天的数据，审计保留 90 天、每批清理 500 条。审计只记标识、动作、时间，不复制 payload。

分享数据是持有链接者可读的公开数据，创作者应只放玩家明确要分享的题包/关卡配置，不能放账号凭据、隐私存档或完整个人信息。它与分享社区帖子、排行榜和云存档分别管理，不会开启云存档。

## 错误处理

| 代码 | 含义与处理 |
| --- | --- |
| CAPABILITY_UNSUPPORTED | platform.json 名称不受支持；核对声明和平台版本后重新上传 |
| BRIDGE_CAPABILITY_NOT_GRANTED | 当前版本未获准该能力，或版本已不可用 |
| AUTH_REQUIRED | 创建分享前需登录；文件导出与匿名读取不要求登录 |
| GAME_SESSION_INVALID | 会话过期、撤销、跨版本或账号已变化；重新启动 |
| SHARE_PAYLOAD_INVALID | 标题、数据大小或结构超限；不要发送原始存档 |
| SHARE_QUOTA_EXCEEDED / SHARE_RATE_LIMITED | 稍后重试；不要循环创建 |
| SHARE_UNAVAILABLE | 已失效或不存在；保留正常开局入口 |
| SHARE_CONTEXT_MISMATCH | 分享不属于当前作品/版本；拒绝载入 |
| FILE_EXPORT_INVALID | 文件名、MIME、字节或内容不合法 |
| FILE_EXPORT_UNSUPPORTED | 宿主不提供安全保存接口；转网页版 |
| FILE_EXPORT_CANCELLED | 用户取消或当前游戏已关闭 |
| FILE_EXPORT_BUSY / FILE_EXPORT_TIMEOUT / FILE_EXPORT_FAILED | 可重试；保留待导出的内容 |

## 验收与部署

迁移 0055_game_share_links.sql 随部署脚本自动执行，总迁移数 55。现有云存档开关保持关闭。测试涵盖实际 PostgreSQL 会话授权、并发额度、不可变标识、撤销/撤下/封禁/退休、维护清理、Bingo 声明 ZIP 上传自动发布、SDK 桥及 PNG/JSON 文件校验。浏览器测试通过真实 opaque iframe 与 API 完成下载、分享、匿名恢复和撤下失效；编辑器原生保存使用宿主接口测试，Harness 不支持场景明确返回错误。

本地重复验收：在独立 community_test 数据库设置 GAMEHUB_COMMUNITY_DATABASE_URL，并设置 GAMEHUB_COMMUNITY_PLAYWRIGHT_PATH；运行 node --test --test-concurrency=1 tests/platform/game-share-links.test.cjs tests/client/game-sharing-browser.test.cjs。源码接入参考 packages/web-game-sdk/src/index.d.ts；浏览器验收输出在 .runtime/game-sharing-acceptance。
