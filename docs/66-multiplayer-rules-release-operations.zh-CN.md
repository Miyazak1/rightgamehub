# 联网规则签名发布与回滚运行手册

状态：发布工具链代码完成，待在生产机安装首个真实签名规则版本并记录双服务摘要证据

更新日期：2026-10-02

## 1. 交付目标

本阶段把 Rule Builder 的 `ready` 产物接到可审计的生产发布链。发布链保证：

- 私钥只在离线发布机使用，生产服务器只接收公钥和已签名制品；
- 新发布是包含全部仍需保留版本的完整、不可变目录；
- 生产机重新验证签名、每个 bundle 的 SHA-256 和导出身份；
- API 与 Realtime 必须在 `/ready` 报告同一个 manifest SHA-256，发布才算成功；
- 任一步骤失败会恢复旧指针并重建两个服务；
- `rollback` 交换 `current`/`previous`，同样经过签名验证和双服务摘要门禁。

`rules-operator` 是无网络、只读根文件系统、无 capability 的一次性容器，只挂载 `rules/`。它不接收数据库、Redis、GitHub、对象存储或私钥。Rule Builder 仍只负责产生 bundle，不签名、不部署、不注册模式。

## 2. 一次性密钥准备

在离线或受控发布机执行：

```bash
npm run rules:release -- keygen rules-release-2026-10 /secure/rules-private.pem /secure/rules-public.json
```

私钥不得进入生产服务器、Git、容器镜像、CI 日志或 `.env.prod`。把公钥 JSON 压缩成单行后写入生产 `.env.prod`：

```dotenv
RULES_MANIFEST_PATH=/app/rules/current/manifest.json
RULES_TRUSTED_KEYS_JSON='{"rules-release-2026-10":"<SPKI DER base64>"}'
```

轮换密钥时先把新旧公钥同时加入 JSON；所有需要旧清单的运行中对局和回放超过保留期后，才能移除旧公钥。

## 3. 离线制作完整发布包

先从治理页下载 `ready` bundle，核对 HTTP `Digest`、构建报告和页面 SHA-256。然后在离线发布机执行：

```bash
npm run rules:release -- stage ./release-2026-10-02 \
  rules-release-2026-10 ./downloaded-rules.cjs \
  <work-uuid> <mode-key> <new-ruleset-version> \
  ./current/manifest.json ./rules-public.json

npm run rules:release -- sign \
  ./release-2026-10-02/manifest.unsigned.json \
  /secure/rules-private.pem \
  ./release-2026-10-02/manifest.json

npm run rules:release -- verify-release \
  ./release-2026-10-02 ./rules-public.json
```

首次发布没有旧清单时，把最后两个 `stage` 参数写成 `- -`。`stage` 会加载新 bundle 核对真实身份、验证旧签名、携带旧条目并拒绝覆盖相同 `(workId, modeKey, rulesetVersion)`。行为变化必须使用新的 `rulesetVersion`。

传输到生产机的是整个 `release-2026-10-02/`，其中必须包含 `manifest.json` 和清单引用的全部 bundle。`manifest.unsigned.json` 与 `release-plan.json` 是审核辅助文件；生产安装只物化已签名清单引用的字节。

## 4. 生产安装

在仓库根目录执行：

```bash
ENV_FILE=deploy/.env.prod deploy/rules-release.sh install /secure-transfer/release-2026-10-02
```

脚本按 manifest SHA-256 建立 `rules/releases/<sha256>/`，将文件设为只读，再原子更新 `rules/current`。随后同时重建 API 与 Realtime，最多等待约 60 秒；只有两个 `/ready` 的 `data.rules.manifestSha256` 都等于目标摘要时才提交 `rules/previous`。

可检查当前状态：

```bash
ENV_FILE=deploy/.env.prod deploy/rules-release.sh status
```

安装成功后，再注册或启用对应平台权威模式。不要提前注册；API 会拒绝本机未加载的规则身份。

## 5. 回滚

```bash
ENV_FILE=deploy/.env.prod deploy/rules-release.sh rollback
```

脚本先验证 `previous` 的签名和 bundle，再交换两个指针、重建 API 与 Realtime，并校验旧 manifest 摘要。若回滚目标无法就绪，会把原 current 恢复回来。不要只重启或回滚一个服务，也不要手改某个不可变 release 目录。

若首次安装在切换后失败且没有 previous，脚本恢复原 `RULES_MANIFEST_PATH` 并重建两个服务。此时保留输出和容器日志，修复制品或配置后重新发布，不要修改已签名目录。

## 6. 备份、保留与证据

`deploy/backup.sh` 会在数据库和资产之外备份 `rules/current`。部署前后至少保存：

- 下载 bundle 的构建 ID、来源 SHA-256、Builder 镜像摘要和审核事件；
- 签名前 `release-plan.json`、签名后 manifest SHA-256 和 keyId；
- 安装命令输出，以及 API/Realtime `/ready` 的相同摘要；
- 模式注册结果和两个真实账号的对局、重连、认输、超时证据。

活动对局、回放或争议审计仍需要的旧 bundle 必须继续出现在新清单中。`previous` 只提供快速回滚，不替代长期制品归档。

## 7. 完成门槛

- 错误签名、未知 keyId、摘要漂移、身份不符和重复不可变身份均失败关闭；
- 发布服务器没有私钥，规则操作容器没有网络和业务凭据；
- API/Realtime 的 readiness 精确报告相同 manifest SHA-256，而不只比较数量；
- 安装失败自动恢复，显式回滚可复现；
- 规则安装成功后才注册模式，并完成真实作者、管理员和双玩家验收。
