# GameHub API

当前目录保存 M1 平台 API 的 Fastify 服务骨架、邮箱设备授权边界和数据库迁移。它是开发增量，不是已上线生产服务。

迁移规则：

- 只增编号，已应用文件不原地改写。
- 每份普通迁移显式使用事务。
- 运行账号不拥有建表权限；部署时由独立 migration 账号执行。
- 禁止以删库重建代替升级。

开发配置复制自 `.env.example`，先启动 `deploy/compose.dev.yml` 中的 PostgreSQL，再运行 `pnpm --filter @gamehub/api migrate`。默认邮件适配器会明确失败，避免误发真实验证码；测试或开发必须显式注入收件箱适配器。

## 回环端到端联调

```powershell
docker compose -f deploy/compose.dev.yml up -d postgres
npm run e2e:start
```

该入口只监听 `127.0.0.1`，启动 API、Runtime Edge 和 Web 校验 Worker，并把验证码写入 `.runtime/platform/dev-mailbox.json`。它会创建一个仅供本机验收的可发布作者；不得把该入口、种子权限、本地收件箱或开发密钥用于生产。默认生产入口仍要求外部配置数据库、邮件适配器、密钥及运行域名。
