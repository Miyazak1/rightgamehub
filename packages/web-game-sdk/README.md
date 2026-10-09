> 存档能力当前仅开放 localSave。本机存档使用 client.localSave（兼容 client.cloudSave.local），需要新版宿主；cloudSave 仅用于显式启用的内部测试。本机进度不会自动上传。
>
> 通用排行榜使用独立的 `competition` 能力，包含声明式榜单、运行签发、成绩提交和查询。参见 [排行榜创作者接入说明](../../docs/competition-creator-guide.zh-CN.md)。

# GameHub 网页游戏 SDK：在线云存档

状态：S1 在线链路已实现并完成内部自动化验证，生产能力仍关闭。本 SDK 尚不提供持久本机缓存、离线 outbox 或冲突副本；关闭页面可能丢失未确认的进度。完整准入条件见 [存档设计](../../docs/72-game-save-platform-infrastructure-design.zh-CN.md)。

## 接入条件

游戏在平台 iframe 内运行，通过 `createGameHubClient()` 连接可信宿主。只有平台已批准的 release scope 才能获得 `cloudSave`；ZIP 声明本身不构成授权。账号 bearer、游戏会话、作品及发布渠道由宿主持有，游戏不得传入这些字段。

```js
import { createGameHubClient } from '@gamehub/web-game-sdk';

const gamehub = createGameHubClient();
const capabilities = await gamehub.connect();
if (!capabilities.includes('cloudSave')) throw new Error('当前版本未开放云存档');
const resource = { namespace: 'default', slot: 'autosave' };
const policy = await gamehub.cloudSave.getPolicy({ namespace: resource.namespace });
let confirmed = await gamehub.cloudSave.read(resource);
// null 表示从未创建；deleted === true 表示墓碑，仍须保留其 ETag。
const initialState = confirmed && !confirmed.deleted ? confirmed.data : { chapter: 1 };
```

namespace 和 slot 为 1–64 个小写 ASCII 字母、数字、点、下划线或连字符，保留 `_gamehub.` 前缀。namespace 必须在 release 审批范围内。schemaVersion 为正整数，须落在策略批准范围内；策略默认文档上限为 256 KiB，平台硬上限为 1 MiB。

## 保存与失败重试

首次创建使用 `createOnly: true`；覆盖已有槽或墓碑使用读取所得的 `expectedEtag`。每一次逻辑操作生成一个 UUID 幂等键，重试必须保留同一个键、正文、schema 和前置条件。服务器的成功回执才表示这次操作已提交。

下面示例只在内存保留一个未确认操作。调用方应串行执行；在确认前，不可用新进度替换待重试正文，也不可静默修改旧 ETag。

```js
let pending = null;
let sending = false;

async function submitPending() {
  if (sending || !pending) throw new Error('没有可提交的操作，或正在提交');
  sending = true;
  try {
    const result = await gamehub.cloudSave.write(pending);
    confirmed = result;
    pending = null;
    return result;
  } finally {
    sending = false; // 失败时保留 pending，供显式重试或冲突处理。
  }
}

async function saveNext(state) {
  if (pending) throw new Error('请先处理上次未确认的保存');
  pending = {
    ...resource,
    ...(confirmed ? { expectedEtag: confirmed.etag } : { createOnly: true }),
    idempotencyKey: crypto.randomUUID(),
    schemaVersion: 1,
    data: structuredClone(state),
  };
  return submitPending();
}

await saveNext(initialState);
// 网络错误且连接仍有效时：await submitPending();
// SAVE_CONFLICT 时先保留本机进度、读取云端并让玩家选择；不要自动覆盖。
```

JSON 保存要求顶层对象；二进制保存传 `Uint8Array`，SDK 自动选用 `application/octet-stream`。SDK 在每次调用时复制正文并计算 SHA-256。超过 16 KiB 自动分片，每片解码正文不超过 16 KiB，桥信封不超过 32 KiB；游戏不需要直接操作传输游标。一个连接同一时刻只允许一个活动正文传输。

