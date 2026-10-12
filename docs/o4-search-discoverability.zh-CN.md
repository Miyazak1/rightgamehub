# O4.3 搜索可发现性基础

更新日期：2026-10-12。

## 目标

让公开作品与发现专题拥有可长期收录、可正确理解的搜索入口，同时明确排除账户、后台、运行时和临时分享页面。搜索流量只进入适合浏览与继续游玩的正式页面，不改变匿名玩家直接游玩的产品边界。

## 已实现

- `GET /robots.txt`：允许公开站点抓取，排除 API、账户、创作者中心、管理页、游戏运行页、挑战页、临时分享页及社区私人视图，并声明站点地图地址。
- `GET /sitemap.xml`：动态分页读取全部公开目录作品，加入 `/w/:workId`；同时加入已发布的发现专题 `/discover/c/:slug` 和三个公共入口页。
- 作品公开页：保留 canonical、Open Graph、Twitter Card 与正式分享图，新增 `VideoGame`、`SoftwareApplication` 或 `CreativeWork` JSON-LD。
- 专题公开页：新增 `CollectionPage` 与 `ItemList` JSON-LD，逐项关联正式作品地址。
- 边缘层：`robots.txt`、`sitemap.xml` 优先转发 API；私有、后台、运行和临时页面返回 `X-Robots-Tag: noindex, nofollow`。
- 安全边界：JSON-LD 对 `</script>` 等内容进行转义，并纳入现有 CSP nonce。

## 收录边界

应收录：

- `/`
- `/discover`
- `/community`
- `/w/:workId`
- `/discover/c/:slug`

不应收录：

- `/v1/*`
- `/account*`、`/creator*`、`/admin*`
- `/play/*`、`/challenge/*`
- `/s/*`、`/install*`
- `/community/me*`、`/community/bookmarks*`、`/community/review*`

## 上线验收

部署后至少验证：

```bash
curl -fsS https://mooyu.fun/robots.txt
curl -fsS https://mooyu.fun/sitemap.xml
curl -fsSI https://mooyu.fun/creator
curl -fsS https://mooyu.fun/w/<公开作品ID>
```

验收标准：站点地图只包含正式 HTTPS 地址；创作者页响应含 `X-Robots-Tag: noindex, nofollow`；作品页包含唯一 canonical、分享元数据和 `application/ld+json`。

## 后续但不阻塞上线

- 在 Google Search Console、Bing Webmaster Tools 等站长平台提交站点地图并观察索引覆盖。
- 作品下架或专题归档后核对其公开页状态，避免站点地图残留。
- 有真实搜索数据后再决定是否为作品增加更细的分类落地页，不预先制造低质量聚合页。
