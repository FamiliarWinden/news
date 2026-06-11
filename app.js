const state = {
  items: [],
  meta: null,
  editions: [],
  currentPath: "data/news.json",
  topic: "all",
  region: "all",
  query: "",
  sort: "hot"
};

const TOPICS = { ai: "AI科技", politics: "时政", china: "中国热榜" };
const WORKFLOW_API = "https://api.github.com/repos/FamiliarWinden/news/actions/workflows/pages.yml/runs?per_page=1&branch=main";

const elements = {
  updatedAt: document.querySelector("#updatedAt"),
  refreshButton: document.querySelector("#refreshButton"),
  refreshStatus: document.querySelector("#refreshStatus"),
  leadTitle: document.querySelector("#lead-title"),
  leadSummary: document.querySelector("#lead-summary"),
  leadLink: document.querySelector("#lead-link"),
  editionDate: document.querySelector("#editionDate"),
  totalCount: document.querySelector("#totalCount"),
  politicsCount: document.querySelector("#politicsCount"),
  aiCount: document.querySelector("#aiCount"),
  chinaCount: document.querySelector("#chinaCount"),
  editionList: document.querySelector("#editionList"),
  chinaList: document.querySelector("#chinaList"),
  topicFilter: document.querySelector("#topicFilter"),
  regionFilter: document.querySelector("#regionFilter"),
  searchInput: document.querySelector("#searchInput"),
  sortSelect: document.querySelector("#sortSelect"),
  newsList: document.querySelector("#newsList"),
  aiRadar: document.querySelector("#aiRadar"),
  platformList: document.querySelector("#platformList"),
  keywordList: document.querySelector("#keywordList"),
  sourceList: document.querySelector("#sourceList")
};

