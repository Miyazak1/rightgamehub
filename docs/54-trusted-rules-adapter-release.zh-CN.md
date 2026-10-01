# 受信规则适配器发布与回滚

更新日期：2026-09-30。

## 1. 目标与边界

GameHub 的权威多人对局必须执行服务器已批准的确定性规则。作者 Web ZIP、Windows 包、上传校验产物和管理 API 都不能直接把代码装入 API 或 Realtime 进程。

规则适配器采用“离线签名清单 + 内容摘要 + 只读部署目录”发布：

```text
作者规则说明与测试向量
  → 平台代码审查 / 确定性测试
  → 单文件 CJS bundle
  → SHA-256 清单
  → 离线 Ed25519 私钥签名
  → Git/制品发布及容器部署
  → API 与 Realtime 使用同一公钥和清单启动
```

私钥不进入 Git、服务器、环境变量或容器。线上只保存 Ed25519 公钥。签名证明“这是平台发布者批准的清单”，SHA-256 保证实际执行字节与清单一致；两者都不替代代码审查和规则测试。

## 2. 清单格式

协议固定为 `gamehub.rules-manifest.v1`：

```json
{
  "protocol": "gamehub.rules-manifest.v1",
  "createdAt": "2026-09-30T00:00:00.000Z",
  "keyId": "rules-release-2026-09",
  "entries": [
    {
      "workId": "作品 UUID",
      "modeKey": "duel",
      "rulesetVersion": "1.0.0",
      "bundle": "my-game/duel-1.0.0.cjs",
      "sha256": "64 位小写十六进制摘要"
    }
  ],
  "signature": "Ed25519 base64url 签名"
}
```

同一 `(workId, modeKey, rulesetVersion)` 只能出现一次，一个 bundle 也不能被多个身份复用。bundle 必须是清单目录下的相对 `.cjs` 单文件，最大 1 MiB；清单最大 64 KiB、最多 256 个版本。真实路径会在读取后再次检查，符号链接不能逃出只读根目录。

加载器对已校验的精确字节执行单文件 CommonJS，不向 bundle 提供 `require` 或 `process`。这是减少意外依赖和 I/O 的约束，不把 Node `vm` 宣称为恶意代码安全沙箱；真正的安全边界仍是签名前的受信评审。

## 3. 首次建立发布密钥

在离线或受控发布机器执行：

```bash
npm run rules:manifest -- keygen rules-release-2026-09 /secure/rules-private.pem /secure/rules-public.json
```

- `rules-private.pem` 只放离线密钥库并备份；禁止复制到生产机。
- `rules-public.json` 形如 `{"rules-release-2026-09":"<SPKI DER base64>"}`，可以交给生产环境。
- 密钥轮换时新增 keyId；确认所有运行中旧对局不再依赖旧清单后才能移除旧公钥。

## 4. 发布一个规则版本

1. 管理员从治理页下载状态为 `ready` 的平台构建 bundle，核对响应 `Digest`、构建报告和审核记录中的 SHA-256；不要使用作者自行编译或审核后手工修改的文件。
2. 将核对后的 bundle 放到 `rules/<game>/<mode>-<version>.cjs`。
3. 在 `rules/manifest.json` 增加身份与 bundle 路径；摘要可先留占位值。
4. 执行签名，命令会从磁盘重新计算所有 bundle 的 SHA-256：

   ```bash
   npm run rules:manifest -- sign rules/manifest.json /secure/rules-private.pem
   ```

5. 用公开密钥做独立验证：

   ```bash
   npm run rules:manifest -- verify rules/manifest.json /secure/rules-public.json
   ```

6. 设置生产环境：

   ```dotenv
   RULES_MANIFEST_PATH=/app/rules/manifest.json
   RULES_TRUSTED_KEYS_JSON={"rules-release-2026-09":"<SPKI DER base64>"}
   ```

7. 同一次发布重新创建 `api` 和 `realtime`。只有这两个需要执行权威规则的服务挂载同一个只读 `rules/` 目录；API 与 Realtime 日志必须报告相同适配器数量。迁移、上传校验 worker、Rule Builder 和静态运行边缘不加载已签名规则，也不持有私钥。
8. 最后再通过管理员 API 创建或启用对应 `modeKey/rulesetVersion`。API 会拒绝未安装的 `platform_authoritative` 规则。

生产环境禁止 `RULES_ALLOW_UNSIGNED=true`。开发环境如确有需要可显式临时启用，但不得把未签名清单复制到生产部署。

## 5. 升级与旧对局

- 行为变化必须使用新的 `rulesetVersion`，不得替换同版本 bundle 后重签。
- 数据库中的对局继续绑定创建时版本；新模式配置才引用新版本。
- 只要仍存在活动对局、回放重建或争议审计需求，旧 bundle 就必须继续保留在签名清单中。
- 适配器需要保持确定性：相同状态、命令、玩家和服务端时间输入产生相同输出；不得读取网络、文件、随机全局状态或本机时钟。

建议顺序：并存发布新旧版本 → 在测试房间验收新版本 → 将新建房间切到新版本 → 等旧对局结束 → 保留旧版直到回放保留期结束 → 再签名移除。

## 6. 故障与回滚

下列任一问题都会让相关进程启动失败，而不是跳过适配器继续运行：

- 清单协议、字段、签名或公钥不合法；
- bundle 缺失、过大、路径越界或 SHA-256 不符；
- 导出对象缺少规则 SDK 方法；
- bundle 的 `workId/modeKey/rulesetVersion` 与清单不一致；
- 身份或 bundle 重复。

回滚时恢复上一套完整的 `rules/` 目录、上一份已签名清单和仍受信的公钥，然后同时重建 API 与 Realtime。不要只回滚其中一个服务，也不要通过删除数据库中的进行中对局来绕过旧版本缺失。

## 7. 接入完成门槛

- 离线签名、线上公钥验证和摘要验证均通过。
- API、Realtime 从同一只读目录加载相同数量和身份的适配器。
- 未安装版本无法创建权威模式，也无法开始或继续对局。
- 篡改 bundle、替换身份、未知 keyId 和未签名生产配置都有自动化拒绝测试。
- 新旧版本并存时，旧对局仍可命令、超时、恢复和回放。
- 发布与回滚步骤由另一位操作者按本文复现成功。
