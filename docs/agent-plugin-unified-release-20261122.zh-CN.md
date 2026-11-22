# 小墨鱼统一发布包与本地部署前验收

日期：2026-11-22。准备分支 `codex/agent-plugin-unified-release`；业务源码冻结于 `8e5991cae5a64c83f6ccde9870aa5ab387cd6fd0`。包含 GitHub 插件、QQ 渠道插件、共享交互执行器及最小插件管理后台。API 与共享交互执行器使用同一 API 镜像。发布准备脚本及验收代码单独提交，不改变冻结业务源码。

## 交付内容

本地产物：`E:\CodexData\build\Right\agent-plugin-unified-release\candidate-8e5991ca-r4\delivery`。

`images.tar` 包含目标 API／worker／Web、兼容回退 API、原 worker／Web 及原 API 镜像；`release-manifest.json` 固定提交、全部镜像 ID、源码校验和及资源目录。`source.patch` 是从已知原版本 `55b2f7e8` 到业务冻结提交的审查材料，不用于重写服务器 Git 历史。`SHA256SUMS` 覆盖交付文件。原构建输出和失败候选均保留在 E 盘，但不进入交付目录。

目标镜像：

| 角色 | 标签 | 不可变 ID |
| --- | --- | --- |
| API／共享交互执行器／适用的原 Agent 调度进程 | `mooyu-agent-unified-api:20261121-8e5991ca-r4` | `sha256:b67910da86d687e0485b14b583ce31ac814a89f9421069abe125ce36b69c7abe` |
| QQ worker | `mooyu-agent-unified-worker:20261121-8e5991ca-r4` | `sha256:efc4944ddc0ecdb477d539e8e36cad276aab6f9a7351e95b01c0a7688a1c8c1d` |
| Web | `mooyu-agent-unified-web:20261121-8e5991ca-r4` | `sha256:b41b96165cfce091ef8890debda68c2920cc0fc18f775f21e70572ee6613fdcb` |
| 原 API 的兼容回退版 | `mooyu-agent-unified-api-rollback:20261121-55b2f7e8-schema166-r3` | `sha256:22b7b18cc870b51167826683f163f24b550bba69910e027c3576ce1180252ed2` |

构建复用已有 Linux 依赖和中文字体，没有安装依赖或修改 pnpm store。Web 构建对 workspace 导入做固定工作树解析及 Git 源码核对，避免依赖链接指向旧源码。新资源位于 `assets/agent-unified-8e5991ca-r4/`；原345个静态文件（除更新入口 index.html）逐一校验保留，下载、课件和旧缓存页面仍可引用原资源。

## 本地验收证据

实际运行镜像内业务代码；只挂载测试夹具和输出目录，没有用开发源码覆盖 `/app/apps`。API／worker 验收共享断网临时 PostgreSQL 的回环网络，测试结束只删除本次标记的 tmpfs 容器。

- API 镜像内14项 PostgreSQL／插件测试通过，覆盖 GitHub 查找、写作、源码问答、自动补读、权限拒绝、插件暂停恢复和原任务重放。
- API 实际运行入口模块成功导入，Linux 字体渲染产生5页中文测试文章。页面及图片已视觉抽查。
- QQ 镜像使用实际插件宿主、数据库账本、原生 OneBot WebSocket 和实际签名 Agent HTTP 客户端；合成聊天、源码回复及5页 PNG 投递通过。图片 SHA 与 API 渲染结果一致，页序完整，每页发送尝试为1。
- 分页途中重建运行实例后继续发送；完成后以第二个全新镜像容器／Node 进程读取同一数据库，新增投递为0，页 ID、SHA、尝试数、控制设置均保持，未额外调用 Agent HTTP。
- 最终 Web 镜像实际生产 JS／CSS 经 localhost Caddy 提供，在完整网站后台呈现插件管理，桌面及390px手机视图通过；无页面 JS 异常，所需新资源全部200。HTTP API 在此浏览器检查中使用合成管理员响应；API 授权与隔离另由真实数据库／HTTP测试验证。
- 升级 bootstrap 的专用数据库测试包含启用中的定时计划和已保存历史请求；重复 bootstrap 后，计划、授权、策略、预算、历史及文章表摘要均相同。
- 在同一166版数据库上，原 API 实测为 `expected=163, applied=166, unexpected_version`；兼容回退 API 与目标 API 均为 `expected=166, applied=166, ready=true`，数据摘要未改变。没有执行数据库还原。
- 命令计划器5项测试通过：Compose 文件顺序、原暂停计划不启动、固定镜像回退、缺少执行器／现场证据阻断、未知旧 schema 阻断，以及“根消息已回复但最终结果未结算”和失败图片页仍会阻止回退。