async function loadNews(path = state.currentPath, { userRefresh = false } = {}) {
  state.currentPath = path;
  const startedAt = performance.now();
  if (userRefresh) {
    setRefreshState("刷新中...");
    updateRefreshStatus(["正在请求最新 JSON", "正在读取部署状态", "请稍候"]);
  }

  try {
    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const [newsPayload, archivePayload, workflowPayload] = await Promise.all([
      fetchJson(`${path}?refresh=${stamp}`),
      fetchJson(`data/archive.json?refresh=${stamp}`).catch(() => ({ editions: [] })),
      fetchWorkflowStatus().catch(() => null)
    ]);

    state.items = newsPayload.items ?? [];
    state.meta = newsPayload.meta ?? null;
    state.editions = archivePayload.editions ?? [];
    populateRegions();
    render();

    const duration = Math.round(performance.now() - startedAt);
    const completedAt = new Date().toISOString();
    updateRefreshStatus([
      `本次读取完成：${duration}ms`,
      `读取时刻：${formatFullDateTime(completedAt)}`,
      `数据生成：${state.meta?.generatedAt ? formatFullDateTime(state.meta.generatedAt) : "未知"}`,
      workflowPayload ? `最近部署：${formatWorkflow(workflowPayload)}` : "最近部署：GitHub API 暂限流"
    ]);
  } catch {
    elements.newsList.innerHTML = `<div class="empty">没有读到新闻数据。请稍后重试，或等待每日自动更新完成。</div>`;
    elements.updatedAt.textContent = "暂无数据";
    updateRefreshStatus(["刷新失败", "未能读取数据文件", "请稍后重试"]);
  } finally {
    setRefreshState(null);
  }
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchWorkflowStatus() {
  const response = await fetch(`${WORKFLOW_API}&t=${Date.now()}`, {
    cache: "no-store",
    headers: { Accept: "application/vnd.github+json" }
  });
  if (!response.ok) throw new Error(`workflow ${response.status}`);
  const payload = await response.json();
  return payload.workflow_runs?.[0] ?? null;
}

function formatWorkflow(run) {
  if (!run) return "未找到运行记录";
  const status = run.status === "completed" ? run.conclusion || "completed" : run.status;
  return `${status} · ${formatFullDateTime(run.updated_at || run.created_at)}`;
}

function setRefreshState(text) {
  elements.refreshButton.textContent = text || "刷新数据";
  elements.refreshButton.classList.toggle("is-loading", Boolean(text));
}

function updateRefreshStatus(lines) {
  elements.refreshStatus.innerHTML = lines.map((line) => `<span>${escapeHtml(line)}</span>`).join("");
}

function populateRegions() {
  const current = elements.regionFilter.value || "all";
  const regions = [...new Set(state.items.map((item) => item.region).filter(Boolean))].sort();
  elements.regionFilter.innerHTML = [
    `<option value="all">全部地区</option>`,
    ...regions.map((region) => `<option value="${escapeHtml(region)}">${escapeHtml(region)}</option>`)
  ].join("");
  elements.regionFilter.value = regions.includes(current) ? current : "all";
  state.region = elements.regionFilter.value;
}

function getFilteredItems() {
  const query = state.query.trim().toLowerCase();
  return state.items
    .filter((item) => {
      const matchesTopic = state.topic === "all" || item.topic === state.topic;
      const matchesRegion = state.region === "all" || item.region === state.region;
      const text = `${item.title} ${item.summary} ${item.source} ${item.platform} ${item.keywords?.join(" ")}`.toLowerCase();
      return matchesTopic && matchesRegion && (!query || text.includes(query));
    })
    .sort((a, b) => {
      if (state.sort === "new") return new Date(b.publishedAt) - new Date(a.publishedAt);
      if (state.sort === "ai") return topicWeight(b, TOPICS.ai) - topicWeight(a, TOPICS.ai) || b.score - a.score;
      if (state.sort === "china") return topicWeight(b, TOPICS.china) - topicWeight(a, TOPICS.china) || b.score - a.score;
      return b.score - a.score || new Date(b.publishedAt) - new Date(a.publishedAt);
    });
}

function topicWeight(item, topic) {
  return item.topic === topic ? 2 : 1;
}

function render() {
  const items = getFilteredItems();
  const lead = chooseLead(items);
  const aiItems = state.items.filter((item) => item.topic === TOPICS.ai);
  const politicsItems = state.items.filter((item) => item.topic === TOPICS.politics);
  const chinaItems = state.items.filter((item) => item.topic === TOPICS.china);

  elements.updatedAt.textContent = state.meta?.generatedAt ? `更新于 ${formatDateTime(state.meta.generatedAt)}` : "暂无更新时间";
  elements.editionDate.textContent = state.meta?.date ? `${state.meta.date} 合集` : "今日合集";
  elements.totalCount.textContent = state.items.length.toString();
  elements.politicsCount.textContent = politicsItems.length.toString();
  elements.aiCount.textContent = aiItems.length.toString();
  elements.chinaCount.textContent = chinaItems.length.toString();

  if (lead) {
    elements.leadTitle.textContent = lead.title;
    elements.leadSummary.textContent = lead.summary;
    elements.leadLink.href = lead.url;
    elements.leadLink.style.visibility = "visible";
  } else {
    elements.leadTitle.textContent = "暂无新闻数据";
    elements.leadSummary.textContent = "等待每日自动任务生成最新合集。";
    elements.leadLink.style.visibility = "hidden";
  }

  renderEditions();
  renderChinaZone(chinaItems);
  renderNewsList(items);
  renderAiRadar(aiItems);
  renderPlatforms(state.items);
  renderKeywords(items);
  renderSources(items);
}

function chooseLead(items) {
  return items.find((item) => item.topic === TOPICS.ai && item.score >= 70) ?? items[0] ?? state.items[0];
}

function renderEditions() {
  if (!state.editions.length) {
    elements.editionList.innerHTML = `<span class="edition-pill active">今日</span>`;
    return;
  }
  elements.editionList.innerHTML = state.editions
    .slice(0, 7)
    .map((edition) => {
      const active = edition.path === state.currentPath || edition.date === state.meta?.date ? " active" : "";
      return `<button class="edition-pill${active}" type="button" data-path="${escapeAttribute(edition.path)}">${escapeHtml(edition.date)} · ${edition.itemCount}</button>`;
    })
    .join("");
}

function renderChinaZone(items) {
  const groups = ["哔哩哔哩", "百度"]
    .map((platform) => ({
      platform,
      items: items.filter((item) => item.platform === platform).sort((a, b) => b.score - a.score).slice(0, 10)
    }))
    .filter((group) => group.items.length);

  if (!groups.length) {
    elements.chinaList.innerHTML = `<div class="empty">暂未抓到中国平台热榜。公开接口可能临时需要登录或风控。</div>`;
    return;
  }
  elements.chinaList.innerHTML = groups.map((group) => renderChinaGroup(group.platform, group.items)).join("");
}

function renderChinaGroup(platform, items) {
  const isBilibili = platform === "哔哩哔哩";
  return `
    <section class="china-rank">
      <div class="rank-heading">
        <h3>${escapeHtml(platform)}榜前十</h3>
        <span>${isBilibili ? "视频预览" : "搜索热榜"}</span>
      </div>
      <div class="${isBilibili ? "bili-preview-grid" : "rank-list"}">
        ${items.map((item, index) => (isBilibili ? renderBiliPreview(item, index) : renderRankRow(item, index))).join("")}
      </div>
    </section>
  `;
}

function renderBiliPreview(item, index) {
  return `
    <a class="bili-preview" href="${escapeAttribute(item.url)}" target="_blank" rel="noreferrer" aria-label="打开 B 站视频：${escapeAttribute(item.title)}">
      <div class="video-thumb">
        ${item.thumbnail ? `<img src="${escapeAttribute(item.thumbnail)}" alt="${escapeAttribute(item.title)}" decoding="async" />` : `<span class="thumb-fallback">暂无封面</span>`}
        <span class="play-mark">PLAY</span>
        <strong>${index + 1}</strong>
      </div>
      <div class="bili-copy">
        <h4>${escapeHtml(item.title)}</h4>
        <p>${escapeHtml(item.summary)}</p>
        <small>${escapeHtml(item.author || item.platform)} · 热度 ${Math.round(item.score)}</small>
      </div>
    </a>
  `;
}

function renderRankRow(item, index) {
  return `
    <a class="rank-row" href="${escapeAttribute(item.url)}" target="_blank" rel="noreferrer">
      <span class="rank-index">${index + 1}</span>
      <div>
        <h4>${escapeHtml(item.title)}</h4>
        <p>${escapeHtml(item.summary)}</p>
      </div>
      <small>${Math.round(item.score)}</small>
    </a>
  `;
}

function renderNewsList(items) {
  if (!items.length) {
    elements.newsList.innerHTML = `<div class="empty">没有匹配的新闻。</div>`;
    return;
  }
  elements.newsList.innerHTML = items.map(renderNewsCard).join("");
}

function renderNewsCard(item) {
  return `
    <article class="news-card ${item.topic === TOPICS.ai ? "ai-card" : ""} ${item.topic === TOPICS.china ? "china-news-card" : ""}">
      <header>
        <div class="badges">
          <span class="badge">${escapeHtml(item.topic || "新闻")}</span>
          <span class="badge muted">${escapeHtml(item.region || "全球")}</span>
          ${item.contentType ? `<span class="badge muted">${escapeHtml(item.contentType)}</span>` : ""}
        </div>
        <span class="score">热度 ${Math.round(item.score)}</span>
      </header>
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.summary)}</p>
      <div class="card-footer">
        <span>${escapeHtml(item.platform || item.source)} · ${formatDateTime(item.publishedAt)}</span>
        <a href="${escapeAttribute(item.url)}" target="_blank" rel="noreferrer">阅读原文</a>
      </div>
    </article>
  `;
}

function renderAiRadar(items) {
  const radarItems = items.slice().sort((a, b) => b.score - a.score).slice(0, 5);
  if (!radarItems.length) {
    elements.aiRadar.innerHTML = `<p class="muted-text">今天暂未抓到足够明确的 AI 前沿新闻。</p>`;
    return;
  }
  elements.aiRadar.innerHTML = radarItems
    .map((item) => `
      <a href="${escapeAttribute(item.url)}" target="_blank" rel="noreferrer">
        <span>${escapeHtml(item.title)}</span>
        <small>${escapeHtml(item.source)} · ${Math.round(item.score)}</small>
      </a>
    `)
    .join("");
}

function renderPlatforms(items) {
  renderCountList(elements.platformList, items.map((item) => item.platform).filter(Boolean));
}

function renderKeywords(items) {
  renderCountList(elements.keywordList, items.flatMap((item) => item.keywords ?? []), 20);
}

function renderSources(items) {
  renderCountList(elements.sourceList, items.map((item) => item.source).filter(Boolean));
}

function renderCountList(container, values, limit = 30) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  container.innerHTML = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value, count]) => `<span>${escapeHtml(value)} ${count}</span>`)
    .join("");
}

