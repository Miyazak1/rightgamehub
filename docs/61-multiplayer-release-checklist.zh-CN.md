# 联网游戏发布检查清单

- Web ZIP 根目录含合法 `platform.json`、入口和 `multiplayer` capability，所有资源离线可用。
- 客户端使用当前 `@gamehub/web-game-sdk`，不持有 token/ticket，不直连 realtime。
- 规则 bundle identity 与提交说明一致，小于 1 MiB，固定输入可重放。
- 合法命令成功；非当前玩家、错误参数和旧 revision 被拒绝；重复 commandId 不产生第二组事件。
- 玩家 A 看不到 B 的私密哨兵；观战视图和公开事件不含秘密字段。
- 刷新和短时断线后由权威 snapshot 恢复；认输、超时和正常胜负都产生唯一终局。
- Creator Doctor JSON 报告无 error；warning 已逐项人工确认。
- 客户端 ZIP、规则提交与审核、受控构建、离线签名、双服务部署、模式注册和双账号验收是彼此独立的阶段。
- 管理员批准构建后，确认 `multiplayer_rule_builds.state=ready`，下载平台生成的 bundle，并再次核对响应 `Digest`、构建报告和页面 SHA-256 一致。
- Builder 只生成 bundle 和摘要，不接触私钥、不修改签名清单，也不自动部署或注册模式。
- 平台运营用 `rules:release stage/sign/verify-release` 在离线发布机签署完整清单，再用 `deploy/rules-release.sh install` 部署不可变规则目录；API/Realtime 的 `/ready` 报告同一 manifest SHA-256 后再注册模式。
- 旧 rulesetVersion 在活动对局和回放保留期内继续可用；回滚同时恢复完整 rules 目录、清单和公钥。
- 执行一次 `deploy/rules-release.sh rollback` 演练，确认 previous 签名通过、双服务恢复同一摘要；步骤和证据格式见 [66](./66-multiplayer-rules-release-operations.zh-CN.md)。

Creator Doctor 通过不等于安全审核通过，`ready` 也不等于规则已上线。真实双账号、生产镜像、离线签名和双服务部署一致性仍需平台执行。
