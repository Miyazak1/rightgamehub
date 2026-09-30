# 迷阵双人权威规则 1.0.0

此目录包含作品 `1a13df55-8906-4b03-a19a-5e5a3b776649` 的平台权威双人规则。

- 模式键：`duel`
- 规则版本：`1.0.0`
- 玩家：固定 2 人，座位 0 为红方，座位 1 为黑方
- 默认回合：90 秒
- 超时：单方累计 3 次判负；前 2 次自动结束该方回合
- 客户端包：`F:\Game\迷阵\迷阵-web-1.1.0-online.zip`
- 离线私钥：仅保存在 `F:\Game\迷阵\发布密钥\rules-private.pem`，不得上传或提交

## 生产环境

`deploy/.env.prod` 需要包含：

```dotenv
RULES_MANIFEST_PATH=/app/rules/manifest.json
RULES_TRUSTED_KEYS_JSON='{"mizhen-release-2026-09":"MCowBQYDK2VwAyEANV5dtIf2p6FvIQbylX7IbNQvdv2LEgRPbFWEJm/s9Mc="}'
```

更新代码后，先验证清单，再同时重建 API 与 Realtime：

```sh
cd /www/gamehub
npm run rules:manifest -- verify rules/manifest.json rules/trusted-public-keys.json
cd deploy
./deploy.sh
docker compose --env-file .env.prod -f compose.prod.yml logs --tail=100 api realtime
```

API 和 Realtime 都应报告加载了 `1` 个可信规则适配器。

## 创建平台模式

规则加载成功后，在 API 容器执行一次幂等注册命令：

```sh
MULTIPLAYER_WORK_ID=1a13df55-8906-4b03-a19a-5e5a3b776649 \
MULTIPLAYER_MODE_KEY=duel \
MULTIPLAYER_MODE_NAME='双人迷阵' \
MULTIPLAYER_RULESET_VERSION=1.0.0 \
docker compose --env-file .env.prod -f compose.prod.yml exec -T \
  -e MULTIPLAYER_WORK_ID -e MULTIPLAYER_MODE_KEY -e MULTIPLAYER_MODE_NAME -e MULTIPLAYER_RULESET_VERSION \
  api node apps/api/src/register-multiplayer-mode-cli.mjs
```

最后上传并发布联机 ZIP。发布清单必须批准 `multiplayer` 能力；客户端在平台外打开时只提供本地练习模式。
