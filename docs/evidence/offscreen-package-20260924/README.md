# 侧栏适配包 0.0.11 自动验收

- `automated-tests.txt`：完整 `npm test` 输出，61 通过、0 失败、0 跳过。
- `build-report.json`：插件和自有 ZIP 的大小、SHA-256，以及本轮真实界面尚未测试的明确状态。

新增链路测试使用实际文件、ZIP 解包子进程、下载响应流、缓存和哈希校验；游戏运行组件由测试替身记录参数。没有启动 Electron 游戏，没有操纵浏览器或其他应用。

完整实现、使用方法和未完成项见 [文档 25](../../25-offscreen-package-contract.zh-CN.md)。