function formatDateTime(value) {
  if (!value) return "未知时间";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatFullDateTime(value) {
  if (!value) return "未知时间";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return entities[char];
  });
}

function escapeAttribute(value = "") {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function initCursorEffects() {
  const halo = document.querySelector("#cursorHalo");
  const spans = [...halo.querySelectorAll("span")];
  const pointer = { x: window.innerWidth / 2, y: window.innerHeight / 2, tx: window.innerWidth / 2, ty: window.innerHeight / 2 };
  window.addEventListener("pointermove", (event) => {
    pointer.tx = event.clientX;
    pointer.ty = event.clientY;
    document.documentElement.style.setProperty("--cursor-x", `${event.clientX}px`);
    document.documentElement.style.setProperty("--cursor-y", `${event.clientY}px`);
  }, { passive: true });

  function tick() {
    pointer.x += (pointer.tx - pointer.x) * 0.16;
    pointer.y += (pointer.ty - pointer.y) * 0.16;
    halo.style.transform = `translate3d(${pointer.x}px, ${pointer.y}px, 0)`;
    const now = performance.now() / 1000;
    spans.forEach((span, index) => {
      const angle = now * 1.7 + index * (Math.PI * 2 / spans.length);
      const radius = 42 + Math.sin(now * 2 + index) * 5;
      span.style.transform = `translate(${Math.cos(angle) * radius}px, ${Math.sin(angle) * radius}px) rotate(${angle + Math.PI / 2}rad)`;
    });
    requestAnimationFrame(tick);
  }
  tick();
}

function initParticles() {
  const canvas = document.querySelector("#particleCanvas");
  const ctx = canvas.getContext("2d");
  const pointer = { x: -9999, y: -9999 };
  let particles = [];
  let width = 0;
  let height = 0;
  let dpr = 1;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.min(120, Math.max(54, Math.floor(width * height / 16000)));
    particles = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.45,
      vy: (Math.random() - 0.5) * 0.45,
      r: Math.random() * 1.8 + 0.8
    }));
  }

  window.addEventListener("resize", resize);
  window.addEventListener("pointermove", (event) => {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
  }, { passive: true });
  window.addEventListener("pointerleave", () => {
    pointer.x = -9999;
    pointer.y = -9999;
  });

  function animate() {
    ctx.clearRect(0, 0, width, height);
    for (const p of particles) {
      const dx = p.x - pointer.x;
      const dy = p.y - pointer.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 150) {
        const force = (150 - dist) / 150;
        p.vx += (dx / Math.max(dist, 1)) * force * 0.035;
        p.vy += (dy / Math.max(dist, 1)) * force * 0.035;
      }
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.992;
      p.vy *= 0.992;
      if (p.x < -20) p.x = width + 20;
      if (p.x > width + 20) p.x = -20;
      if (p.y < -20) p.y = height + 20;
      if (p.y > height + 20) p.y = -20;
    }

    for (let i = 0; i < particles.length; i += 1) {
      const a = particles[i];
      ctx.beginPath();
      ctx.fillStyle = "rgba(81, 247, 184, 0.72)";
      ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2);
      ctx.fill();
      for (let j = i + 1; j < particles.length; j += 1) {
        const b = particles[j];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (dist < 96) {
          ctx.strokeStyle = `rgba(56, 213, 255, ${0.16 * (1 - dist / 96)})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }
    requestAnimationFrame(animate);
  }

  resize();
  animate();
}

elements.refreshButton.addEventListener("click", () => loadNews(state.currentPath, { userRefresh: true }));
elements.topicFilter.addEventListener("change", (event) => { state.topic = event.target.value; render(); });
elements.regionFilter.addEventListener("change", (event) => { state.region = event.target.value; render(); });
elements.searchInput.addEventListener("input", (event) => { state.query = event.target.value; render(); });
elements.sortSelect.addEventListener("change", (event) => { state.sort = event.target.value; render(); });
elements.editionList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-path]");
  if (button) loadNews(button.dataset.path, { userRefresh: true });
});

initCursorEffects();
initParticles();
loadNews();
