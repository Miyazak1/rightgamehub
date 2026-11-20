# QQ Linux 完整环境候选：本地验收

2026-11-20，北京时间。独立分支 `codex/qq-password-login`，工作树 `E:\CODE\Right\.codex-work\qq-password-login`。未推送、未部署线上；原工作树、线上配置、登录资料和历史保持原现场，论文四个开关继续关闭。

## 结论与边界

原自组装 Linux 镜像在独立真实登录下复现原生崩溃；原作者完整固定环境及其中替换为相同自编译主程序的对照均通过 301 秒在线观察。因此主程序本身并非在 Linux 必然崩溃，运行环境组合是目前有实验证据支持的范围。单独替换 Node、QQ、预加载、可选适配器、额外 zlib、资料路径或工作目录均未解决。具体哪个原生组件或组合机制触发异常仍未证明，不能把 libvips 故障映射当作库本身有缺陷的结论。

本候选沿用已通过的完整环境，使用当前自编译主程序与自有最小入口。未执行原镜像 shell 入口，也未修改原生二进制。源码见 `deploy/qq/Dockerfile.gateway-compatible`、`deploy/qq/gateway-entry-compatible.cjs`。

- 基础镜像：`ghcr.io/napneko/nodenapcat@sha256:9f35df29e9f0a92f737143e123b9159b998c314a573139b5ac0e6bd4ab5af574`。
- 本地候选：`mooyu-qq-gateway:20261120-compatible-candidate`，构建结果摘要 `sha256:ac32edd020830d3f9437ef2e46e462b0ee02390a76bd19167848ad0b2a69412d`。
- 主程序 SHA256：`7967149b1c4f3d30e0506c842f84b7b925c2d361e3c9c75ebf0d4ff24dbdedaa`。
- 构建上下文：`E:\CodexData\build\Right\qq-compatible-candidate\20261120-1`，仅含已校验主程序、Dockerfile、入口及管理脚本，不含账号资料或模型密钥。

准备上下文使用 `scripts/prepare-qq-compatible-context.mjs --out-dir NEW_E_BUILD_DIRECTORY --main VERIFIED_NAPCAT_MAIN`，要求新的 E 盘任务输出目录，并在创建目录前校验主程序摘要。

## 真实测试结果

测试实例 `20261120063447-adf4d8`，本机管理页 `http://127.0.0.1:63990`。用户用独立账号扫码，14:39:00 ready；14:49:32 连续 ready 632 秒、0 重启、未 OOM。该观察为短时验证，不能替代长期在线测试。

仅允许测试群 `905757031`、提问 QQ `495469022`，机器人 `3922489710`。独立数据库和命名卷，模型最多调用 4 次、预算 30000 tokens、每次最多输出 256 tokens、最大尝试 1 次。用户手动发送测试消息。

| 项目 | 结果 |
|---|---|
| 记住测试名字 | 用户收到回复，后台送达 |
| 同会话回忆名字 | 正确回复“验收小明” |
| 仅重启测试 worker 后回忆 | 重连后仍正确回复；网关和数据库未重启 |
| 群内普通文字、不 @ | 用户确认无回复；后台消息与调用仍各 3 条 |
| 重放同一已送达消息 ID | duplicate=true、status=delivered；消息 3、调用 3、事件 16、预留 tokens 8241，前后完全相同；验证禁用模型及发送 |
| 队列状态 | 三条全部送达；无积压、无待核对、无最新错误 |
| 论文功能 | 关闭 |

Node 测试共 5 项通过、无跳过：实际候选容器拒绝混用运行路径/环境；拒绝替换已有管理凭据并保留配置字节；构建前拒绝错误主程序摘要；两项状态/日志隐私过滤检查。日志 `runtime-guards-test.log` 位于构建上下文目录。密码登录此前本地 38 项检查通过；本次真实账号验收使用扫码，尚未验证真实 QQ 密码登录。

聚合证据：`E:\CodexData\build\Right\qq-login-repro\20261120063447-adf4d8` 中的 `timeline.jsonl`、`business-timeline.jsonl`、`worker-restart-verification.json`、`dedup-verification.json`。独立测试资料位于 `E:\CODE\Right\private-deployments\qq-login-repro\20261120063447-adf4d8`；其中会话、私有环境文件及数据库含凭据或历史，保留本地，不提交或分享。原线上数据库与登录资料未参与本次测试。

## 尚未完成的工作

未执行线上部署、网关自身重启后的自动恢复、长期运行或线上旧资料迁移验收。worker 重启后的记忆保留已验证，但不能等同于网关重启后的登录恢复。

线上现有布局使用 `/data/qq`，候选要求原生 `/data/home/.config/QQ`。入口在发现旧 `NAPCAT_QQ_DATA_DIR`、错误工作目录或混合库环境时直接拒绝启动；不会默默迁移、删除或覆盖已有资料。以后上线前必须先制定保留旧卷与回退版本的资料路径兼容方案，并在独立副本上验证；不能只改镜像标签就替换线上实例。当前不修改原部署 Dockerfile 或 Compose。
