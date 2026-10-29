# F1.3b-2b-2c-1：论文版面引擎独立子进程协议

状态：协议与验证器已完成
日期：2026-10-29
边界：本阶段没有运行 PP-StructureV3 / PaddleOCR，只冻结通用适配器和具体引擎子进程之间的本地协议。

## 1. 为什么不直接调用 Python API

PaddleOCR、PP-StructureV3 和未来其他版面引擎的 Python API、参数名和返回结构会变化。若把这些细节写进通用执行器：

- 更新第三方库会迫使平台任务合同一起升级；
- 引擎崩溃、输出半截或打印大量日志时很难判断是否成功；
- 取消、超时和资源限制会分散到各个脚本；
- 将来替换引擎需要重写论文工作流。

因此采用两层结构：通用能力进程负责信任、文件授权和沙箱；引擎 adapter 通过冻结的本地协议启动独立引擎子进程。具体 Python API 只存在于 adapter 内。

## 2. 冻结协议

新增三个严格合同：

- `paper-layout-engine-process-request-v1`；
- `paper-layout-engine-process-progress-v1`；
- `paper-layout-engine-process-result-v1`。

请求绑定：

- 请求 ID、`research.paper.layout@1` 和原 PDF 摘要；
- 冻结的引擎名、版本、adapter 版本和模型集合摘要；
- 精确页码与 `local-layout` / `local-ocr` 方法；
- 已由上游复验的单文件或多文件组件根；
- CPU、内存、磁盘、GPU 和页面像素限制；
- 结果、JSONL 进度和取消文件；
- 结果与进度最大字节数。

协议只消费本机已验证组件，不包含下载 URL、签名 key、节点 Token 或服务端凭据。

## 3. 进度与结果语义

进度事件必须：

- 属于同一 request ID；
- sequence 精确加一；
- 已完成页数不倒退；
- 阶段只按 `starting → rendering → layout → ocr → finalizing` 前进；
- 当前页必须属于冻结计划；
- 时间戳不倒退。

成功结果必须精确返回计划中的全部页面和对应方法，不能少页、重复页、交换方法或把部分结果标成成功。区块坐标使用 0–10000 基点，类型、置信度和阅读顺序均严格校验。失败或取消不得夹带部分页面冒充可用结果，只能返回受限错误码和有界诊断。

## 4. 自动化验证

新增测试覆盖：

- 单文件与多文件组件请求物化；
- 内部文件数/展开大小不一致拒绝；
- 进度序列、页码和阶段倒退拒绝；
- 成功页集合与冻结计划精确匹配；
- 部分成功拒绝；
- 取消结果与错误码一致。

协议、原有引擎计划和论文能力组合回归 11/11 通过。

## 5. 后续实施状态

F1.3b-2b-2c-2a 已完成本机 adapter 进程管理器：有界 stdout/stderr、稳定结果文件读取、追加式 JSONL 进度、取消文件、超时终止和故障注入均已实现，详见 [实施文档](./mooyu-capability-executor-f1-3b-2b2c2a.zh-CN.md)。

下一步只接 PDF 页面渲染器，验证页面尺寸、像素上限与确定性页码映射；再接 PP-StructureV3 / PaddleOCR CPU adapter，只从组件 binding 取得模型，不在线下载。真实开放论文没有通过前继续保持“OCR 未就绪”，结果通过 `research-paper-layout-result-v1` 质量门禁后才映射 EvidenceSpan。

服务端 4 核 8G 主机仍不承担模型推理。
