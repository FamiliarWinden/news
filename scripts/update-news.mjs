import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const dataDir = join(projectRoot, "data");
const dailyDir = join(dataDir, "daily");
const thumbsDir = join(dataDir, "thumbs");
const today = new Date().toISOString().slice(0, 10);
const currentPath = join(dataDir, "news.json");
const archivePath = join(dataDir, "archive.json");
const dailyPath = join(dailyDir, `${today}.json`);

const feeds = [
  ["Google News Politics", "时政", "全球", "https://news.google.com/rss/search?q=geopolitics%20OR%20election%20OR%20government%20OR%20diplomacy%20OR%20sanctions&hl=zh-CN&gl=CN&ceid=CN:zh-Hans"],
  ["Google News AI", "AI科技", "全球", "https://news.google.com/rss/search?q=artificial%20intelligence%20OR%20AI%20model%20OR%20OpenAI%20OR%20Anthropic%20OR%20Nvidia%20OR%20semiconductor&hl=zh-CN&gl=CN&ceid=CN:zh-Hans"],
  ["BBC World", "时政", "全球", "https://feeds.bbci.co.uk/news/world/rss.xml"],
  ["The Guardian World", "时政", "全球", "https://www.theguardian.com/world/rss"],
  ["NPR World", "时政", "全球", "https://feeds.npr.org/1004/rss.xml"],
  ["MIT Technology Review", "AI科技", "科技", "https://www.technologyreview.com/feed/"],
  ["VentureBeat AI", "AI科技", "科技", "https://venturebeat.com/category/ai/feed/"],
  ["TechCrunch AI", "AI科技", "科技", "https://techcrunch.com/category/artificial-intelligence/feed/"],
  ["The Verge AI", "AI科技", "科技", "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml"],
  ["量子位", "AI科技", "中国科技", "https://www.qbitai.com/feed", "量子位"],
  ["IT之家", "AI科技", "中国科技", "https://www.ithome.com/rss/", "IT之家"],
  ["36氪", "AI科技", "中国科技", "https://36kr.com/feed", "36氪"]
].map(([name, topic, region, url, platform]) => ({ name, topic, region, url, platform }));

const politicsTerms = ["war", "ceasefire", "election", "president", "minister", "government", "diplomacy", "sanction", "tariff", "summit", "court", "protest", "military", "nuclear", "china", "russia", "ukraine", "iran", "gaza", "时政", "选举", "总统", "政府", "外交", "制裁", "关税", "峰会", "军事", "战争", "停火", "抗议", "核"];
const aiTerms = ["artificial intelligence", "generative ai", "large language model", "foundation model", "openai", "anthropic", "deepmind", "nvidia", "semiconductor", "gpu", "model", "agent", "robotics", "inference", "training", "benchmark", "ai safety", "人工智能", "大模型", "生成式", "算力", "芯片", "机器人", "智能体", "模型", "推理", "训练"];
const offTopicTerms = ["champions league", "premier league", "football", "soccer", "tennis", "nba", "nfl", "fifa", "olympic", "box office", "celebrity", "movie review", "album", "concert", "psg", "arsenal", "browser wars", "chrome and safari"];