若提交已经成功但 ACK 丢失，重试返回原回执，可能早于其他设备随后创建的修订。此回执确认的是原操作；下一次保存仍使用 CAS，不能把旧回执当作云端从未变化的证明。策略缩小或退休后，宿主可查询已提交的同摘要回执；它不能借此创建新保存。原账号及 scope 授权仍然必须有效。

## 读取、删除与历史恢复

`read()` 返回元数据和 `data`，不存在返回 `null`，墓碑返回 `deleted: true, data: null`。下载将元数据 ETag 绑定到正文请求，并验证字节数与摘要；读取过程中若云端变化，会返回 `SAVE_CONFLICT`，应重新读取。

```js
const history = await gamehub.cloudSave.history(resource);
// 后续页：history({ ...resource, beforeRevision: history.nextBeforeRevision })
// 仅在 nextBeforeRevision 非 null 时请求。

const deleted = await gamehub.cloudSave.delete({
  ...resource, expectedEtag: confirmed.etag, idempotencyKey: crypto.randomUUID(),
});
confirmed = deleted;

// 由玩家选中一个 payloadAvailable 为 true、且不是墓碑的历史项。
const selected = history.items.find(item => item.payloadAvailable && !item.deleted);
if (selected) {
  confirmed = await gamehub.cloudSave.restore({
    ...resource, revisionId: selected.revisionId,
    expectedEtag: confirmed.etag, idempotencyKey: crypto.randomUUID(),
  });
}
```

删除和恢复同样需要保留原命令用于失败重试。删除产生墓碑；恢复将历史正文复制为新修订。历史正文可能被预算回收，`payloadAvailable` 只是读取时的状态，恢复仍可能返回 `SAVE_HISTORY_UNAVAILABLE`（410）。revision 是十进制字符串，请勿转换为 JavaScript Number。

## 状态与错误

```js
const unsubscribe = gamehub.on('cloudSave.sync.changed', status => {
  // { namespace, slot, state, operation?, revision?, code?, historyDegraded? }
  console.log(status);
});
const status = await gamehub.cloudSave.getSyncStatus(resource);
// 退出游戏时：unsubscribe(); gamehub.close();
```

| state | 含义 |
| --- | --- |
| idle | 本次连接尚无提交状态；不代表已保存 |
| syncing | 正在传输或等待服务端提交确认 |
| cloud | 对应操作收到服务端成功回执 |
| conflict | 云端 ETag 已变化，需要选择进度 |
| error_retryable | 操作未确认；保留原命令后重试 |
| blocked | 策略、授权、正文或其他条件不允许当前操作 |

`historyDegraded: true` 表示当前保存已提交，但历史备份受限。状态是连接内状态，刷新后不会自动恢复。冲突错误仅暴露受限的 `expectedEtag`（服务器当前 ETag）、`currentRevision` 和 `currentUpdatedAt`，不包含其他账号或正文。

常见错误：`SAVE_CONFLICT`（412）、`SAVE_IDEMPOTENCY_MISMATCH`（409）、`SAVE_DOCUMENT_TOO_LARGE`、`SAVE_TRANSFER_BUSY`、`BRIDGE_TIMEOUT`、`BRIDGE_CLOSED`。超时不能证明提交未发生。账号切换或重新连接会使旧连接失效，不能把旧账号的 pending 交给新账号重试。

协议目录中的冲突解决和导出方法仍是保留名称，当前宿主没有注册对应 handler。本版本未提供自动覆盖、持久重试、匿名导入或离线保证。游戏适配、真实网页/Cursor 双宿主验收及 S2/S3 仍须完成。

## 文件导出与游戏分享

`fileExport` / `shareLinks` 已提供 `files.download`、`shares.create` 和 `shares.current`。接入、额度、失败代码和 AI 最小示例见 [文件导出与分享指南](../../docs/game-file-export-share-links.zh-CN.md)。分享创建需要登录，读取可匿名；文件保存必须经过可信宿主确认。
