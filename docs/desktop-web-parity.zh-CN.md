# 桌面与网页功能对照

本次在 `codex/desktop-web-feature-parity` 独立分支检查共享客户端和两个 API SDK。完整 API 清单见 `apps/desktop/src/parity-inventory.mjs`，每个操作明确归入业务接口、账号接口、本地 URL、原生等价实现、主进程内部操作或关闭状态。测试会阻止后续新增接口遗漏分类。

| 功能 | 桌面处理 |
| --- | --- |
| 发现、游戏库、日志、学习、练习、全局聊天 | 沿用共享页面，使用主进程固定接口和账号会话 |
| 创作中心、作品发布、治理、平台运营 | 保留既有接入，补齐任务分页和项目筛选 |
| 社区动态、项目、活动、组队、审核、媒体 | 补齐固定接口；保留版本和幂等键；图片经二进制 IPC 重建 Blob |
| 猜百科成绩、排行榜、挑战、个人资料 | 补齐查询和写入接口 |
| 变化雷达、研究主题与证据、评估、研究节点 | 补齐现有网页操作，修复评估预测查询构造错误 |
| 云存档与历史恢复 | 保留字节数据、ETag 和幂等条件；运行中游戏仍需有效的游戏会话授权 |
| 能力宿主绑定、运行与制品 | 接入现有固定接口，插件继续使用宿主聊天 |
| 头像、封面、作品、规则 ZIP 上传 | 用户实际选中的文件换成单次、账号隔离的主进程凭据；不传文件系统路径到网页业务代码 |
| 社区图片、规则源码与构建包下载 | 主进程认证及刷新；受限字节读取；渲染端恢复 Blob |
| 分享卡片、推广图片、作品下载链接 | 同步生成本地协议 URL；分享图片代理；作品下载使用固定路径流式代理 |
| 本地工具、PDF 阅读器和云存档导出 | 允许可信界面产生的 Blob 下载，经原生保存流程；保留游戏 SDK 独立文件授权 |
| 外部资料、仓库和 Issue 草稿 | 在系统浏览器打开 HTTP(S)；禁止文件和自定义执行协议 |
| GitHub 登录与仓库安装授权 | 保留系统浏览器授权，账号令牌留在主进程；完成后返回刷新 |
| 论文研读与论文 Agent 操作 | 正式环境继续关闭，桌面双端拒绝调用；普通 PDF 阅读工具可用 |

验证分层：完整 API 分类检查、新增 JSON 操作逐项经过真实 SDK 与隔离账号服务、二进制和并发条件回归、独立 Electron 上传下载与图片验收、既有创作治理原生验收、全仓库测试以及安装升级验收。测试使用本地夹具，不代表对生产数据执行发布、治理或论文操作。

## 新版产物与验证

- 桌面 `0.2.0-preview.11`；Cursor / VS Code、Codex / Claude 插件 `0.4.3`；Harness `0.1.31`。
- 完整回归：359 个文件、1593 项通过、0 失败、79 项依赖条件跳过；另在独立本地 PostgreSQL 与 Chromium 补跑 30 个文件、97 项通过、0 跳过。多人房间用例在补齐“已迁移数据库”前置条件后通过，保留原始与重跑记录。临时数据库关闭磁盘同步以加速建表，不用于物理崩溃耐久性结论。
- 原生新增功能验收 11 项通过；既有创作与治理验收 8 项通过；preview.10 到 preview.11 的安装、升级、重装及卸载验收通过，正式用户安装未被操作。
- Windows 临时目录锁修复后，离屏缓存校验测试连续 8 轮通过；网页构建、插件包内容、桌面包审计、发布与回滚测试通过。
- 代码快照：`e21dc44a9bd5c22ea7747576ea15b47f6955456a`。统一发布的最终提交还包含固定源码与归档清单。

| 产物 | SHA-256 |
| --- | --- |
| `MooyuWorkshop-0.2.0-preview.11-x64-Setup.exe` | `cbd836dc290a8793d52f9277875ec1c5984be78d8c64f79c279394227e0ae7a0` |
| `mooyu-unified-20261116-desktop-parity.tar.gz` | `8151813fc67dc529fd5858198c1655a3407eb524a7e70df4b6bc71ae31e98fdf` |

先把统一归档通过宝塔文件管理器上传至 `/www/backup/gamehub/incoming/mooyu-unified-20261116-desktop-parity.tar.gz`，再在宝塔终端执行：

```bash
bash <<'BASH'
set -euo pipefail
cd /www/gamehub
git fetch origin codex/release-practice-no-paper
MOOYU_RELEASE_SHA=$(git rev-parse FETCH_HEAD)
export PLATFORM_ASSISTANT_ENABLED=true
git show "$MOOYU_RELEASE_SHA":deploy/prepare-unified-release.sh > /tmp/mooyu-prepare-unified-release.sh
bash /tmp/mooyu-prepare-unified-release.sh "$MOOYU_RELEASE_SHA" /www/backup/gamehub/incoming/mooyu-unified-20261116-desktop-parity.tar.gz
BASH
```

脚本会在变更服务前校验提交与归档，不匹配时停止。论文保持关闭；服务验证通过后才激活客户端分发清单。已接通更新的桌面端可检查更新，Agent 插件应用更新后需要重启宿主。
