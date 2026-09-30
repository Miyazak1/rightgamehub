# 联网游戏 15 分钟快速开始

当前作者 SDK 为 `@gamehub/web-game-sdk`，桥协议为 `gamehub.web-game.v1`；准确包版本以各包 `package.json` 和开发者中心页面为准。

1. 运行 `npm run multiplayer:doctor -- templates/multiplayer-turn-based`，确认官方模板没有 error。
2. 运行 `npm run multiplayer:templates`。`artifacts/gamehub-multiplayer-starter-web.zip` 是客户端上传包，`gamehub-multiplayer-starter-source.zip` 是可复制源码与规则审核材料。
3. 创建 GameHub 作品，上传 Web ZIP。它的 `platform.json` 必须声明 `"capabilities":["multiplayer"]`。
4. 使用两个独立账号：A 建邀请房，B 加入，双方准备，A 开始；分别提交合法命令与非当前玩家命令；刷新一方后确认权威 snapshot 恢复；最后认输。
5. 修改 `creator-submission.json`、`rules/adapter.cjs` 和 `rules/tests.json`，再次输出 JSON 报告并复用生产 ZIP Validator：`npm run multiplayer:doctor -- ./my-game --web-zip ./my-game.zip --json --output ./artifacts/creator-doctor.json`。
6. 把规则源码、bundle、测试、报告和客户端 ZIP 交给平台审核。作者不能取得 Ed25519 私钥，也不能自行把规则标为“平台可信”。

客户端只发送意图。账号、房间、ticket、WebSocket、commandId 幂等、revision、快照、重连和回放由平台负责；游戏负责命令合法性、确定性转换、终局、私密视图和表现层。

单机作品不需要修改 manifest；只有显式声明 `multiplayer` 的已验证版本才建立多人桥。
