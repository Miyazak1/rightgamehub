# GameHub 最小双人回合制模板

此模板只演示接入边界，不代表完整游戏设计。客户端使用 `@gamehub/web-game-sdk` 通过父页面的 MessageChannel 建房、加入、准备、开始、提交命令、重连同步和认输；它不会接触登录 token、realtime ticket 或 WebSocket 地址。

在仓库根目录执行：

```bash
npm run multiplayer:doctor -- templates/multiplayer-turn-based
npm run multiplayer:templates
```

输出的 `artifacts/gamehub-multiplayer-starter-web.zip` 可作为 Web ZIP 上传；源码模板包会附带从当前 workspace SDK 生成的 `vendor/` 制品，可在普通静态 HTTP 服务中直接运行，不依赖 CDN。机器可读 Doctor 报告与双账号验收步骤见 `docs/62-multiplayer-local-test.zh-CN.md`。

`rules/adapter.cjs` 是提交给平台审核的服务端权威规则示例，不会被放进客户端 Web ZIP。作者不能签署平台可信清单；平台审核后在受控环境构建、计算摘要、离线签名并部署。
