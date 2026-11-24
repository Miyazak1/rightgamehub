# 按服务器现场准备的升级与回退草案

状态：本地评审草案，**不可执行，尚未满足生成可执行命令的门禁**。本轮仅有操作者返回的只读检查结果，没有修改服务器。证据与限制见 `agent-server-readonly-preflight-20261122.zh-CN.md`。

后续补齐的可执行实现见 `agent-server-cutover-tools-20261122.zh-CN.md` 和 `scripts/agent-server-cutover.mjs`。本草案中的 window-check 等占位脚本已由该工具的 check/backup/upgrade/rollback 命令取代；不要照抄本草案旧占位流程。生产记录仍须在未来获准准备服务器后，根据当时现场生成。

## 已确定的参数

- 网站项目 `gamehub-production`，目录 `/www/gamehub/deploy`；QQ 项目 `mooyu-qq`，目录 `/www/mooyu-qq`。各角色原有 Compose 标签内的全部文件必须按原顺序保留，API/Web 和执行角色不能假定最后覆盖文件相同。
- 既有 Agent：`c98abda1-d115-4e05-9c2e-43f68119386a`。复用 API/调度容器已有且相同的主密钥和 GitHub 凭据，后续私有操作不得打印凭据或写入公开交付包，不将凭据转交 QQ worker。
- 登录网关 `mooyu-qq-napcat-1` 保持原容器、启动时间、镜像和挂载。登录卷 `mooyu-qq-compatible-55b2f7e8-088f12` 不复制、不替换、不清理；两库服务不重建。
- API/共享执行器使用现有 `mooyu-qq-admin-control` 网络及 API 别名 `api`，QQ worker 保留该网络与 `mooyu-qq_default`。共享控制密钥只读挂载保留。
- 线上网站 schema 0163。首次接入需追加 0164–0166，创建共享执行器和 QQ 任务/图片表；新增表保留，回退不撤销迁移。
- 原 API/Web/QQ worker 的镜像与统一发布包兼容旧基线一致。目标包为 `candidate-8e5991ca-r4`，目标及回退镜像 ID 必须由已验证的 release-manifest.json 读取，不使用浮动标签。
- 每日 10:00 Asia/Shanghai 的 `blog.project.discovery-shadow` 保持启用；旧文章自动化 enabled=false 保持不变。全部原权限、历史及累计预算保留，不套用本地测试策略。

## 未来获准变更后的命令顺序

以下是操作顺序，尚不是可运行脚本；不得在本轮只读预检执行。

1. 校验发布包及不可变镜像，私有保存当时配置、完整参数链和新鲜双库备份，验证备份；核对原登录卷/网关未改变。
2. 在主机锁下复查队列、消息、最终回执、图片页、预算占用、定时 fire 和论文任务是否空闲。记录原本运行和暂停的角色。
3. 按审定策略处理独立论文 worker 的启用差异；这属于线上变更，当前未获授权执行。不能只把 API 的论文开关设为 false 就声称论文关闭。
4. 停止 QQ 入站 worker、API 与原本运行的相关 Agent 执行/调度进程，再复查空闲；不停止网关或两库，不改计划行。
5. 在原网站有序配置链上追加首次安装覆盖文件，以已验证目标 API 镜像执行迁移和共享交互 bootstrap；核对 bootstrap 的配置、注册/授权范围不改变现有策略或隐式扩权。
6. 启动 API、新共享执行器、原先启用的调度角色、QQ worker、Web；逐角色使用 no-deps/no-build/pull-never，禁止项目级无差别 up。
7. 校验数据库、授权、计划、设置指纹、登录卷、历史与预算累计；真实 QQ 检查聊天、源码追问、文章图片和重启防重。

## 回退顺序与未解决条件

- 重新采集切换后现场并检查空闲，不能用升级前的环境指纹直接判断新版容器。
- 停止新版入站/执行/调度角色，二次空闲检查；新增共享执行器保持停止，保留日志。
- API 使用已验证的 schema166 兼容回退镜像 `sha256:22b7b18cc870b51167826683f163f24b550bba69910e027c3576ce1180252ed2`，恢复原参数链；QQ worker 与 Web 使用原不可变镜像和原配置。
- **定时文章原镜像不同于兼容旧 API 镜像**。需单独验证原调度代码是否可在追加 schema 后运行，若需兼容镜像，必须保留该原镜像业务代码验证后另行准备；不能仅套用 API 的兼容回退结论。
- 不恢复旧数据库、不删除新表、不清理消息/图片、不重置预算或授权、不替换登录数据。论文关闭要求仍须成立，回退不能恢复论文启用状态。

