# 桌面业务 API 本地接入

桌面继续使用网页版的 App、发现页、日志、学习页、工具和游戏库，不新增一套页面。配置账号服务器后，账号与业务使用同一 origin、同一主进程托管会话；不允许把测试账号令牌发送到另一台内容服务器。未配置服务器的离线预览才显示桌面兼容样本，联网模式不回退到样本或伪造空成功结果。

当前支持服务端作品目录、筛选分页、作品详情、运营专题、公开日志列表与全文、公开作者主页、学习页中的服务端课件、游戏库读取及加入/移出。工具页继续使用网页版随客户端打包的官方工具目录与本地工具模块，PDF/OCR 不要求向服务器上传文档。工具内部未列入支持范围的云端操作会明确拒绝；本轮不代表所有工具云端业务均已接通。

## 传输与边界

`business-contract.mjs` 固定业务操作清单，参数通过长度、类型和字段白名单校验。主进程调用现有 platform-api-client，复用鉴权和刷新逻辑。renderer 不接受任意 HTTP URL、Authorization、请求头、发布或管理操作，也不获取 bearer/refresh token。AbortSignal 留在 renderer，通过随机 requestId 通知主进程取消；已取消的排队调用不再发送，执行中的传输会中止。业务队列最多 32 项、4 路并发，从入队开始计算 20 秒期限，不与认证变更共用队列。

退出立即使本地会话失效，并清除旧业务工作；凭据删除与正在进行的 DPAPI 写入按序收尾。迟到的读取、刷新或凭据写入不能恢复旧会话或清除新登录。bootstrap 与私有读取共用刷新顺序锁；取消单页不取消其他读取共用的会话刷新。远程撤销仅使用退出时捕获的旧凭据，认证变更等待其收尾，网络失败仍会报告错误而不恢复本地登录。游戏库按账号身份重新挂载，退出后不保留上一账号的私有列表。

封面和头像经本地 `mooyu-app://client/__desktop-media` 代理读取。仅接受同一测试 origin 下限定的作品封面、头像和专题图片路径；不跟随跳转，不带 Cookie，不允许任意 API 路径或外站地址，仅返回 PNG/JPEG/WebP/GIF，限制 8 MiB。浏览器页面仍禁止直接访问远程 API。

正式 origin 的现有拒绝规则保持不变。远程测试仍先验证 `/ready-desktop-auth` 的隔离标记、数据库、Redis、迁移和后台任务关闭状态。现有 `desktop-test.mooyu.fun` 部署是 **仅账号接口** 实例：本轮不修改它的路由保护，不部署新服务器。若它拒绝业务路由，客户端显示“当前测试服务器仅开放账号接口，尚未开放业务内容；不是网络故障”，不会把它误判成用户不存在或用本地样本替代。

完整数据库与本机游戏运行验证见 [本地隔离业务实例](mooyu-desktop-business-test-instance.zh-CN.md)。新增的远程 HTTPS 与游戏测试域配置、来源校验及本地 Caddy 验证见[远程完整业务测试方案](mooyu-desktop-business-remote.zh-CN.md)，尚未部署。游戏执行需显式配置运行域，并校验 API 返回的 release 描述，不接受任意运行来源。Windows 下载与安装、发布、文章生成和后台执行仍未接通。内置工具和随应用交付的学习目录与远程作品目录来源不同，仍沿用网页版的组合方式。

## 本地验证

```powershell
node --test tests/platform/desktop-business-api.test.mjs
node scripts/build-desktop-shell.mjs
node scripts/verify-desktop-business.mjs
node scripts/verify-desktop-clean.mjs
```

业务验收启动随机回环端口的本地契约服务，复用真实 auth-service 和产品 API client；账号、邮件与业务内容均为本地测试数据。验证共享页面、封面、收藏、鉴权、刷新、错误提示和隔离边界，不代表真实业务 PostgreSQL、正式服务器或真实游戏执行已经验收。真实 GitHub 授权不由本验收自动化操作。

报告索引：`.runtime/desktop-shell/business-verification-latest.json`；窗口截图和详细结果位于其 directory。干净目录验证只叠加交付清单内的文件，排除旧 D1 与论文待提交实现。
