# 联网规则包提交与审核队列

状态：代码完成，待生产环境迁移与真实账号验收

更新日期：2026-10-01

## 目标

本阶段把作者规则交付从“线下传文件”升级为平台内可追踪流程：作者上传源码 ZIP 和 Creator Doctor 证据，管理员领取并审核，审核通过后进入受控构建队列。

它刻意不做以下事情：

- 不在 API 进程中解压或执行作者代码。
- 不相信作者提供的签名，也不向作者提供平台私钥。
- 不把“批准构建”解释成已经签名、部署、注册模式或公开上线。
- 不绕过既有的规则清单、SHA-256、Ed25519 和 API/Realtime 同版本部署边界。

## 状态机

```text
created -> receiving -> uploaded -> submitted -> in_review
                                              |-> changes_requested
                                              |-> approved_for_build
                                              `-> rejected

receiving -> failed
created   -> expired
```

同一作品、`modeKey`、`rulesetVersion` 只允许一份进行中的提交。需要修改时创建新版本或新的提交，不修改已经审核过的源码包。

所有创建、上传、提交和审核动作都会写入仅追加事件表；数据库触发器禁止更新或删除这些事件。

## 作者流程

1. 在开发者中心生成 `creator-submission.json`。
2. 运行 Creator Doctor，并用 `--json --output` 保存通过报告。
3. 运行 `npm run multiplayer:templates` 或自己的可复现打包流程，得到源码 ZIP。
4. 打开“创作中心 → 联网游戏开发者中心 → 提交规则审核包”。
5. 选择源码 ZIP、提交说明和 Doctor 报告。浏览器计算 SHA-256。
6. 平台创建提交、签发一次性上传 grant、流式写入隔离区并核对字节数、摘要和 ZIP magic。
7. 作者确认提交后，状态进入 `submitted`；源码包从此作为本次审核的不可变输入。

规则源码 ZIP 上限为 20 MB。JSON 证据由 API 再次核对，至少要求：

- `creatorSubmission.version === 1`；
- `workId`、`modeKey`、`rulesetVersion` 与请求一致；
- authority 为 `platform_authoritative`；
- 玩家数与模式配置一致；
- Doctor 报告 `ok === true` 且 `summary.errors === 0`。

## 管理员流程

管理员治理页会显示 `submitted` 和 `in_review` 队列。审核员必须先“开始审核”，再选择：

- `request_changes`：要求作者修改并重新提交；
- `approve_for_build`：允许把固定源码包交给独立受控 Builder；
- `reject`：拒绝本次版本。

除“开始审核”外，每个结论都必须填写说明。管理员可下载隔离源码包；下载响应带 `Digest`，审核工具必须再次计算 SHA-256 并与页面/接口记录对比。

## API

作者端：

- `POST /v1/creator/works/{workId}/multiplayer-rule-submissions`
- `GET /v1/creator/works/{workId}/multiplayer-rule-submissions`
- `GET /v1/creator/multiplayer-rule-submissions/{submissionId}`
- `POST /v1/creator/multiplayer-rule-submissions/{submissionId}/grant`
- `PUT /v1/creator/multiplayer-rule-submissions/{submissionId}/package`
- `POST /v1/creator/multiplayer-rule-submissions/{submissionId}/submit`

管理员端：

- `GET /v1/admin/multiplayer/rule-submissions`
- `GET /v1/admin/multiplayer/rule-submissions/{submissionId}`
- `GET /v1/admin/multiplayer/rule-submissions/{submissionId}/package`
- `POST /v1/admin/multiplayer/rule-submissions/{submissionId}/review`

创建和最终提交要求 `Idempotency-Key`。上传使用单次、短时 `Upload <token>`，上传 token 只以 SHA-256 摘要形式存储。

## 部署

```bash
pnpm install --frozen-lockfile
npm run contracts:generate
npm run api:migrate
npm run verify:m1-foundation
npm run web:build
```

迁移为 `0035_multiplayer_rule_submissions.sql`。规则源码继续存放在现有 quarantine 根目录；上线前应确认该目录容量、备份/保留策略、管理员下载审计和受控 Builder 的只读输入挂载。

## 完成边界

本阶段完成“收件与审核”，没有完成后续受控构建、离线签名、双服务部署、模式注册、回滚编排和两个真实账号的最终发布验收。只有这些后续步骤全部完成，某个规则版本才可以标记为生产可用。
