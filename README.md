# 今日时政、AI 前沿与中国热文

这是一个本地静态网站，每天从公开 RSS、公开热榜和可访问平台接口抓取内容，生成“时政 + AI 科技前沿 + 中国平台热文”的每日合集。页面支持主题筛选、地区筛选、关键词搜索、热度排序和历史合集切换。

## 使用

生成当天新闻合集：

```powershell
npm run update
```

启动本地网站：

```powershell
npm run serve
```

访问：

```text
http://localhost:4173
```

## 发布成别人可访问的网站

推荐使用 GitHub Pages。这个项目已经包含 `.github/workflows/pages.yml`，推到 GitHub 后会自动构建并发布静态网站。

1. 初始化 Git 仓库并提交：

   ```powershell
   git init
   git add .
   git commit -m "Create daily news site"
   ```

2. 在 GitHub 创建一个新仓库，然后按 GitHub 给出的命令添加远程仓库并推送：

   ```powershell
   git branch -M main
   git remote add origin https://github.com/你的用户名/你的仓库名.git
   git push -u origin main
   ```

3. 打开 GitHub 仓库的 Settings -> Pages，把 Source 选择为 GitHub Actions。

4. 进入 Actions，运行或等待 `Publish Daily News Site` 工作流。发布成功后，GitHub 会给出一个公开网址。

工作流会在每天 UTC 23:00 自动运行一次，大约对应北京时间每天 07:00，自动重新抓取新闻并发布最新页面。

如果你更想用 Vercel 或 Netlify，也可以直接把这个目录作为静态站部署；但每日自动抓取需要额外配置对应平台的 Cron Job 或 Scheduled Function。

## 数据产物

- `data/news.json`：当前最新合集
- `data/daily/YYYY-MM-DD.json`：每天归档的合集文件
- `data/archive.json`：历史合集索引

## 抓取重点

当前抓取和评分偏向：

- 国际时政：选举、政府、外交、制裁、战争、停火、军事、关税、峰会等
- AI 科技：大模型、生成式 AI、智能体、芯片、算力、机器人、模型训练、推理、AI 安全等
- 中国热文：B 站热门视频、今日头条热榜、百度实时热榜，以及可公开访问的中文科技媒体文章

每条内容都会生成一段中文摘要。热度分由时效性、关键词强度、来源优先级、多源覆盖度和平台热榜排名共同决定。

## 当前公开平台源

- 哔哩哔哩：热门视频
- 今日头条：热榜话题
- 百度：实时搜索热榜
- 中文科技媒体：量子位、IT之家、36氪

微博、知乎等平台的官方接口通常需要登录态或 Cookie；当前脚本不会绕过登录风控。后续如果提供可用 Cookie，可以在 `scripts/update-news.mjs` 中新增对应抓取器。

## 每天自动更新

可以用 Windows 任务计划程序每天运行：

```powershell
powershell -ExecutionPolicy Bypass -Command "cd H:\new; npm run update"
```

如果系统里的 `node` 不可执行，可把命令里的 `npm run update` 换成可用 Node 的完整路径：

```powershell
"C:\Users\35541\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" H:\new\scripts\update-news.mjs
```