async function main() {
  await mkdir(thumbsDir, { recursive: true });
  const previousChinaItems = await readPreviousChinaItems();
  const feedBatches = await Promise.allSettled(feeds.map(fetchFeed));
  const chinaBatches = await Promise.allSettled([fetchBilibiliPopular(), fetchBaiduHot()]);
  const fetchedChinaItems = chinaBatches.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  const chinaItems = fetchedChinaItems.filter((item) => item.topic === "中国热榜").length >= 10
    ? fetchedChinaItems
    : previousChinaItems;
  const rawItems = [
    ...feedBatches.flatMap((result) => (result.status === "fulfilled" ? result.value : [])),
    ...chinaItems
  ];
  const items = selectBalancedItems(scoreItems(dedupe(rawItems.filter(isRelevantNews))));
  const payload = {
    meta: {
      date: today,
      generatedAt: new Date().toISOString(),
      feedCount: feeds.length + 2,
      itemCount: items.length,
      focus: "时政、AI 科技前沿与中国平台热榜",
      scoring: "freshness + relevance + source priority + platform ranking"
    },
    items
  };

  await mkdir(dailyDir, { recursive: true });
  await writeFile(currentPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await writeFile(dailyPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await updateArchive(payload);
  console.log(`Wrote ${items.length} focused news items to ${currentPath}`);
}

async function readPreviousChinaItems() {
  try {
    const payload = JSON.parse(await readFile(currentPath, "utf8"));
    return (payload.items ?? []).filter((item) => item.topic === "中国热榜");
  } catch {
    return [];
  }
}

async function fetchFeed(feed) {
  const response = await fetch(feed.url, { headers: { "User-Agent": "SignalBrief/1.0" } });
  if (!response.ok) throw new Error(`${feed.name} failed with ${response.status}`);
  const xml = await response.text();
  return parseRss(xml).map((item) => {
    const topic = inferTopic(`${item.title} ${item.summary}`, feed.topic);
    return {
      ...item,
      topic,
      source: item.source || feed.name,
      feed: feed.name,
      platform: feed.platform || item.source || feed.name,
      contentType: "文章",
      region: topic === "AI科技" ? inferTechRegion(`${item.title} ${item.summary}`, feed.region) : inferRegion(`${item.title} ${item.summary}`, feed.region)
    };
  });
}

async function fetchBilibiliPopular() {
  const response = await fetch("https://api.bilibili.com/x/web-interface/popular", { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!response.ok) throw new Error(`B站热门 failed with ${response.status}`);
  const payload = await response.json();
  return Promise.all((payload.data?.list ?? []).slice(0, 10).map(async (item, index) => {
    const title = clean(item.title);
    const desc = clean(item.desc || item.rcmd_reason?.content || "");
    const remoteThumbnail = item.pic ? normalizeImageUrl(item.pic) : "";
    const thumbnail = remoteThumbnail ? await cacheThumbnail(remoteThumbnail, item.bvid || title) : "";
    return buildChinaItem({
      title,
      summary: desc,
      url: item.short_link_v2 || `https://www.bilibili.com/video/${item.bvid}`,
      source: "B站热门",
      platform: "哔哩哔哩",
      contentType: "视频",
      score: 100 - index,
      publishedAt: item.pubdate ? new Date(item.pubdate * 1000).toISOString() : new Date().toISOString(),
      rawText: `${title} ${desc} ${item.owner?.name ?? ""}`,
      thumbnail: thumbnail || remoteThumbnail,
      author: item.owner?.name || "",
      bvid: item.bvid || ""
    });
  }));
}

async function fetchBaiduHot() {
  const response = await fetch("https://top.baidu.com/board?tab=realtime", { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!response.ok) throw new Error(`百度实时热榜 failed with ${response.status}`);
  const html = await response.text();
  const match = html.match(/<!--s-data:([\s\S]*?)-->/);
  if (!match) return [];
  const payload = JSON.parse(match[1]);
  const content = payload.data?.cards?.find((card) => card.component === "hotList")?.content ?? [];
  return content.slice(0, 10).map((item, index) => {
    const title = clean(item.word || item.query || "");
    return buildChinaItem({
      title,
      summary: clean(item.desc || item.hotDesc || ""),
      url: item.url || item.appUrl || `https://www.baidu.com/s?wd=${encodeURIComponent(title)}`,
      source: "百度实时热榜",
      platform: "百度",
      contentType: "搜索热榜",
      score: 98 - index,
      publishedAt: new Date().toISOString(),
      rawText: `${title} ${item.desc || ""}`
    });
  });
}

function buildChinaItem({ title, summary, url, source, platform, contentType, score, publishedAt, rawText, thumbnail = "", author = "", bvid = "" }) {
  return {
    id: slug(`${source}-${title}-${url}`),
    title,
    url,
    source,
    platform,
    contentType,
    topic: "中国热榜",
    region: "中国",
    publishedAt,
    summary: makeChineseSummary({ title, summary, source, platform, contentType, topic: "中国热榜" }),
    keywords: extractKeywords(rawText || `${title} ${summary}`),
    score,
    thumbnail,
    author,
    bvid
  };
}

async function updateArchive(payload) {
  let archive = { editions: [] };
  try {
    archive = JSON.parse(await readFile(archivePath, "utf8"));
  } catch {
    archive = { editions: [] };
  }
  const edition = {
    date: payload.meta.date,
    generatedAt: payload.meta.generatedAt,
    itemCount: payload.items.length,
    aiCount: payload.items.filter((item) => item.topic === "AI科技").length,
    politicsCount: payload.items.filter((item) => item.topic === "时政").length,
    chinaCount: payload.items.filter((item) => item.topic === "中国热榜").length,
    path: `data/daily/${payload.meta.date}.json`
  };
  const editions = [edition, ...(archive.editions ?? []).filter((item) => item.date !== edition.date)]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 30);
  await writeFile(archivePath, `${JSON.stringify({ editions }, null, 2)}\n`, "utf8");
}

function isRelevantNews(item) {
  const text = `${item.title} ${item.summary}`.toLowerCase();
  if (offTopicTerms.some((term) => text.includes(term))) return false;
  if (item.topic === "中国热榜") return true;
  const politicsHits = countTerms(text, politicsTerms);
  const aiHits = countTerms(text, aiTerms);
  return item.topic === "AI科技" ? aiHits > 0 : politicsHits > 0 || aiHits > 0;
}

function selectBalancedItems(items) {
  const sorted = items.slice().sort((a, b) => b.score - a.score || new Date(b.publishedAt) - new Date(a.publishedAt));
  const byTopic = (topic) => sorted.filter((item) => item.topic === topic);
  const picked = [
    ...byTopic("AI科技").slice(0, 18),
    ...byTopic("时政").slice(0, 14),
    ...selectChinaItems(byTopic("中国热榜"), 20)
  ];
  const seen = new Set();
  return picked.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  }).sort((a, b) => b.score - a.score || new Date(b.publishedAt) - new Date(a.publishedAt));
}

function selectChinaItems(items, limit) {
  const picked = ["哔哩哔哩", "百度"].flatMap((platform) => items.filter((item) => item.platform === platform).slice(0, 10));
  return picked.slice(0, limit);
}

function parseRss(xml) {
  return (xml.match(/<item[\s\S]*?<\/item>/gi) || []).map((block) => {
    const title = clean(readTag(block, "title"));
    const link = clean(readTag(block, "link"));
    const description = clean(readTag(block, "description") || readTag(block, "content:encoded"));
    const source = clean(readTag(block, "source"));
    return {
      id: slug(`${title}-${link}`),
      title,
      url: link,
      source,
      publishedAt: normalizeDate(readTag(block, "pubDate") || readTag(block, "dc:date")),
      summary: makeChineseSummary({ title, summary: description, source, topic: "新闻" }),
      keywords: extractKeywords(`${title} ${description}`)
    };
  }).filter((item) => item.title && item.url);
}

function readTag(block, tagName) {
  const escaped = tagName.replace(":", "\\:");
  return block.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i"))?.[1] || "";
}

function clean(value = "") {
  return decodeEntities(value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function decodeEntities(value) {
  const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([a-f0-9]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (_, name) => entities[name] ?? `&${name};`);
}

function normalizeDate(value) {
  const date = value ? new Date(clean(value)) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function summarize(text) {
  const cleaned = clean(text);
  if (!cleaned) return "这条内容暂无完整摘要，建议打开原文查看具体细节。";
  const summary = cleaned.split(/(?<=[.!?。！？])\s+/).filter(Boolean).slice(0, 2).join(" ");
  return summary.length > 240 ? `${summary.slice(0, 237)}...` : summary;
}

function makeChineseSummary({ title, summary, source, platform, contentType, topic }) {
  const cleanedTitle = clean(title);
  const cleanedSummary = summarize(summary || "");
  const publisher = platform || source || "该来源";
  const kind = contentType || (topic === "AI科技" ? "AI 科技文章" : topic === "时政" ? "时政新闻" : "内容");
  if (cleanedSummary && cleanedSummary !== "这条内容暂无完整摘要，建议打开原文查看具体细节。" && cleanedSummary.toLowerCase() !== "new") {
    return `${publisher} 的${kind}关注「${cleanedTitle}」。核心内容是：${cleanedSummary}`;
  }
  return `${publisher} 的${kind}正在热传，主题是「${cleanedTitle}」。这条内容暂无完整摘要，建议打开原文查看具体细节。`;
}

function extractKeywords(text) {
  const words = clean(text).toLowerCase().match(/[\p{Script=Han}]{2,}|[a-z][a-z-]{3,}/giu) || [];
  const stopWords = new Set(["with", "from", "that", "this", "have", "after", "over", "their", "about", "world", "news", "says", "will", "more", "what", "when", "where", "the", "and", "for", "are", "into", "new", "latest", "一个", "以及", "已经", "关于", "新闻", "表示", "最新"]);
  const counts = new Map();
  for (const word of words) {
    if (!stopWords.has(word) && word.length <= 28) counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7).map(([word]) => word);
}

function inferTopic(text, fallback) {
  const value = text.toLowerCase();
  const aiHits = countTerms(value, aiTerms);
  const politicsHits = countTerms(value, politicsTerms);
  if (aiHits >= politicsHits && aiHits > 0) return "AI科技";
  if (politicsHits > 0) return "时政";
  return fallback;
}

function inferTechRegion(text, fallback) {
  const value = text.toLowerCase();
  if (["china", "beijing", "alibaba", "baidu", "bytedance", "deepseek", "中国", "北京"].some((marker) => value.includes(marker))) return "中国科技";
  if (["openai", "anthropic", "nvidia", "google", "meta", "microsoft", "silicon valley"].some((marker) => value.includes(marker))) return "美国科技";
  if (["eu ", "europe", "uk", "britain", "france", "germany", "欧盟", "欧洲"].some((marker) => value.includes(marker))) return "欧洲科技";
  return fallback || "科技";
}

function inferRegion(text, fallback) {
  const value = text.toLowerCase();
  const rules = [
    ["美国", ["u.s.", " us ", "america", "trump", "washington", "united states", "美国"]],
    ["欧洲", ["europe", "eu ", "ukraine", "russia", "france", "germany", "britain", "欧洲", "乌克兰", "俄罗斯"]],
    ["中东", ["middle east", "israel", "gaza", "iran", "syria", "yemen", "中东", "以色列", "加沙", "伊朗"]],
    ["亚太", ["china", "japan", "korea", "india", "taiwan", "asia", "中国", "日本", "韩国", "印度", "亚洲"]]
  ];
  return rules.find(([, markers]) => markers.some((marker) => value.includes(marker)))?.[0] || fallback || "全球";
}

function dedupe(items) {
  const seen = new Map();
  for (const item of items) {
    const key = normalizeTitle(item.title);
    const existing = seen.get(key);
    if (!existing || new Date(item.publishedAt) > new Date(existing.publishedAt)) seen.set(key, item);
  }
  return [...seen.values()];
}

function normalizeTitle(title) {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").filter((word) => word.length > 2).slice(0, 10).join(" ");
}

function scoreItems(items) {
  const coverage = new Map();
  for (const item of items) {
    for (const token of new Set(normalizeTitle(item.title).split(" ").filter(Boolean))) coverage.set(token, (coverage.get(token) ?? 0) + 1);
  }
  return items.map((item) => {
    const text = `${item.title} ${item.summary}`.toLowerCase();
    const ageHours = Math.max(0, (Date.now() - new Date(item.publishedAt).getTime()) / 36e5);
    const freshness = Math.max(0, 28 - ageHours * 0.7);
    const sourceCoverage = normalizeTitle(item.title).split(" ").filter(Boolean).reduce((sum, token) => sum + (coverage.get(token) ?? 0), 0);
    const aiBoost = countTerms(text, aiTerms) * 5;
    const politicsBoost = countTerms(text, politicsTerms) * 4;
    const topicBoost = item.topic === "AI科技" ? 12 : item.topic === "中国热榜" ? 16 : 8;
    const sourceBoost = sourcePriority(item.source, item.topic);
    const presetScore = Number.isFinite(item.score) ? item.score : 0;
    return { ...item, score: Math.round(Math.min(100, Math.max(presetScore, 18 + freshness + sourceCoverage * 1.3 + aiBoost + politicsBoost + topicBoost + sourceBoost))) };
  });
}

function sourcePriority(source, topic) {
  const normalized = source.toLowerCase();
  if (topic === "中国热榜") return 8;
  if (topic === "AI科技" && ["mit technology review", "venturebeat", "techcrunch", "the verge"].some((name) => normalized.includes(name))) return 8;
  if (["bbc", "guardian", "npr", "google news"].some((name) => normalized.includes(name))) return 5;
  return 0;
}

function normalizeImageUrl(url) {
  if (!url) return "";
  if (url.startsWith("//")) return `https:${url}`;
  return url.replace(/^http:\/\//, "https://");
}

async function cacheThumbnail(url, seed) {
  try {
    const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Referer: "https://www.bilibili.com/" } });
    if (!response.ok) return "";
    const contentType = response.headers.get("content-type") || "";
    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    const filename = `${createHash("sha1").update(`${seed}-${url}`).digest("hex").slice(0, 16)}.${ext}`;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 1024) return "";
    await writeFile(join(thumbsDir, filename), bytes);
    return `data/thumbs/${filename}`;
  } catch {
    return "";
  }
}

function countTerms(text, terms) {
  return terms.reduce((sum, term) => (text.includes(term.toLowerCase()) ? sum + 1 : sum), 0);
}

function slug(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return `news-${Math.abs(hash)}`;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
