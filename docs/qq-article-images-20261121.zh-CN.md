# QQ 文章分页图片：本地实现与验收

日期：2026-11-21。分支 `codex/agent-plugin-github`，基线 `5c3cac3e`。仅本地实现及隔离测试，未推送、部署或切换当前真实 QQ 验收实例，未重启登录网关或改线上配置，论文继续关闭。

QQ 写文章继续调用共享 GitHub 插件。新完成的文章任务额外固定 `articleRevisionId`；QQ bridge 获取该任务的图片页，按顺序进入原投递账本，再使用 OneBot 原生 image 消息段发送。不会仅发送文章摘要或后台链接代替正文。

## 输出与保留行为

- 正文标题、摘要、段落、列表、继续追问与参考资料全部渲染为 PNG；有引用编号、页码和草稿／文章标识。长内容按行分页，英文词和中文标点尽量完整换行。
- 每页 1080×1600，最多 24 页、每页 PNG 不超过 1 MiB；超出范围明确记录图片生成失败，不静默截断正文。SVG 只含转义文字，不加载远程图片、网页、字体或脚本。
- API 使用已有 sharp 依赖，本轮未安装或替换依赖。渲染宿主需具备中文字体：本地已用 Windows 中文字体完成检查；未来 Linux 部署前仍需验证字体与实际 QQ 图片上传。没有改线上字体或服务。
- 新任务固定文章 revision 与完成时的发布状态；随后编辑／发布文章不会改变这批图片读取的正文或页脚。图片生成不会发布草稿。
- 每页字节、SHA256、版本、页号持久存入 `mooyu_qq.agent_image_pages`；所有页获取且校验完整后，在同一个事务里入账并结算源任务。页面消息 ID 按任务和页号确定，重复轮询不会重复建页。
- 后页只有在前页明确 `delivered` 后才可发送。重启后继续发送未投递页；前页 `needs-review` 或失败会阻止后页。沿用原“发送意图先入账、未知结果不自动重发”的机制，图片上传回执等待上限至少 60 秒。
- 获取图片和每一页真正发送前，均重新检查 Agent、QQ 机器人／群／用户范围、写作权限及插件启用状态。撤权后不能靠已排队图片继续读取私有文章。
- 图片生成的临时失败会等待重试；明确不可渲染的内容会保留文章，并给出文字通知，事件中记录原因，消息错误码 `QQ_AGENT_IMAGE_RENDER_FAILED`。不在日志写入正文、凭据或 Base64。

原文字聊天、GitHub 查找及源码问答继续走文字链路。旧完成记录不改写，没有 revision 的历史文章任务保持旧文字回执，不补发历史图片。网站 Chat、定时文章的计划、发布策略、权限和预算未修改；本地已有测试定时计划继续保持关闭。

## 接口与部署兼容

原签名 `/v1/internal/agent/qq` 接口新增 `article-image`（带页号）和 `article-image-access` 操作，复用 HMAC 与原请求者会话范围。没有公开草稿图片 URL；工作节点只传原生 PNG Base64 到 QQ 网关，不共享宿主文件路径。

QQ 的 `enableAgentBridge` 通过幂等建表增加图片页账本，不删除或更新既有消息。API 和 QQ worker 需一起升级，才会启用新任务的图片输出。旧 worker 仍可消费新任务的原文字结果。当前真实测试 worker 保持原工作树，未执行这次新建表或切换操作。

## 验证结果

51 项单元／兼容回归通过，17 项隔离数据库回归通过。最后的换行调整另通过 4 项图片测试；最后的错误记录字段调整再通过完整图片数据库链路。一次性 PostgreSQL 数据位于内存，容器由 runner 删除；模型与 GitHub 使用离线适配器，无真实调用额度消耗。

覆盖实际 PNG、SHA256／页号校验、混合版本拒绝、真实 localhost WebSocket 原生 image 段、签名 API、真实草稿 revision、逐页持久化、重建 worker 后续发、重复轮询、未知前页阻塞、入账后撤销写作权限拦截、原 Chat/QQ/插件／定时工作流兼容。

数据库图片测试使用真实文章写作执行器和真实任务、权限、工具／模型账本，经过签名客户端及 API。QQ 入站和外部发送为隔离测试夹具，**尚未向真实 QQ 群发送这批图片，也未宣称真实手机端图片验收通过**。

只读使用已有本地测试草稿生成 4 页预览，检查了首、中、末页中文字形、段落、引用、页脚与边界。输出：

`E:\CodexData\build\Right\agent-plugin-github\article-images\preview`

该目录包含 `page-01.png` 至 `page-04.png`、对应 SVG 排版源、记录固定 revision／大小／SHA256 的 `manifest.json`。测试日志位于其父目录：`unit-tests.log`、`database-tests.log`、`image-final-tests.log`。

复现命令（只读既有测试草稿，不发群）：

```powershell
node scripts/render-agent-article-preview.cjs <本地私有验收会话路径> E:\CodexData\build\Right\agent-plugin-github\article-images\preview
node --test tests/platform/agent-article-images.test.mjs tests/platform/qq-channel.test.mjs tests/platform/agent-interaction.test.mjs
node scripts/test-researcher-qa-db.mjs tests/platform/agent-article-images-db.test.cjs
```

后续若做真实群验收，应先保存当前现场，核对无运行中任务，再仅切换本地 API／QQ 消息 worker 的新代码，保留原网关及登录数据卷；通过一条新写作请求检查实际图片上传和分页显示。线上部署另行处理。
