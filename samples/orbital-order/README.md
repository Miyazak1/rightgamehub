# Orbital Order（轨道秩序）GameHub 适配包

这是对 [Afton Gauntlett 的 `js13k-demo`](https://github.com/aftongauntlett/js13k-demo) 的平台兼容适配。原作名为 **Orbital Order (Aufbau)**，采用 MIT 许可。

## 玩法

- 蓝色 s 电子会被指针吸引；橙色 p 电子会被指针排斥。
- 按 Aufbau 构造原理，从低能级开始把电子引导到同色轨道。
- 桌面端使用鼠标；手机和平板直接拖动手指。
- 键盘可用 `Esc` 查看规则、`L` 查看元素、`M` 静音；触屏端提供对应按钮。

## GameHub 适配

- 修正 CSS 缩放后指针坐标不一致的问题；
- 增加 Pointer Events 和触屏按钮，不再阻止小屏设备启动；
- 在无 `localStorage` 的隔离 iframe 中使用内存回退，避免游戏启动失败；
- 页面失焦或进入后台时静音；
- 保留原作者署名、MIT 许可和固定上游提交记录；
- 不使用 CDN、远程接口、Cookie、平台凭据或额外权限。

## 构建与上传

```bash
npm run build:orbital-order
```

生成文件：`artifacts/orbital-order-gamehub-v1.zip`。ZIP 根目录已有 `index.html`、`platform.json`、许可和全部运行资源，可直接选择“上传 Web ZIP”。

推荐作品信息：

- 名称：`轨道秩序：Aufbau`
- 类型：`游戏`
- 简介：`移动鼠标或手指，以吸引与排斥控制电子，按构造原理填满六种元素的原子轨道。`
- 作者署名：`Original game by Afton Gauntlett · GameHub compatibility adaptation`
