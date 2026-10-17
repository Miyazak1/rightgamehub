# 墨鱼工坊交互课件参考包

这些参考包共同验证 `mooyu.courseware` v1 的通用边界，而不是限定视觉风格：

- `concept-explorer`：用同一个二次函数引擎支持教材探索、F2 曲线沙盒和命中目标点挑战。
- `causal-simulation`：用同一个力学引擎支持教材实验、F2 自由搭建和救援投送挑战。
- `projectile-motion`：用二维抛体引擎支持速度分解、星球参数沙盒和山谷救援挑战。
- `algorithm-stepper`：用同一个化学平衡引擎支持教材实验、F2 反应器沙盒和安全生产挑战。
- `kinematics-motion`：用一维匀变速引擎把真实运动与 x-t、v-t、a-t 图像同步，并支持自由方案与双窗口挑战。

新课件应使用 `@mooyu/courseware-ui-kit` 的壳层合同。规范源位于 `packages/courseware-ui-kit`，发布课件在 `modules/ui-kit` 中携带可校验、可热替换的副本；宿主负责语言切换，课件内部不要再放第二个语言入口。

UI Kit 检查与同步：

```text
npm run courseware:ui-kit:check
npm run courseware:ui-kit:sync
```

复制最接近的目录到用户工作区，再编辑课程结构、证据、验收路径和 `dist` 静态产物。不要直接修改已安装插件中的模板。

每个参考包都在 manifest 中声明 `experience`。Doctor 会检查三种体验是否齐全、自由实验是否真的支持对象增删与状态快照、挑战是否有机器可判定的成功条件；只换文案或只暴露一个滑块不算自由实验。

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