## 当前门禁

最新现场补充：网站显式环境文件为 `/www/gamehub/deploy/.env.prod`，QQ 为 `/www/mooyu-qq/.env`。QQ worker 的完整 Compose 重解析镜像和环境均与当前一致；网站 API/Web/调度的原链解析失败，原因待诊断。这是网站重建的明确阻断项，不能把已存在文件链直接当成可用恢复命令。

失败原因已进一步定位到 Web volumes 需要 `AGENT_DOWNLOADS_DIR` 与 `DESKTOP_DOWNLOADS_DIR`；不展开插值时结构解析成功。部署/回退命令还须带上依据当前 Web 挂载核实的这两个进程环境参数，不能编辑线上环境文件或填入猜测目录来通过检查；目录映射与重新解析一致性尚待验证。

当前实际只读 Web 挂载已经核实：`AGENT_DOWNLOADS_DIR=/www/gamehub-downloads/agent`，`DESKTOP_DOWNLOADS_DIR=/www/gamehub-downloads/desktop`。应先用子进程临时环境重解析验证，之后升级与回退两条参数链都必须携带这两个值。未展开模型里的 `/www/gamehub/deploy/` 是 Compose 归一化前缀，不是应加到已核实绝对路径的目录。

上述只读重解析现已通过：API、Web、定时文章的镜像、完整环境与 bind 挂载均与现场一致，环境差异为空。API/定时文章原额度为每日 1 次、月调用 120 次、月费用 10000000 微美元、连续失败阈值 2，保持不变。已知配置继承条件已明确，但尚不能生成无阻断的可执行切换脚本。

最新兼容证据：服务器旧调度程序的 70 个静态依赖与历史 3b79276f 一致，没有已识别的迁移版本检查。旧源码使用目标依赖在独立 PG16.10/0166 合成库上通过计划保留与未到期不领取测试；完整原调度镜像测试仍未完成。计划中优先保留原调度业务程序/镜像，不把 API 回退镜像直接当成其原镜像替代品。

## 升级与回退命令评审稿

以下只用于评审，**本轮没有执行，不可直接粘贴运行**。缺少正式切换记录和前置门禁时不得执行。`commands.private.sh` 必须在未来获准变更准备阶段据当时容器标签生成并冻结 `SITE_API_ORIGINAL`、`SITE_WEB_ORIGINAL`、`SITE_SCHEDULER_ORIGINAL`、`QQ_ORIGINAL` 四个 Bash 参数数组，包含各自完整有序文件链、项目目录、项目名及显式 env-file；不得在回退时根据已重建容器重新推导旧链。文件不存密码。

`RELEASE`、`RECORD` 是未来已验证发布包和私有切换记录的实际绝对路径，当前尚未确认包已上传服务器；不能用任意旧包路径代替。`window-check.sh`、`paper-disable-reviewed.sh` 和各 JSON 覆盖文件尚未形成服务器可执行交付，属于显式缺项，不表示已经存在。

