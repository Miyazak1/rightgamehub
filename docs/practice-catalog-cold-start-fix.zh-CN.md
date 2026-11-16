# 练习目录冷启动与部署诊断

生产日志确认：部署后 `/ready` 成功，随后的 `/v1/learning/practice/catalog` 在 15 秒后触发 `TimeoutError`，部署保护流程回滚。堆栈指向目录请求，不是机器人模型调用或选题校验失败。

目录本身不访问数据库、模型或外网。但原实现为了读取单元、范围和容量，会在 API 主进程同步载入 `capacity-v9` 及其全部历史容量模块；读取目录还会重复验证运行文件。正式 API 容器总内存限制为 384 MB，首次请求才触发这些工作。

本地独立进程测量：旧目录约 2.67 秒、RSS 196 MB；修改后约 0.33 秒、RSS 59 MB。它们不是生产测量，不能单凭这些数字宣称线上 OOM 或排除其他资源竞争。已确认并修复的是目录展示不必要地加载完整库存的开销，线上效果仍需实际重试验证。

## 改动

- 将冻结版本的目录元数据投影为约 39 KB 的 `catalog-summary.json`，仅包含原有单元、范围、容量和采样模式，不包含题目、答案或库存记录。
- 在受版本控制的 `integration.json` 中固定摘要 SHA-256；摘要绑定同一 1.43.0 应用版本及同一冻结 release manifest。
- `.gitattributes` 固定摘要为 LF 换行，避免 Windows 自动换行改变其 SHA-256；Git 过滤前后对象哈希已核对一致。
- 目录仍调用 `status()`，验证原始归档及运行清单的全部 1152 个文件；不跳过完整性检查。通过后读取并验证小摘要，不再加载容量模块，避免原先重复的一遍运行校验。
- 正式题目仍在原隔离子进程中生成，原数学校验、Oracle、beforeStore、身份和源证据检查不变。目录逐项等价性测试直接读取真实冻结容量模块作对照。
- 部署请求增加 `http-start`、`http-ok`、`http-failed` 日志，记录接口路径、HTTP 状态、耗时和错误类别，不输出 Key、配置或业务正文。原 15 秒时限和所有断言不变。
- 不修改 API 容器内存限制、数据库、迁移、线上配置、论文开关、机器人调度状态、桌面端或插件包。

## 验证

新增目录测试及现有目录/答案隐藏测试共 5 项通过：36 单元、141 范围及所有库存容量与原实现逐项一致；真实冷进程 HTTP 在 48 MB V8 堆限制下返回 12 个可用主题，且未加载容量模块；摘要或运行清单被篡改时仍拒绝加载。48 MB 是测试进程的 V8 堆上限，不是 RSS 或容器内存承诺。

冻结引擎原有回归 4 项实际通过，包含两个上游 bundle gates、真实圆锥题、基础和中等难度预览，以及 Oracle、准入和零 Provider 费用验证。日志为 `.runtime/practice-catalog-cold-start.tap`、`.runtime/practice-engine-catalog-regression.tap`。

完整串行回归：367 个文件、1701 项测试，1619 项通过、0 失败、0 超时取消、82 项条件跳过，约 9 分 20 秒。报告为 `.runtime/practice-catalog-cold-start/full/result.json`、`results.tap`；原始输出保存在 `.runtime/practice-catalog-cold-start-full-console.log`。
