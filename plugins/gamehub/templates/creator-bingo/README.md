# Bingo Agent 创作包模板

让用户在自己的 Agent 中修改 `source/bingo.json`，不要生成任意 HTML，也不要把模型 API Key 写入本目录。

本地检查：

```bash
npm run creator:validate -- ./templates/creator-bingo
```

通过后，Agent 将 manifest 和结构化源码提交到平台草稿 API；平台负责再次校验、固定编译、隔离预览和发布。

已登录 GameHub 的 VS Code / Cursor 中，可打开命令面板执行：

```text
GameHub: 提交当前创作包
```

使用 GameHub Harness 系统凭据桥时，也可以在平台仓库中运行：

```bash
npm run creator:submit -- ./templates/creator-bingo
```

命令只创建当前账号可见的待发布草稿，不会自动公开。平台 token 不写入创作包、环境变量或命令行参数；没有登录态时会显示 GitHub 设备授权地址和一次性代码，授权后的凭据进入 Git Credential Manager。

首次提交后会在 `.gamehub/draft.json` 保存草稿 ID、revision 和内容 SHA-256；该目录已加入模板 `.gitignore`。再次提交会更新同一草稿。若网页端已经产生新修订，Agent 会报告冲突并停止，不会覆盖网页修改。