```bash
# 正式窗口前：校验包、镜像、新鲜双库备份；所有动作须另行授权。
export AGENT_DOWNLOADS_DIR=/www/gamehub-downloads/agent
export DESKTOP_DOWNLOADS_DIR=/www/gamehub-downloads/desktop
source "$RECORD/commands.private.sh"
exec 9>/var/lock/mooyu-agent-plugin-release.lock
flock -n 9

# window-check 同时检查实际环境、文件指纹、登录网关、论文状态、两库队列、
# outbox、provider calls、预算占用和 lease。不能用历史截图替代。
# 初检允许报告既有论文开关差异，但要求所有相关任务空闲，不放行升级。
bash "$RECORD/window-check-before-paper-stop.sh"
# 该单独审定脚本负责停止并持久关闭论文；不能由本预检擅自执行。
bash "$RECORD/paper-disable-reviewed.sh"
bash "$RECORD/window-check.sh"
"${QQ_ORIGINAL[@]}" stop --timeout 45 worker
"${SITE_API_ORIGINAL[@]}" stop --timeout 45 api
"${SITE_SCHEDULER_ORIGINAL[@]}" stop --timeout 45 agent-blog-public-scheduler
bash "$RECORD/window-check.sh"

# target-first-install.json 是从原 API 私有解析结果派生的已审核覆盖文件：
# 复用原 Agent、主密钥和 token；仅新增共享执行器并指定已验证目标镜像。
# 不把 secret 写入本公开文档或 QQ worker，不篡改既有策略/授权范围。
"${SITE_API_ORIGINAL[@]}" -f "$RECORD/target-first-install.json" \
  run --rm --no-deps --pull never api node apps/api/src/migrate-cli.mjs
"${SITE_API_ORIGINAL[@]}" -f "$RECORD/target-first-install.json" \
  run --rm --no-deps --pull never api node apps/api/src/agent-interaction-bootstrap-cli.mjs
"${SITE_API_ORIGINAL[@]}" -f "$RECORD/target-first-install.json" \
  up -d --wait --wait-timeout 90 --no-deps --no-build --pull never api agent-interactions
# 原调度镜像本体兼容门禁通过后，才恢复该原角色；计划行不改。
"${SITE_SCHEDULER_ORIGINAL[@]}" -f "$RECORD/original-scheduler-image.json" \
  up -d --wait --wait-timeout 90 \
  --no-deps --no-build --pull never agent-blog-public-scheduler
"${QQ_ORIGINAL[@]}" -f "$RECORD/target-qq.json" up -d --wait \
  --wait-timeout 90 --no-deps --no-build --pull never worker
"${SITE_WEB_ORIGINAL[@]}" -f "$RECORD/target-web.json" up -d --wait \
  --wait-timeout 90 --no-deps --no-build --pull never web
```

回退须使用切换后重新采集的指纹与实时空闲状态。下列步骤承接同一锁及已冻结原参数数组；有不确定投递或未完成任务时停止，不通过删记录绕过。

```bash
bash "$RECORD/window-check-current.sh"
"${QQ_ORIGINAL[@]}" -f "$RECORD/target-qq.json" stop --timeout 45 worker
"${SITE_API_ORIGINAL[@]}" -f "$RECORD/target-first-install.json" \
  stop --timeout 45 api agent-interactions
"${SITE_SCHEDULER_ORIGINAL[@]}" stop --timeout 45 agent-blog-public-scheduler
bash "$RECORD/window-check-current.sh"
# rollback-api.json 固定 schema166 兼容回退镜像 22b7b18c…；保留全部追加表。
"${SITE_API_ORIGINAL[@]}" -f "$RECORD/rollback-api.json" up -d --wait \
  --wait-timeout 90 --no-deps --no-build --pull never api
"${SITE_SCHEDULER_ORIGINAL[@]}" -f "$RECORD/original-scheduler-image.json" \
  up -d --wait --wait-timeout 90 \
  --no-deps --no-build --pull never agent-blog-public-scheduler
"${QQ_ORIGINAL[@]}" -f "$RECORD/rollback-qq.json" up -d --wait --wait-timeout 90 \
  --no-deps --no-build --pull never worker
"${SITE_WEB_ORIGINAL[@]}" -f "$RECORD/rollback-web.json" up -d --wait --wait-timeout 90 \
  --no-deps --no-build --pull never web
# agent-interactions 保持停止；论文仍关闭；不执行 down -v、恢复旧库或清预算。
```

以上命令仅界定可审核顺序。待补：冻结实际数组/指纹、门禁脚本、目标/回退覆盖文件及秘密安全继承、新鲜备份、原调度镜像完整兼容验收、论文持久关闭策略。因这些缺项，本地标准 release-plan 工具仍应拒绝生成 ready=true；不得强置证据字段绕过。

原调度/QQ/Web 的镜像覆盖文件也必须固定采集到的完整 image ID，不依赖原 tag 仍指向旧内容。原来暂停的进程不加入上述恢复清单；本例三个角色在当前采集时均运行，正式窗口还须复查。

尚缺：原 Compose 解析环境一致性及 env-file 来源、线上预算实际配置与默认值、迁移目录 checksum 对齐、所有 Agent 执行角色与在途 outbox/租约完整性、发布包在服务器的可用性、调度角色回退兼容性、新鲜备份及正式变更授权。独立论文 worker 当前启用，必须列入正式方案。现有证据支持继续准备，**不支持直接部署或标记预检全部通过**。
