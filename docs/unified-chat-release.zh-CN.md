# 平台 Agent 统一发布（不含论文）

本次从 `codex/release-practice-no-paper` 的已发布提交建立独立发布工作区，合入已完成的全局助手、做题辅导、游戏与工具查找和打开、个人学习数据查询，不带入开发工作区的未提交修改。发布仍使用 `codex/release-practice-no-paper` 渠道。

| 产物 | 版本 |
|---|---|
| Windows x64 桌面端 | 0.2.0-preview.8 |
| Harness | 0.1.30 |
| Cursor / VS Code | 0.4.2 |
| Codex / Claude portable marketplace | 0.4.2 |

论文网页入口、MCP 工具和能力发现保持关闭；Compose 四个论文开关固定为 false，不启动新的论文服务或 worker。只有原来运行的应用服务会更新；数据库、Redis 不重建，也不启动其他可选服务。

## 宝塔文件准备

把已验证的 `mooyu-unified-20261115-agent.tar.gz` 通过宝塔文件管理器上传到：

```text
/www/backup/gamehub/incoming/mooyu-unified-20261115-agent.tar.gz
```

安装包不放进 Git 或网页 Docker 镜像。仓库的 `config/unified-release.json` 固定此归档的 SHA-256、大小和版本；脚本在修改源码或服务之前验证归档，拒绝错误、损坏或带路径穿越的文件。分发包仅有客户端、插件、公共清单和公钥，不包含密钥、账号、profile 或工作区文件。

## 模型配置

插件直接使用宿主聊天，不需要墨鱼的模型密钥。网页与独立桌面聊天需要 API 服务端的 `DEEPSEEK_API_KEY`；请在宝塔上私下配置 `deploy/.env.prod`，不要把密钥发送到聊天或写入命令历史。

下面命令显式启用 `PLATFORM_ASSISTANT_ENABLED=true`；未配置密钥时会在更新前停止。如果只发布界面和插件，可明确改成 false，网页/独立桌面端会显示助手未配置，而非生成模拟回复。

## 宝塔终端执行

使用最终交付的完整 40 位 SHA 替换 `完整发布SHA`。不使用开发分支，也不要 reset/clean 本地改动：

```bash
bash <<'BASH'
set -euo pipefail
cd /www/gamehub
git fetch origin codex/release-practice-no-paper
MOOYU_RELEASE_SHA=完整发布SHA
export PLATFORM_ASSISTANT_ENABLED=true
git show "$MOOYU_RELEASE_SHA":deploy/prepare-unified-release.sh > /tmp/mooyu-prepare-unified-release.sh
bash /tmp/mooyu-prepare-unified-release.sh "$MOOYU_RELEASE_SHA" /www/backup/gamehub/incoming/mooyu-unified-20261115-agent.tar.gz
BASH
```

更新采用互斥锁，拒绝并行部署、服务器本地改动、不能快进的版本和旧迁移变化。它读取实际运行网关的 Compose 文件列表，备份所有覆盖文件；追加只读分发挂载，保留已有配置。现有 Caddy 二进制及 DNS 插件继续复用。

旧镜像、数据库、Compose、环境和公共清单先备份。先放置不可变安装包和插件，再构建并校验应用；最后切换清单，通过原网关的 HTTPS 比对实际响应与已验证文件。失败时恢复旧清单和兼容镜像，保留用户数据和版本化文件。完整记录及人工回滚命令在终端输出，不要把其中的环境备份发到聊天。

## 分发和更新行为

安装包和插件使用本次本地验证的精确字节；网关先读受管分发目录，未覆盖的旧插件仍可回退到原静态目录。这样不会因 Windows/Linux 换行或构建环境不同而让同版本文件哈希发生变化。Agent 更新脚本本身也按清单的哈希分发。

通过官方流程安装并启用更新的插件会检查新清单；新版就绪后需要重启或重新加载宿主。旧版 Harness 缺少会话接口时仍可打开平台并复制题目，不因聊天服务依赖阻断整个插件。

当前旧桌面 preview.3 不含更新器，需要手动安装一次 preview.8。新包内置现有发布公钥，后续通过签名清单验证并在确认后重启更新。清单 Ed25519 签名与 Windows Authenticode 不同：安装器仍是未签名预览包，不宣称 Windows 已信任发布者。

签名更新清单有效期为 7 天；过期会停止更新，不影响已安装程序继续运行。需发布时续签清单，私钥只留在本地发布机器，不上传服务器。

## 发布后检查

1. `/ready` 就绪，160 条迁移核验一致；论文 API 和工具入口仍关闭。
2. `/download` 显示 preview.8，完整下载、HEAD 和 Range 正常。
3. `/downloads/manifest.json` 显示 Harness 0.1.30、编辑器和 portable 插件 0.4.2，实际文件哈希与清单一致。
4. 登录后测试练习即时判题、题目提示与讲解、游戏和工具查找/打开、学习概览/历史/错题、跨页面保留，以及插件使用宿主聊天。

本次已完成本地包审计和隔离升级验收；不将这些结果冒充正式账号登录或生产部署结果。实际更新由你执行以上宝塔命令。
