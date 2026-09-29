# DeepSeek Harness：游戏平台侧栏接入核查

核查日期：2026-09-22。初次核查对象为 `deepseek-ai/deepseek-harness` 官方项目公开的 `master` 文档和源文件；当时未安装或启动宿主。

**后续进展**：已在 `E:\DEEPSEEKHARNESS` 完成源码构建并启动 Web 界面，检查版本为 `0.1.7-alpha.1`、提交 `c36a83ff6bb95e3f82cf79f9be7c724270a8aa61`。尚未制作或安装游戏平台插件，也未验证其他桌面发行版。最新产品形式、生命周期与实施范围见 [12 Harness 游戏平台方案](./12-harness-game-platform-plan.zh-CN.md)。

## 结论与产品边界

**有公开的右侧界面扩展路径，可以按独立插件方向开发游戏大厅，无须为此维护一个自研 Harness 客户端。**这是文档和源码层面的可行性判断，尚不是游戏平台插件运行通过。

平台仍承载作者上传的免费网页小游戏、网页 3D 和互动项目。用户继续使用原来的、版本兼容的 Harness 宿主，通过安装平台插件进入游戏大厅。自研 Codex 客户端与修改官方客户端不作为主要分发路线。

## 已核查的接口

| 证据 | 对本项目的意义 |
| --- | --- |
| `ctx.sidebarRightTabs.register(...)` | 注册游戏大厅自己的 tab 类型 |
| `ctx.slots.register(...)`，席位 `sidebar.right.pane.tab` | 挂载自定义大厅组件，界面不必采用通用浏览器的地址栏 |
| `ctx.sidebarRight.openTab(...)` | 从入口打开游戏大厅 |

[官方右侧栏说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-sidebar-right/README.zh.md)描述这些扩展点。[右侧栏实现](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-sidebar-right/src/client/index.ts)提供注册表与内容席位；[文件树插件实现](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-sidebar-files/src/client/index.ts)实际使用相同的类型注册与组件挂载路径。

检查的现成右栏按会话组织。没有活动会话时不提供这一停靠面；当前本地版本另提供 `keepMounted` 保留组件的选项。保留 DOM 不代表游戏已暂停、已存档或自动跟随新会话显示，必须另验生命周期，具体策略见 12。

## 插件分发与更新

官方插件管理器支持输入包名、Git 地址、压缩包或本地路径来安装组合包，再启用其中的插件；宿主需要支持受管 profile。应把平台适配器打包为符合其格式的组合包。当前尚未制作此包，也没有可交付的安装命令。[插件管理说明](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/client/ui-plugin-manager/README.zh.md)

用户沿用宿主本身的升级渠道，平台维护自己的服务与插件兼容性。**不保证每次宿主升级都无需适配**：官方当前明确标注开发者预览，并提示将出现不兼容变更。发布前应记录实测宿主、运行时与插件版本，逐版验证。[项目状态](https://github.com/deepseek-ai/deepseek-harness#developer-preview)

社区的不同桌面封装可能使用不同运行时和插件组合，不能把官方源码中的能力直接等同于所有桌面安装包已经支持。

## 最小实现与验收

以下为本平台设计，尚未实现：

1. 在兼容的现成 Harness 环境中安装游戏大厅插件，打开右侧独立功能区。
2. 大厅访问平台目录 API；作品在独立来源、受限 iframe 中运行。作者上传游戏，不需要把每个作品安装为 Harness 插件；游戏不能获得宿主工具、文件权限或私有通信接口。
3. 先接入已有 Canvas 示例和桌猫网页样本，再测一个 WebGL 作品；验证键鼠、音频启动、尺寸变化、存档与刷新恢复。
4. 验证折叠、关闭、切换会话、宿主重启及插件停用，明确暂停、保存、重载和清理行为。
5. 在第二个兼容的干净环境中安装同一插件包，确认其他用户可以使用；随后测试一个目标升级版本。

普通 Windows EXE 仍不能仅因宿主有侧栏接口就在其中运行。原生嵌入或串流继续执行 [EXE 验证计划](./09-exe-sidebar-validation.zh-CN.md)；本次不扩大原生 EXE 的证据范围。
