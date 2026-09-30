# 联网游戏发布检查清单

- Web ZIP 根目录含合法 `platform.json`、入口和 `multiplayer` capability，所有资源离线可用。
- 客户端使用当前 `@gamehub/web-game-sdk`，不持有 token/ticket，不直连 realtime。
- 规则 bundle identity 与提交说明一致，小于 1 MiB，固定输入可重放。
- 合法命令成功；非当前玩家、错误参数和旧 revision 被拒绝；重复 commandId 不产生第二组事件。
- 玩家 A 看不到 B 的私密哨兵；观战视图和公开事件不含秘密字段。
- 刷新和短时断线后由权威 snapshot 恢复；认输、超时和正常胜负都产生唯一终局。
- Creator Doctor JSON 报告无 error；warning 已逐项人工确认。
- 客户端 ZIP、规则提交、平台审核签名、模式注册和双账号验收是五个独立阶段。
- 平台运营用受控构建生成摘要和签名，同时部署 API/Realtime 的只读规则目录，再注册模式。
- 旧 rulesetVersion 在活动对局和回放保留期内继续可用；回滚同时恢复完整 rules 目录、清单和公钥。

Creator Doctor 通过不等于安全审核通过。真实双账号、生产镜像和部署一致性仍需平台执行。
