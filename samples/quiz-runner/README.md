# Quiz Runner（团队答题赛）GameHub 适配包

这是对 [Yobin Timilsena 的 `quiz-runner`](https://github.com/yobin-tim/quiz-runner) 的平台兼容适配。原作采用 MIT 许可。

## 适配内容

- 以中文入口统一“示例比赛、创建题库、继续自定义比赛、查看结果”四条路径；
- 将上游同步 `localStorage` 改为 GameHub `localSave` 的同步内存镜像与串行持久化；
- 将快照和成绩导出改为 GameHub `fileExport` JSON，避免隔离 iframe 阻止浏览器下载；
- 创建器不再下载孤立 HTML，而是把题包保存到本机存档后直接进入比赛；
- 保留快照 JSON 导入和只读结果页；
- 保留原作者署名、MIT 许可和固定上游提交记录；
- 不使用 CDN、远程接口、Cookie、账号令牌或云存档。

这是单设备主持模式，不是联网抢答。主持人在电脑或平板上控制队伍、抽题、计时、判定、传题与加赛。

## 构建

```bash
npm run build:quiz-runner
```

生成 `artifacts/quiz-runner-gamehub-v1.zip`，ZIP 根目录包含 `index.html`、`platform.json`、许可、运行页与全部 SDK 文件，可直接上传为 Web 作品。

推荐作品信息：

- 名称：`Quiz Runner：团队答题赛`
- 类型：`游戏`
- 简介：`为聚会、社群和线下活动准备的主持人答题赛：自定义题库、自动计分、计时、传题、加赛并导出结果。`
- 作者署名：`Original project by Yobin Timilsena · GameHub compatibility adaptation`
