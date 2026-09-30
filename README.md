# PanSou 网盘搜索（Tampermonkey 前端）

基于 [PanSou](https://github.com/fish2018/pansou) 后端 API 的「网盘资源搜索展示」前端。
以 Tampermonkey 油猴脚本形式运行，注入任意网页，用 `GM_xmlhttpRequest` 跨域直连 PanSou 后端，
把各网盘（百度/阿里/夸克/115/天翼/迅雷/123/磁力等）的分享链接、提取码、来源聚合并分组展示。

> 当前版本：**v0.2.7** · 协议：MIT · 仅供学习研究，请勿用于盈利。
>
> - 本仓库（[zexjpg/pansou-search](https://github.com/zexjpg/pansou-search)）独立托管这份脚本，与后端仓库 [fish2018/pansou](https://github.com/fish2018/pansou) 分离。
> - 一键安装：Tampermonkey 面板 → 实用工具 →「**从 URL 安装脚本**」→ `https://github.com/zexjpg/pansou-search/raw/main/pansou-search.user.js`
> - 本脚本**不自带任何代理**；默认直连后端，代理由后端环境变量决定（见第 12 节）。

---

## 1. 这是什么 / 它基于什么

- **PanSou**（fish2018/pansou）是一个用 Go 写的高性能「网盘资源搜索 API」：并发搜索大量 Telegram 频道 + 自定义插件，返回各大网盘的分享链接。Docker 一键部署。
- 本仓库**只做前端展示**，本身不抓取数据。默认连接公开演示站 `https://so.252035.xyz`，也可在设置里改成你自建的 PanSou 后端。
- 形态选择 Tampermonkey 脚本的原因：浏览器纯前端直连不同源后端会被 CORS 拦截，而 `GM_xmlhttpRequest` 可天然跨域，无需自己搭代理/反代。

## 2. 目录结构

```
pansou-search/
├── pansou-search.user.js   # 主脚本（单文件，含 UI/CSS/逻辑，约 1278 行）
├── sample.json             # 真实搜索响应裁剪样本（字段参考用）
├── test-parse.mjs          # Node 校验脚本（离线验证解析/分组/映射逻辑，16 项断言）
├── LICENSE                 # MIT
├── .gitignore              # 忽略 .DS_Store / node_modules 等
└── README.md               # 本文件
```

> 单文件油猴脚本是刻意设计：方便直接粘进 Tampermonkey 覆盖保存，无需构建步骤。
> 语法自检：`node --check pansou-search.user.js`（应无输出）；纯逻辑回归：`node test-parse.mjs`。

### 2.1 与后端仓库的关系

| 仓库 | 职责 | 运行形态 |
|------|------|----------|
| [fish2018/pansou](https://github.com/fish2018/pansou)（或 fork） | 后端搜索 API：抓 TG 频道 + 插件、聚合成网盘链接 | Go 二进制 / Docker |
| **本仓库** | 纯前端展示：搜索框、分组筛选、链接检测、导出 | Tampermonkey 脚本 |

两端只通过 `{base}/api/*` 通信。本脚本默认连演示站 `https://so.252035.xyz`，在设置面板改成自建后端地址即可对接你自己的后端（第 12 节）。

## 3. 后端 API 参考（**已用演示站实测，与官方文档有出入，以这里为准**）

baseUrl 默认 `https://so.252035.xyz`（设置里可改）。所有路径拼在 baseUrl 之后。

### 3.1 搜索 `POST {base}/api/search`

请求体（脚本在 `apiSearch()` 中构造）：

```json
{
  "kw": "速度与激情",
  "res": "merge",                       // 固定 merge，拿到按类型聚合的结果
  "src": "all",                         // all | tg | plugin
  "refresh": false,                     // 是否绕过后端缓存
  "cloud_types": ["baidu","quark"],     // 可选；不传或空数组 = 全部
  "filter": {                           // 可选：关键词过滤
    "include": ["合集"],                 // 满足其一即可
    "exclude": ["预告"]                  // 满足其一则过滤
  }
}
```

**响应（注意：有 `code/message/data` 外层，文档说无外层，实际有）**：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "total": 123,
    "merged_by_type": {
      "quark": [
        { "url": "https://...", "password": "abcd", "note": "标题", "datetime": "2026-...",
          "source": "频道名", "images": ["https://thumb..."] }
      ],
      "magnet": [ { "url": "magnet:?xt=...", "note": "...", "source": "...", "datetime": "..." } ]
    }
  }
}
```

- 解析入口：`data.merged_by_type`，**键是网盘类型**（如 `baidu`/`quark`/`123`/`magnet`/`ed2k`），值与 `CLOUD_TYPES` 对应。
- `code !== 0` 视为业务失败，抛错。
- 字段可能缺省（`password`/`images`/`source`/`datetime` 都可能没有），渲染时都做了兜底。

### 3.2 健康检查 `GET {base}/api/health`

```json
{ "auth_enabled": false, "channels_count": 111, "plugin_count": 111,
  "channels": [...], "plugins": [...],
  "tg": { "reachable": true } }
```

- 设置面板「保存并测试连接」会调它，校验后端可达 + 认证开关。
- 演示站 `auth_enabled:false`，无需 JWT；但其 `channels_count`/`plugin_count` 是演示站自己配的子集，不代表全量。
- 上面示例用的是「开箱即全量」的自建后端：`CHANNELS` 与 `ENABLED_PLUGINS` 都不设时，后端默认加载**全部频道 + 全部插件**（当前各 111 个）。详见第 12.3 节。

### 3.3 链接有效性检测 `POST {base}/api/check/links`

请求：

```json
{ "items": [ { "disk_type": "123", "url": "https://...", "password": "SJXY" } ] }
```

响应：

```json
{ "results": [ { "disk_type": "123", "url": "https://...", "state": "ok",
                 "cache_hit": false, "summary": "..." } ] }
```

`state` 取值与含义：`ok`(有效) / `bad`(失效) / `locked`(加密或锁定) / `uncertain`(未知，部分网盘如 123 盘常返回此值，**结果仅供参考**)。
脚本按 20 条一批循环请求（`BATCH = 20`）。

## 4. 安装与使用

1. 浏览器装好 Tampermonkey 扩展。
2. Tampermonkey → 新建脚本 → 把 `pansou-search.user.js` 全部内容粘进去 → 保存。
3. 任意 `http/https` 网页：
   - 顶部居中会出现蓝色小标签「🔍 PanSou 搜索」，点击弹出搜索框（移动端常显、字号放大）。
   - 若关闭了触发条，仍可点 **Tampermonkey 扩展图标 → 脚本名 → 命令菜单** 调出「打开 PanSou 搜索框」或「显示/隐藏顶部触发条」。
4. 输入关键词回车/点搜索即可。

> 演示站有 Nginx 限流（约 60 次/分钟），高频搜索可能 429。长期自用建议自建 PanSou 后端，设置里填你的域名即可（已 `@connect *` 放行所有域名）。

## 5. 功能清单

- 关键词搜索（回车或按钮）
- 按网盘类型分组 + **顶部标签栏切换**（「全部」+ 每种云盘一个标签，带数量徽章）
- 网盘类型横向 chips 筛选（默认全选，可取消指定类型）
- 关键词 include / exclude 过滤（逗号分隔）
- **链接有效性检测**（调 `/api/check/links`，卡片上色 + 统计）
- 复制链接 / 复制「链接+码」/ 打开
- 搜索历史下拉（最近 10 个，点选即搜，✕ 联动删缓存）
- 结果导出为 Markdown（当前标签或全部）
- 本地结果缓存（72 小时，命中秒显；错误与空结果不缓存）
- 设置：后端地址、显示触发条开关、清空缓存
- 移动端适配（媒体查询，触屏常显、安全区、字号）

## 6. 配置项（持久化键名）

| 键 | 说明 | 读取/写入位置 |
|----|------|--------------|
| `pansou_base` | 后端地址，缺省协议自动补 `https://` | `cfg.baseUrl` getter/setter（含 `normalizeBase`） |
| `pansou_show_launcher` | 是否显示顶部触发条，默认 `true` | `applyLauncherVisibility()` / 设置开关 |
| `pansou_history` | 搜索历史数组（最多 10） | `loadHistory()` / `saveHistory()` |
| `pansou_cache::<kw>::<types>::<inc>::<exc>` | 结果缓存，TTL 72h | `cacheKey()` / `getCache()` / `setCache()` |

缓存键用 `encodeURIComponent` 包裹关键词，避免关键词含 `::` 串味。
清理入口：`pruneCache()`（只留历史词的缓存）、`deleteHistoryAndCache(kw)`（删某词全部变体）、`clearAllCache()`（全清）。

## 7. 代码地图（改功能前先读这里）

脚本是单个 IIFE，按区块组织（看行首的 `====` 注释）：

| 区块 | 行号 | 关键内容 |
|------|------|----------|
| 1. 配置 | 23–45 | `DEFAULT_BASE`、`CLOUD_TYPES`、`CLOUD_LABELS`、`normalizeBase`、`cfg` |
| 2. 工具 | 47–118 | `$/$$`、`esc`、`fmtDate`、`friendlyError`(错误转中文)、`copyText/fallbackCopy`、`toast` |
| 3. API | 120–198 | `gmRequest`(GM_xmlhttpRequest 封装)、`parseJson`、`apiHealth`、`apiSearch`、`apiCheckLinks` |
| 4. 状态&UI | 200–368 | 全局状态、`buildLauncher`/`applyLauncherVisibility`/`toggleLauncher`、`buildPanel`(HTML 骨架+事件绑定)、`openPanel`/`closePanel`、`setStatus` |
| 5. 搜索/渲染 | 370–551 | `getSelectedTypes`、`doSearch`、`renderResults`、`showType`、`makeTypeSection`、`makeCard` |
| 5b. 缓存/历史/导出 | 553–678 | `cacheKey/getCache/setCache/fmtAgo`、`loadHistory/saveHistory/pruneCache/deleteHistoryAndCache/clearAllCache/updateCacheCount`、`renderHistory/showHistory/hideHistory`、`exportResults` |
| 6. 链接检测 | 680–730 | `stateLabel`、`checkLinks` |
| 7. 设置 | 732–755 | `saveSettings` |
| 8. 样式 | 760–906 | `GM_addStyle` 全部 CSS（含移动端 `@media`） |
| 9. 启动 | 908–922 | `applyLauncherVisibility`、注册 `GM_registerMenuCommand`、暴露 `window.__panSou` |

**调试入口**：控制台执行 `window.__panSou.apiSearch(...)` 可直接调 API。

## 8. 设计决策与已知坑（务必先看）

1. **响应结构以实测为准**：官方文档称成功响应无外层，但演示站实际返回 `{code,message,data}`。解析务必走 `data.merged_by_type`，否则拿不到数据。
2. **跨域靠 `GM_xmlhttpRequest`**：不要试图改成 `fetch`/`XMLHttpRequest` 直连，会被 CORS 拦。
3. **`@connect *`**：已放行所有域名，改后端不再需手动加 `@connect`。若改回具体域名白名单，记得同步改脚本头。
4. **`@noframes`**：脚本不在 iframe 内运行，避免嵌套页重复注入。
5. **HTTP 400「plain HTTP sent to HTTPS port」**：不是服务器坏了，是 `baseUrl` 协议/端口写错（多为 `http://` 写成 `https://` 或带多余端口）。`normalizeBase` 已对缺省协议补 `https://` 兜底；错误提示见 `friendlyError`。
6. **HTTP 429 Too Many Requests**：演示站 nginx 限流（约 60 次/分），属服务器侧保护。脚本每次搜索/检测/连接测试都打请求，连点易触发。应对：稍候重试，或改用自建后端。
7. **缓存守卫**：仅当 `total>0 且 有网盘类型` 才写缓存；**错误与空结果都不缓存**，避免污染。
8. **检测只扫当前可见标签**：点「检测失效链接」只检测当前结果标签里的卡片。要全量检测先切回「全部」标签。
9. **结果体积**：缓存整份结果原样存；单关键词结果极多时单条缓存偏大（已用数量裁剪控制，未做单条截断）。

## 9. 后续扩展指南（开发新功能时参考）

**通用原则**：UI 改 `buildPanel` 的 HTML 骨架 + 区块 8 的 CSS；逻辑加在对应区块；新持久化数据走 `GM_setValue`（注意新键值加进区块 6 的清理逻辑，避免孤儿缓存）。

常见扩展点：

- **加新过滤/排序**：在 `apiSearch` 的 `body` 里加字段（需后端支持），或在 `renderResults`/`showType` 渲染阶段做本地排序。
- **新增结果卡片操作**（如「批量打开」）：在 `makeCard` 里加按钮 + 事件；批量操作可遍历 `$$('#ps-results .ps-card')`（参考 `checkLinks` 的取数方式）。
- **新增设置项**：加 `<input>` 到 `#ps-settings`，在 `buildPanel` 绑定，`GM_setValue` 存，读取处用 `GM_getValue(键, 默认值)`。
- **新增菜单命令**：在区块 9 的 `GM_registerMenuCommand` 处注册。
- **改缓存策略**（如单条截断 50 条）：改 `setCache` 调用处或 `makeTypeSection` 取数。
- **验证改动**：没有浏览器环境时，可把解析/分组/映射逻辑镜像到 `test-parse.mjs` 跑断言；改完务必 `node --check pansou-search.user.js` 做语法校验。

**不要做的事**：把 `gmRequest` 换成原生 `fetch`（CORS 会挂）；删除 `@connect *` 或 `@noframes` 除非你明确知道后果；把空结果写进缓存。

## 10. 迁移到微信小程序（对照方案）

油猴脚本的**核心业务逻辑可复用**，但运行环境差异很大。迁移本质是「三替换 + 一重排」：

| 维度 | 油猴脚本 | 微信小程序 | 改动 |
|------|----------|------------|------|
| 网络请求 | `GM_xmlhttpRequest` | `wx.request` | 重写 `gmRequest` → Promise 封装 `wx.request`，注意**小程序强制域名白名单**：需在 mp 后台「开发设置→服务器域名」把你的 PanSou 后端加入 `request` 合法域名；开发期可临时关「不校验合法域名」。 |
| 本地存储 | `GM_setValue/GM_getValue/GM_listValues/GM_deleteValue` | `wx.setStorageSync/getStorageSync/removeStorageSync` + 遍历 `wx.getStorageInfoSync().keys` | 缓存/历史/设置的读写整体平移。小程序无 `listValues`，用 `getStorageInfoSync().keys` 过滤前缀实现 `pruneCache`/`clearAllCache`。 |
| UI | 注入 DOM + `GM_addStyle`(CSS) | `WXML` + `WXSS` + `app.json` 页面 | `buildPanel` 的 HTML 拆成页面/组件；CSS 搬进 `WXSS`（去掉浏览器特有选择器如 `:hover` 在触屏无意义，但小程序支持 `hover-class`）；触发条/模态框改成页面或弹层组件。 |
| 复制 | `navigator.clipboard` / `execCommand` | `wx.setClipboardData` | 一行替换。 |
| 图片 | `<img>` | `<image>` 组件 | 注意小程序 `<image>` 默认尺寸与懒加载差异。 |
| 入口/命令 | 顶部触发条 + `GM_registerMenuCommand` | 页面入口 / tabBar / 按钮 | 不再需要 launcher 与菜单命令，直接做搜索页。 |

**建议落地步骤**：
1. 新建小程序项目，`app.json` 加一个搜索页（如 `pages/search/search`）。
2. 把区块 3 的 `apiHealth/apiSearch/apiCheckLinks` 原样搬到 `utils/pansou.js`（仅把 `gmRequest` 换成 `wx.request` 封装）。**API 结构、请求体、响应解析完全不变**——这是迁移里最稳、价值最高的部分，直接复用本文第 3 节的字段约定。
3. 把区块 5/5b 的缓存(`cacheKey/getCache/setCache`)、历史、导出逻辑搬进 `utils`，存储换 `wx` 同步 API。
4. `renderResults`/`showType` 的分组逻辑（按 `merged_by_type` 切标签）改造成页面的 `setData` 数据结构：用 `tabs = [{key:'all',label:'全部',count:total}, ...]` + 当前 `currentTabKey` 决定渲染哪类。
5. UI 按本文第 5 节功能清单在 WXML 里重建（卡片网格、标签栏、筛选面板）。
6. 域名白名单是小程序特有坑，**上线前必做**；开发期先关校验。

> 小程序版不适合做成「注入任意网页」的插件（小程序没有 Tampermonkey 生态），而是独立的搜索 App。若想保留「浏览器里随手搜」，油猴脚本形态更合适；若要分发到手机、上架，小程序是更顺的路。

---

## 11. 待办 / 可能的下一步

- [ ] 搜索节流（两次最小间隔）+ 429 退避重试（演示站限流场景）。
- [ ] 链接检测增强：检测后「只看失效」+ 失效项前置排序（演示站限流下谨慎，避免多打请求）。
- [ ] 选中网盘 chips 高亮态（当前选中态视觉区分弱）。
- [ ] 取消进行中的搜索（`isSearching` 锁已存在，可加 Abort）。
- [ ] 图片点击放大（lightbox）。
- [ ] 暗色模式。

## 12. 连接「带验证」的后端（AUTH_ENABLED）

PanSou 后端可经环境变量开启 JWT 认证（`api/auth_handler.go` + `api/middleware.go`）。本脚本已从 v0.2.7 起支持该模式。

### 12.1 后端如何开启

启动后端时设置（`.env` 或命令行）：

```bash
AUTH_ENABLED=true
AUTH_USERS=admin:admin123            # 多账号用逗号：u1:p1,u2:p2
AUTH_JWT_SECRET=随便一串足够随机的字符串   # 不填则每次启动随机，旧令牌失效
AUTH_TOKEN_EXPIRY=24                 # token 有效期（小时），默认 24
PORT=8899                             # 监听端口（8899 避开本机 8888 上的幽灵监听）
```

- 登录：`POST {base}/api/auth/login`  body `{"username":"admin","password":"admin123"}` → `{"token":"...","expires_at":<unix秒>,"username":"admin"}`
- 受保护接口 `/api/search`、`/api/check/links` 必须在请求头带 `Authorization: Bearer <token>`
- 公开接口（免 token）：`/api/auth/login`、`/api/auth/logout`、`/api/health`（health 会返回 `auth_enabled:true`）

> 后端仓库的 `run-with-auth.bat` / `run-all.bat` 已把上述变量配好，默认监听 `8899` 端口（避开机器上其它 8888 服务）。

### 12.2 前端怎么改（已内置，无需再改）

脚本在「设置 → 认证」分区提供两种入网方式，**二选一**：

1. **账号密码自动登录**：填用户名/密码 → 点「用账号登录获取令牌」。脚本调 `/api/auth/login` 拿到 token 存到 `GM_setValue`，并自动在每次搜索/检测请求里带上 `Authorization: Bearer <token>` 头。
2. **手动令牌**：把后端返回的 token 粘进「Bearer 令牌」输入框 → 点「保存令牌」。

行为细节（见 `3b` 区块 `apiLogin / ensureToken / withAuth / isAuthError`）：

- `gmRequest` 在发请求前自动附加 `Authorization` 头（有 token 才加）。
- 搜索/检测用 `withAuth()` 包裹：先 `ensureToken()` 保证有可用令牌；若后端返回 401（令牌缺失/失效），且本地存有账号密码，会自动重新登录并重试一次。
- 保存设置时若探测到 `auth_enabled:true` 会提示已配置/自动登录；若后端未开启认证会清掉残留令牌，避免误导。
- 控制台调试：`window.__panSou.apiLogin(base,user,pass)`、`window.__panSou.ensureToken(base)`、`window.__panSou.auth`。

> 注意：账号密码以明文存于 Tampermonkey 的 `GM_setValue`（本地），仅建议自测用。

### 12.3 自建后端「开箱即全量」：默认全插件 + 全频道（推荐）

普通 PanSou 构建有个容易踩的坑：**插件和频道是运行时靠环境变量决定的**——`ENABLED_PLUGINS` 不设 = 0 个插件，`CHANNELS` 不设只搜 `tgsearchers7` 一个频道。所以很多"全量"部署都要在启动命令里贴一长串名字。

自制构建可以反过来：把「不设环境变量」的语义改成**默认全量**，脚本侧完全不用改，只需把后端地址填进设置面板。

做法（以我们维护的 fork 为例，见 `pansou` 后端仓库的 `编译与本地运行指南.md`）：

```bash
# 1) 下载开箱即全量的构建产物（Windows/Linux/macOS × amd64/arm64 六个二进制）
#    https://github.com/zexjpg/pansou/releases/latest
# 2) 直接运行即可，不需要任何环境变量
./pansou-linux-amd64            # 111 插件 + 111 频道
pansou-windows-amd64.exe        # 111 插件 + 111 频道
```

对应到后端的两条默认语义（都在 `config/config.go`）：

| 环境变量 | 上游默认 | 本方案默认 | 想要回退时 |
|----------|----------|------------|------------|
| `CHANNELS` | `tgsearchers7`（1 个） | **未设置 = 全部频道**（清单经 `go:embed` 编进二进制） | 显式设 `CHANNELS=tgsearchers7` |
| `ENABLED_PLUGINS` | 未设置 = 0 插件 | **未设置 = 全部插件**（111 个 Go 包一起编译） | 显式设 `ENABLED_PLUGINS=none` 或 `=""` |

- 上游在 `main.go` 里新增插件包时，编译时自动进二进制，"默认全量"自动把它算进去，无需维护名单。
- 频道清单由 CI 在编译前从上游 `docker-compose.yml` 的 `CHANNELS=` 重新生成并 `go:embed`，上游改频道也会自动跟随。
- 上游有新提交时，CI 合并上游 → 重新交叉编译 → 发布新版本 Release（版本号形如 `commit-<sha7>`）。

### 12.4 关于代理（本脚本 / 后端都不自带代理）

- **本油猴脚本**：不做任何代理逻辑，只按 `baseUrl` 直连后端。是否走代理完全取决于你的后端部署环境。
- **后端二进制**：从 `PROXY` / `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` 读代理，**都不设就是直连**。构建脚本不注入任何代理，`Release` 里也只有二进制，不含任何配置文件。
- 需要访问 Telegram 频道时，在**启动后端的进程**里设 `PROXY=http://127.0.0.1:10809`（换成你自己的端口）即可；后端有 TG 可达性探测，不可达会自动跳过 TG 阶段、只跑插件路径。
- 前端脚本不需要也不应该配代理——它只是连你的后端地址。

### 12.5 排错速查

| 现象 | 原因 | 处理 |
|------|------|------|
| `HTTP 400 plain HTTP sent to HTTPS port` | 设置面板的后端地址协议/端口写错（多为 `http` 写成 `https`） | `normalizeBase` 会补缺省 `https://`；确认地址不要带多余端口 |
| `HTTP 401` | 后端开了认证但脚本没 token | 设置里走「账号登录」或粘 token（12.2） |
| `HTTP 429` | 演示站 nginx 限流约 60 次/分 | 稍候重试，或改用自建后端 |
| 搜索返回 0 条但健康正常 | 后端 `CHANNELS`/`ENABLED_PLUGINS` 为空，或没代理导致 TG 不可达 | 检查后端 `/api/health` 的 `channels_count`/`plugin_count`，见 12.3 |
| 浏览器控制台 `CORS` 报错 | 脚本被改成了原生 `fetch` | 必须用 `GM_xmlhttpRequest`，见第 8 节 |

---

## 13. 更新日志（摘要）

| 版本 | 关键变化 |
|------|----------|
| 0.2.6 | 认证支持（JWT 自动登录/手动令牌）、设置面板、导出 Markdown |
| 0.2.7 | 脚本头部 `@version` 与文档对齐；后端「开箱即全量」默认行为落地；本说明补齐自建后端/代理/排错章节 |

详细变更以提交历史为准。
