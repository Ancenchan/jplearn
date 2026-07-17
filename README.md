# 日语歌词学习

基于 PRD V1.0 的第一版实现：静态前端（GitHub Pages） + Cloudflare Worker（GitHub API 代理）。

## 目录结构

```
jplearn/
├── index.html              # 唯一入口，hash 路由 (#/, #/song/:id, #/import)
├── assets/
│   ├── style.css            # 萌系又清爽的设计系统（樱花粉 + 薄荷绿 + 淡紫）
│   └── app.js                # 前端全部逻辑：路由、渲染、单词点击、AI解析调用
├── data/                     # 公共数据库（对应 PRD 模块九）
│   ├── index.json
│   ├── songs/
│   │   └── song001.json
│   └── analysis/
│       └── song001/
│           └── song001_20260712103055.json
└── worker/
    ├── worker.js             # Cloudflare Worker：Utaten抓取 / AI解析 / GitHub读写
    └── wrangler.toml
```

内置了「千本桜」一条样例数据，方便你确认歌词详情页、单词点击、句子合并的效果。

## 已经能跑起来的部分

把整个仓库丢到 GitHub Pages（Settings → Pages → 选 main 分支根目录）就能直接看：
- 首页搜索 / 歌曲列表
- 千本桜的歌词详情页（逐行歌词、点词查语法、点「查看句子」看跨行合并结果）
- 「Lemon」之类没有 `analysis_versions` 的歌曲会自动显示未解析状态页

## AI 分词与交互说明

- 本项目支持两种切词/释义来源：
   - 本地词典（`5757词.json`）的最长匹配分词：无需联网即可按词典分词并查看词条释义。适合离线使用与快速匹配。
   - AI 解析：当为歌曲运行 AI 解析（或使用前端的“AI 切词”功能）时，AI 会为每一行输出已分词的 `words[]`，包含 `surface`、`reading`、`base`、`pos`、`conjugation`、`chain`、`meaning` 等字段。前端会使用 AI 返回的分词渲染歌词，点击任意词块会在“单词解析”区域展示该词的详细释义与形态信息。

使用建议：若你需要更准确的语法/释义与跨行句子合并，请使用「开始AI解析」将解析结果保存为一个版本（需要正确配置并部署 Worker）；若只想临时查看 AI 分词与释义，可在歌词未解析时通过前端设置 AI 配置后使用「AI 切词并显示释义」来临时生成可点击的分词视图（无需写入 GitHub）。

这部分不依赖 Worker，纯读取 `data/*.json`。

## 还需要你配置才能用的部分

「创建新的歌词解析」「开始AI解析」这两个写操作需要 Worker：

1. **部署 Worker**
   ```
   cd worker
   npx wrangler login
   npx wrangler secret put GITHUB_TOKEN   # 填一个有 repo 写权限的 fine-grained token
   npx wrangler deploy
   ```
   `wrangler.toml` 里已经填好了 `GITHUB_OWNER=Ancenchan`、`GITHUB_REPO=jplearn`，如果分支不是 `main` 记得改。

2. **把 Worker 地址告诉前端**
   部署成功后 wrangler 会给你一个 `https://jplearn-worker.xxx.workers.dev` 地址，打开浏览器控制台执行：
   ```js
   localStorage.setItem('jplearn_worker_base', 'https://jplearn-worker.xxx.workers.dev')
   ```
   （后续可以做成一个设置页，现在先用这个方式接入）

3. **配置你自己的 AI API**
   进入任意一首未解析的歌，点「开始AI解析」，第一次会弹出配置框，填 API地址 / Key / 模型名称——只存在你自己浏览器的 localStorage，不会上传 GitHub（对应 PRD 十三、安全要求）。

## 已知的简化 / TODO

- **Utaten 抓取**：`worker.js` 里的 `extractUtatenLyrics` 只是占位实现，Utaten 的真实 HTML 结构需要你打开一个歌词页看看，再调整选择器。
- **kuromoji.js + JMdict 本地词典**（PRD 模块八）：第一版先用 AI 解析结果里的词性/原形/释义做单词卡片，够用；本地词典是后续增强，等基础流程跑通了再加，避免一开始就引入几十MB的词典文件。
- **多解析版本切换 UI**：数据结构已经支持同一首歌多个 `analysis_versions`，但详情页目前只展示最新一个版本，版本切换器还没做。
- **歌曲/解析的增删改查后台**（PRD 模块三 3.2/3.3）还没做界面，目前只有「新增」。

有了实际的 Worker 地址和一两条真实解析数据之后，可以再一起过一遍效果，把上面这几个 TODO 排个优先级。