本轮镜像验收使用合成 QQ／GitHub／模型边界，不向真实群发消息、不消耗真实模型额度。此前同一业务冻结提交所在分支的真实 QQ 群验收记录继续保留，见 `qq-channel-plugin-live-20261121.zh-CN.md`。本轮未切换原本地真实 QQ API、worker 或登录网关。

任务暂停再恢复后观察到原本地测试容器已退出（255）。保持原停止现场；原数据库卷以只读方式挂入独立临时容器，仅在 tmpfs 副本中恢复并核对数据，没有恢复原网关或写原数据库卷。保留检查及当时运行状态见交付中的 `verification/original-scene-preservation.json`，不能把数据保留验收解释为原 QQ 运行实例当前在线。

主要证据在候选目录 `verification/`、`signed-cold-start-verification/`；交付目录只收入通过的日志、JSON和页面截图。

## 为什么回退包要保留新迁移目录

原 API 仅带0001–0163，应用启动会要求迁移数量完全一致。直接用它连接保留0164–0166的新库会拒绝就绪。兼容回退镜像保持原 API 业务代码，仅增加0164、0165、0166三个 SQL目录项；原163项按项目的换行规范化规则核验一致，并保留其原文件。

回退不会执行这些 SQL，也不会删除新增表、旧任务的插件绑定或图片账本。原 API 镜像仍在包内保留，迁移到166后自动回退命令使用兼容回退镜像。其他现场 API 镜像必须先证明其完整迁移目录兼容，计划器才允许生成命令。

## 升级与回退命令的准备方式

当前没有读取本轮服务器现场，因此尚未核实线上完整 Compose 链、共享交互执行器是否已开通及配置是否对齐。交付包含只读清单工具和受门禁保护的命令生成器；取得现场证据后才生成该服务器的可执行命令。缺少执行器或配置不齐时输出阻断原因，不猜造服务、挂载或密钥。首次开通共享交互执行器时，应先根据现场补齐该服务及配置的审查方案，再生成切换命令。

以下为后续获准进入服务器阶段使用的命令。本轮没有执行：

```bash
cd /path/to/verified-release-delivery
sha256sum --check SHA256SUMS
docker load --input images.tar

# 使用 Node 22；scene-spec.private.json 由服务器只读清单填实。
umask 077
node tools/capture-agent-plugin-inventory.mjs \
  /private/scene-spec.private.json /private/inventory.private.json
node tools/agent-plugin-release-plan.mjs \
  release-manifest.json /private/inventory.private.json /private/new-cutover-record

# ready=true 且已审查具体脚本后，升级时执行：
bash /private/new-cutover-record/upgrade.sh

# 需要回退且再次满足空闲门禁时，执行：
bash /private/new-cutover-record/rollback.sh
```

`scene-spec.example.json` 列出所需字段，所有占位值必须据实填写。API、Web、QQ worker、共享交互执行器及所有可能处理 Agent 任务的现有调度进程均需列入；每个角色的实际容器名和原 Compose `--env-file` 列表显式提供。工具从容器标签读取项目名、工作目录、全部配置文件及顺序，再核对渲染配置、镜像、环境、挂载、共享 secret、数据库备份和登录卷身份。私有清单仅保存路径、指纹及必要标识，权限为0600，不打印密码或完整环境值。

两库备份可用自定义 pg_dump 格式或 gzip SQL；清单工具检查可读性／压缩完整性及 SHA。角色数据库名、用户及容器由清单明确提供。原 `.env`、worker.env、config.json、secret、登录卷和 Compose 原文件都不被改写。

生成的脚本使用主机共享 `flock` 锁，切换前和停止进程后各检查一次运行任务、定时 fire、待投递消息、未结算最终结果及未完成图片页；并复核配置、环境、挂载、备份、登录网关及镜像 ID。只有原来运行中的角色会停止并恢复，原暂停的调度进程不会自动启动；定时计划行、enabled、next_fire_at 和预算不会被改写。启动使用 `--pull never --no-build --no-deps --wait`，不拉取浮动版本，也不触碰网关或数据库服务。

任何门禁失败都应保留现场检查，不能通过删队列、改 delivered、清预算、关闭定时计划或恢复旧数据库来绕过。若在停止阶段失败且尚未执行迁移或重建服务，可按记录的原 Compose 链恢复原先运行的进程；发生迁移后应使用已验证的兼容回退方案，并先解决未完成任务或不确定投递。

## 本轮保留边界

未连接／修改线上；未推送 Git 或部署；不复制登录数据、生产配置或凭据进发布包；不修改既有授权、计划、预算或历史。论文六个开关维持关闭，切换前仍会检查实际环境。所有新测试使用独立数据库／合成身份，不重新扫码，不更换原登录卷。

下一阶段是服务器只读现场预检和切换方案核对。发布包本地验收通过，不代表该服务器已获准或已具备直接切换条件。
