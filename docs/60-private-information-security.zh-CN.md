# 私密信息设计与安全禁区

浏览器不是秘密边界。手牌、阵营、隐藏目标和战争迷雾必须保存在服务端权威 state 中，再由 `getPlayerView(state,userId)` 为每位玩家裁剪。`getSpectatorView` 和公开 event 只能包含所有观众都可见的信息。

禁止先把完整状态发到浏览器再用 CSS 隐藏；禁止把秘密字段写进日志、错误消息、公开事件或公共回放；禁止让客户端决定胜负。Creator Doctor 的私密哨兵会捕获明显串线，但启发式检查不能证明没有泄漏，发布前必须用两个账号审查网络消息和回放。

Web ZIP 永远不能读取登录 token、refresh token、realtime ticket 或 WebSocket 地址。只能使用 `@gamehub/web-game-sdk` 经父页面的专属 MessagePort 请求白名单能力。不要读取父页面 DOM，不要构造任意 HTTP 代理，不要把服务端规则代码塞入 ZIP 交给 API/Realtime 执行。

平台 Ed25519 私钥只存在离线或受控发布机器，不进入 Git、容器、服务器环境变量或作者工作区。签名表示平台批准了特定清单字节，不替代代码审核和规则测试。
