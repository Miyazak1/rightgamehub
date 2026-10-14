# 墨鱼工坊交互课件参考包

这三个参考包共同验证 `mooyu.courseware` v1 的通用边界，而不是限定视觉风格：

- `concept-explorer`：参数驱动的概念可视化。
- `causal-simulation`：控制变量与因果反馈。
- `algorithm-stepper`：可暂停、可追踪的步骤演示。

复制最接近的目录到用户工作区，再编辑课程结构、证据、验收路径和 `dist` 静态产物。不要直接修改已安装插件中的模板。

校验命令：

```text
node <plugin-root>/bin/creator-toolkit.mjs doctor <absolute-courseware-directory>
```

完整本地闭环：

```text
creator-toolkit init concept-explorer <new-directory>
creator-toolkit inspect <directory> --json
creator-toolkit doctor <directory>
creator-toolkit preview <directory>
creator-toolkit test <directory> --browser-module <existing-playwright-module>
creator-toolkit build <directory>
creator-toolkit package <directory>
```

`preview` 只绑定 loopback。`test` 不会自动安装 Playwright 或浏览器；缺失时会明确停止。`build` 使用内容摘要目录，`package` 输出确定性 ZIP，均不会静默覆盖不同内容。

本地通过只代表结构、引用和入口符合 L0 契约；发布仍需平台扫描，内容仍需作者或学科专家审校。
