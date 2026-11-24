# QQ 渠道插件真实群验收

2026-11-21，在 `codex/qq-channel-plugin` 分支、实现提交 `d4066e1e` 上完成。只操作独立本地环境，线上服务没有切换。测试群为 905757031，提问账号 495469022，机器人 3922489710。请求由用户在 QQ 中真实发送，未用夹具代替真实请求。

## 运行与保留边界

API 使用本分支源码；worker 复用已验证镜像依赖，只读挂载本分支 API／QQ 源码及 `qq-channel-plugin-lab-worker.mjs`。该包装器通过共享宿主 `bindChannel` 装配 `mooyu.qq@1.0.0`，执行真实 `start/run/close` 生命周期，控制接口确认 `managed=true`、`executionMode=agent`、`started=true`。研究任务仍由 `mooyu.github@1.0.0` 执行。

切换前已备份两个本地数据库并用 `pg_restore --list` 验证；旧 worker 保留为停止状态，原 QQ 登录网关全程未重启。会话及备份留在私有目录，不提交凭据。原27条交互、24条 QQ 消息、4页旧图片及其实际内容 SHA、旧文章、计划、参与者授权均逐项保持。QQ `settings`、`control_settings` 还与切换前数据库备份的 COPY 数据核对一致。独立环境原定时计划保持关闭，没有改动线上定时文章。

测试前原累计39次调用、输出额度接近上限。用户明确授权仅对此独立环境新增策略版本：调用总上限48→56、输出 token 总上限100000→140000，输入额度不变、费用总上限仍8美元；旧策略和累计用量保留，没有清零。验收结束累计47次调用。本次未启用论文，论文 Run 数保持不变。

## 真实结果

| 项目 | 结果与证据 |
| --- | --- |
| 普通聊天 | 交互 `2c7c6086-7764-52eb-8cc1-31001b22d3ff` 完成，群回复“渠道已连接”，远端消息 `1608167067` 的完整文本核对通过。 |
| 源码继承与自动补读 | 不带新项目链接的请求产生任务 `7f0eafe8-2e76-5ace-8970-cf1bc2ef84ec`，继承 antonmedv/finder，固定版本 `a8d83110d3d035e029c571b94965b629a10a469f`。先读取 finder.ts／测试文件第1–140行，refine 指定 finder.ts 第231行，再实际执行成功的 extend-file 工具读取第231–370行，解释 selector() 的层级拼接。远端最终消息 `851760811` 完整文本核对通过；用户确认完整收到。 |
| 写作与分页图片 | 任务 `c33051c4-fa8a-5260-865c-7099e8f61fec` 生成文章 revision `f7536ef3-296d-45fa-842b-13090e839b06`，网站状态为 draft。4页均与该固定 revision 重新渲染结果 SHA 一致；每页远端消息恰有一张图片，顺序和群历史核对通过。用户确认4页完整、顺序正确、无重复，抽查首尾导出图片可读。 |

4页远端消息依次为 `704618675`、`1504862790`、`704511253`、`1335487025`，每页 `send-started` 计数均为1。末页包含参考资料，页脚为4/4、草稿、未发布。

## 幂等与重启

分别重放数据库中保存的真实源码与文章 QQ 请求，均返回原 interaction／task，累计调用47、文章4、QQ消息32均未增加；原网站请求重放也复用原交互。

确认待投递数为0后，仅重启插件测试 worker。启动时间为 `2026-11-21T14:07:22.480824507Z`（北京时间22:07:22），晚于所有图片投递。恢复后 QQ 为 loggedIn／connected／accountMatches，插件仍启用并处于共享 Agent 模式。再次核对所有新消息及分页账本：消息 ID、内容 SHA、revision、投递时间与发送次数均未变化；真实群历史仍只有这4页，累计调用仍47。原登录网关启动时间、镜像及挂载未变化，无需重新扫码。

本轮验证覆盖投递完成后的空闲 worker 重启。发送中断、不确定回执的阻塞与人工核对沿用已有离线／隔离数据库测试，本轮没有在真实群故意制造未知发送或重启登录网关。

## 本地证据与复查

证据目录：`E:\CodexData\build\Right\qq-channel-plugin\live\20261121130416401`。

- `channel-plugin-live-acceptance.json`：插件运行状态、聊天／源码远端文本、文章及图片校验、保留检查。
- `channel-worker-restart-proof.json`、`before-worker-restart.json`：重启前后比较及恢复登录状态。
- `qq-question-replay.json`、`qq-admission-replay.json`：真实请求重放防重。
- `control-permission-proof.json`、`backup-verification.json`、`channel-budget.json`：备份、权限和已授权额度变更。
- `user-confirmation.json`、`pages/page-01.png` 至 `page-04.png`：用户确认和与实际发送账本一致的图片。

本地会话文件保留在 `E:\CODE\Right\private-deployments\qq-channel-plugin\20261121130416401\session.private.json`，不要打印或提交其内容。在本工作树执行 `node scripts/qq-channel-plugin-live.cjs <私有会话路径> --verify` 可复查；该操作读取本地服务并写本地证据，不创建研究任务或发送群消息。三个验收脚本语法检查、`git diff --check` 通过。此前业务代码66项单元／兼容及17项隔离数据库测试结果继续有效，本轮未更改业务实现。

本地测试环境继续保留；尚未打包包含 QQ 渠道插件的新发布镜像，也未推送或部署线上。
