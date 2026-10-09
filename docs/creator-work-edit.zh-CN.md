# 创作中心：编辑作品资料

创作中心每件作品提供「编辑资料」，进入 `/creator/works/:workId/edit`。页面读取当前账号的作品列表并预填资料。可编辑标题、介绍、玩法说明、预计时长（1–30 分钟）、最多 6 个标签、Coding Agent、GitHub 仓库与 SPDX 许可证；类型只读。新建和编辑共用字段组件及校验，保留已有自定义 Agent 和时长，不把它们重置为下拉默认值。

已公开作品保存后，公开详情立即显示新的资料。编辑不上传或替换游戏包，不修改发布指针、排行榜定义、存档策略或游玩地址。列表中的修订号标为「资料版本」，与游戏包版本区分。

## 保存与并发

复用现有 `PATCH /v1/creator/works/:workId`。API client 的 `updateWork(workId, revision, body, options?)` 自动添加幂等键和 `If-Match: "work-{id}-{revision}"`；认证刷新后保留同一幂等键。编辑表单对同一资料版本、同一提交内容的网络重试复用原键；用户修改内容或重新载入后使用新键。

412 冲突保留表单内容，阻止继续提交，明确提示重新载入最新资料。用户主动重新载入前可以复制输入；重新载入失败仍保留输入。服务端继续校验账号权限、作品归属、字段白名单、开源地址与许可证配对。`kind` 不在 PATCH 字段中；仓库与许可证可成对清空为 `null`。

保存成功返回创作中心，重新读取作品列表并显示成功提示。前端演示模式只在当前会话中保存演示资料。本功能不新增迁移，不修改线上历史数据。

## 验证

- `tests/client/work-edit.test.cjs`：PATCH 地址、ETag、自动幂等、认证刷新、显式重试键及共享资料约束。
- `tests/platform/work-edit-postgres.test.cjs`：真实数据库与现有 PATCH，公开详情更新、版本冲突、幂等重放、权限、类型不可变、配对清空，以及发布/排行榜/存档策略数据不变。
- `tests/client/work-edit-browser.test.cjs`：完整 App 与真实接口，预填、公开提示、只读类型、校验、冲突恢复、服务端已保存但响应丢失后的幂等重试、列表更新、草稿取消、窄屏布局。断言没有上传和发布请求。

数据库测试使用专用本地 `GAMEHUB_COMMUNITY_DATABASE_URL` fixture，每次创建和清理独立临时数据库。浏览器测试另需 `GAMEHUB_COMMUNITY_PLAYWRIGHT_PATH`。
