# QQ 会话失效后无法恢复二维码：已确认的故障链

现场错误为 `[KickedOffLine] [下线通知] 你的账号当前登录已失效，请重新登录。\n登录服务重启失败：重启功能未初始化`。

运行开关：NAPCAT_DISABLE_MULTI_PROCESS=1，legacy关闭开关不为1，NAPCAT_WORKER_PROCESS不为1。管理服务available=true，传输connected=true；原生loggedIn/coreReady/coreOnline均为false，二维码缓存不存在。与本次搜索更新前记录比较，网关和QQ worker的容器ID、镜像、启动时间及Docker重启计数均未变化，鉴权客户端源码SHA仍是已修正版本。不能把容器未重启等同于原生内存状态从未异常，也不能据此证明第一次会话失效的具体外部原因。

固定网关镜像ac32edd…的源码中，$ke在isMultiProcessDisabled时直接进入ZQ；注册重建登录服务回调的jke分支被跳过。默认回调返回“重启功能未初始化”。KickedOffLine/SelfOffline恢复处理随后调用该回调，失败后设置offline和登录服务重启失败错误。工程compose.yml同样显式设置该单进程开关为1。这解释了会话失效后不能自行重建登录服务并生成新二维码，是已确认的恢复配置缺陷。KickedOffLine本身的触发原因（会话寿命、其他设备、网络或服务端策略等）尚未定位，不应猜测。

## 本地验证

- 原始不可变镜像：sha256:ac32edd020830d3f9437ef2e46e462b0ee02390a76bd19167848ad0b2a69412d。
- 全断网、无用户登录卷、无主机目录挂载的临时容器，非root UID/GID1000、只读镜像和空tmpfs目录。
- 首两次测试失败于空tmpfs目录归属root，非root镜像无法建立/data/napcat/logs。仅调整新建测试目录的uid/gid后通过，未调整任何用户已有目录权限。
- r3验证完整进程管理参数可启动；r4仅覆盖NAPCAT_DISABLE_MULTI_PROCESS=0，保留其余镜像环境，亦通过。均观察到两个node进程、原生扩展预加载成功，无模块缺失或启动错误；测试容器已正常停止并移除。
- r4证据：E:\CodexData\build\Right\agent-server-preflight\20261123\napcat-multiprocess-isolated-r4\result.json。
- 结论仅为PASSED_BOOTSTRAP_ONLY：未接入QQ、未使用真实登录数据、未验证真实KickedOffLine重连、二维码恢复或持续在线。

## 待审核的变更范围

修复方向为使用该版本已有的父进程/原生子进程恢复机制，而非给搜索服务增加重启网关的逻辑。最小配置草案只将napcat服务的NAPCAT_DISABLE_MULTI_PROCESS改为字符串0。保留原镜像、完整Compose链、原/data命名卷、现有UID、设备/登录配置、挂载、网络、端口、资源、权限和重启策略。还必须检查用户数据中的.env是否反向覆盖运行开关，以及现场真实启动参数，不能盲目应用草案。

部署将需要重建QQ登录网关容器，超出此前仅更新API/交互执行器和已经使用完毕的一次性网关重启授权。应在原有登录目录备份及完整校验、配置差异和回退入口、其他服务快照、空闲门禁准备好后，取得针对本次网关运行模式变更的明确授权。执行不得连带重启API、QQ worker、数据库、日调度或桌面服务；两套论文保持关闭。不删除登录数据，不自动恢复旧备份，不伪造在线状态，不添加循环容器重启脚本。

该版本内置父进程恢复包含原生子进程退出超时后的终止处理及短时崩溃次数限制，需纳入正式变更评审，不能承诺永远不会触发这些分支。恢复机制只能处理掉线后的恢复过程，不能保证QQ服务端不再判定会话失效。
