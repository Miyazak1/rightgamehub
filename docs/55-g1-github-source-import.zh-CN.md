# G1 GitHub 只读来源导入

状态：代码完成，待生产 GitHub App 凭据与真实仓库验收
更新日期：2026-09-30

## 1. 已实现范围

G1 只负责“来源资料 → 私有作品草稿”，不拉取或执行仓库源码，也不自动构建、上传或发布。

```text
创作者账号
-> 安装独立 GitHub App
-> 读取获授权仓库列表
-> 固定默认分支当前 commit/tree
-> 净化 README + 记录许可证证据
-> 创建私有作品草稿与来源证明
-> 作者沿用现有 Web ZIP 上传、校验、发布链路
```

已实现：

- 独立 GitHub App，不复用登录 OAuth token。
- App JWT 与短期 installation token；短期 token 只在进程内缓存，不写数据库、响应或日志。
- 安装 state 单次消费、10 分钟过期、安装归属冲突保护。
- 最多 5 页、500 个授权仓库的有界同步；撤销、暂停和仓库移除会关闭后续读取权限。
- README 去 HTML、图片和危险链接后截断；不会执行其中的 HTML 或脚本。
- 完整 commit SHA、tree SHA、仓库稳定 ID、许可证路径和内容摘要。
- 草稿创建幂等、沿用创作者权限和作品数量配额。
- 私有仓库只在作者可见来源接口中保留地址，不写入公开作品 `repository_url`。
- Webhook 对原始字节做 HMAC-SHA256 验签，按 delivery ID 去重。
- 追加式审计、管理员数量概览和审计读取接口。

明确未实现：源码克隆、依赖安装、Builder、Webhook 自动建版、自动发布、Issue/PR 回流、Skill/MCP 执行。它们属于 G2 以后。

## 2. GitHub App 配置

创建一个与登录 OAuth App 分离的 GitHub App：

- Repository permissions：`Metadata: Read-only`、`Contents: Read-only`。
- Subscribe to events：`Installation`、`Installation repositories`。
- Webhook URL：`https://<平台域名>/v1/webhooks/github`。
- Setup URL：`https://<平台域名>/v1/integrations/github/setup`。
- Setup URL 需要开启安装后重定向。
- 不申请写权限，不申请 Issues、Pull requests、Actions 或 Administration 权限。

环境变量：

```dotenv
GITHUB_SOURCE_IMPORT_ENABLED=true
GITHUB_APP_ID=123456
GITHUB_APP_CLIENT_ID=Iv1_optional_client_id
GITHUB_APP_SLUG=gamehub-source-import
GITHUB_APP_CALLBACK_URL=https://<平台域名>/#/creator/import
GITHUB_APP_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----
GITHUB_APP_WEBHOOK_SECRET=<至少 32 UTF-8 字节的随机值>
```

生产启用时配置会 fail-closed：字段缺失、私钥无效、Webhook secret 过短、slug 无效或 callback 不是 HTTPS，API 都不会启动。`GITHUB_SOURCE_IMPORT_ENABLED=false` 时现有平台保持可用，作者 UI 会提示继续手动建稿和上传 ZIP。

## 3. 数据与接口

迁移 `0033_github_source_import.sql` 新增安装 state、连接、授权仓库、导入快照、作品来源、Webhook delivery 和审计表。来源与公开作品字段分开，防止私有仓库元数据误入目录。

主要接口：

- `POST /v1/creator/source-connections/github/install`
- `POST /v1/creator/source-connections/github/complete`
- `GET /v1/creator/source-connections`
- `DELETE /v1/creator/source-connections/{connectionId}`
- `GET /v1/creator/source-connections/{connectionId}/repositories`
- `POST /v1/creator/source-imports/preview`
- `POST /v1/creator/source-imports/drafts`
- `GET /v1/creator/works/{workId}/source`
- `POST /v1/webhooks/github`
- `GET /v1/admin/source-imports/overview`
- `GET /v1/admin/source-imports/audit`

草稿接口要求 `Idempotency-Key`。连接、仓库、导入和作品来源接口均要求创作者 Bearer 凭据；管理员接口另外检查管理员角色。

## 4. 部署与验收

```bash
cd /www/gamehub/deploy
git pull --ff-only origin main
docker compose --env-file .env.prod -f compose.prod.yml build api web
docker compose --env-file .env.prod -f compose.prod.yml run --rm migrate
docker compose --env-file .env.prod -f compose.prod.yml up -d --remove-orphans
docker compose --env-file .env.prod -f compose.prod.yml ps
```

上线前至少验证：

1. 仅选一个测试仓库安装 App，平台只能列出授权仓库。
2. 公开和私有仓库都能生成草稿；私有仓库地址不出现在公开目录字段。
3. README 中 HTML、图片和危险链接不在预览中执行。
4. commit/tree 为完整 40 位 SHA，草稿来源保持不变。
5. 相同幂等键不重复创建作品；不同请求复用同一键返回冲突。
6. 重放同一 Webhook delivery 不重复处理；错误签名返回 401。
7. 在 GitHub 撤销安装或移除仓库后，后续同步和预览失败，既有草稿保留审计来源。
8. 手动上传 Web ZIP、校验、发布仍按原链路工作。

代码测试不等于 GitHub 生产配置已验收。首次上线必须使用受控公开仓库与受控私有仓库各完成一次真实流程。

## 5. 官方参考

- [Sharing your GitHub App](https://docs.github.com/en/apps/sharing-github-apps/sharing-your-github-app)：安装 URL 的 `state` 关联方式。
- [About the setup URL](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-setup-url)：`installation_id` 不能单独作为归属证明。本实现还要求一次性 state、短时安装/更新时间窗、App JWT 反查和只读权限校验。
- [Authenticating as a GitHub App installation](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation)：JWT 与短期 installation token。
- [Validating webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)：对未修改的原始请求体校验 `X-Hub-Signature-256`。
