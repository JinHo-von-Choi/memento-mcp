/**
 * Memento MCP Admin Console -- Stitch Design Aligned SPA
 *
 * 작성자: 최진호
 * 작성일: 2026-03-26
 *
 * 보안 참고: 모든 동적 콘텐츠는 textContent를 통해 XSS 방어됨.
 * 이 콘솔은 마스터 키 인증 후에만 접근 가능한 내부 관리 도구임.
 */

/* ================================================================
   1. State Management
   ================================================================ */

const state = {
  masterKey:   sessionStorage.getItem("adminKey") || "",
  currentView: "overview",
  stats:       null,
  keys:        [],
  groups:      [],
  memoryData:  null,
  loading:     false,
  lastUpdated: null,

  selectedKeyId:   null,
  selectedGroupId: null,

  memoryFilter: { topic: "", type: "", key_id: "" },
  memoryPage:   1,
  memoryPages:  1,
  fragments:    [],
  selectedFragment: null,
  anomalies:    null,
  searchEvents: null
};

/* ================================================================
   2. API Client
   ================================================================ */

const API_BASE = "/v1/internal/model/nothing";

async function api(path, options = {}) {
  const url     = `${API_BASE}${path}`;
  const headers = { "Authorization": `Bearer ${state.masterKey}` };

  if (options.body && typeof options.body === "object") {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(options.body);
  }

  try {
    const resp = await fetch(url, { ...options, headers: { ...headers, ...options.headers } });
    let data   = null;
    const ct   = resp.headers.get("content-type") || "";
    if (ct.includes("json") && resp.status !== 204) {
      data = await resp.json();
    }
    return { ok: resp.ok, status: resp.status, data };
  } catch (err) {
    return { ok: false, status: 0, error: err.message };
  }
}

/* ================================================================
   3. Router
   ================================================================ */

function navigate(view) {
  state.currentView = view;
  renderSidebar();
  renderCommandBar();
  renderView();
}

function renderView() {
  const container = document.getElementById("view-container");
  if (!container) return;

  switch (state.currentView) {
    case "overview":  renderOverview(container);  break;
    case "keys":      renderKeys(container);      break;
    case "groups":    renderGroups(container);     break;
    case "memory":    renderMemory(container);     break;
    case "sessions":  renderScaffold(container, "sessions"); break;
    case "logs":      renderScaffold(container, "logs"); break;
    default:          renderOverview(container);
  }
}

function renderScaffold(container, viewId) {
  container.textContent = "";
  const wrap = document.createElement("div");
  wrap.className = "space-y-6";

  const scaffolds = {
    sessions: {
      title: "세션 관리",
      note:  "API 연동 대기 -- 현재 세션 수는 개요에서 확인 가능",
      sections: ["활성 세션 목록", "세션 상세", "만료된 세션 정리"]
    },
    logs: {
      title: "시스템 로그",
      note:  "API 연동 대기 -- Winston 로그 스트림 연동 예정",
      sections: ["로그 레벨 필터", "로그 목록", "로그 상세"]
    }
  };

  const cfg = scaffolds[viewId] ?? { title: viewId, note: "후속 구현 예정", sections: [] };

  const h = document.createElement("h2");
  h.className = "text-2xl font-headline font-bold tracking-tight";
  h.textContent = cfg.title;
  wrap.appendChild(h);

  const note = document.createElement("p");
  note.className = "text-sm text-slate-400 glass-panel p-4 border-l-2 border-secondary";
  note.textContent = cfg.note;
  wrap.appendChild(note);

  for (const label of cfg.sections) {
    const sec = document.createElement("div");
    sec.className = "glass-panel p-6 rounded-sm";
    const sh = document.createElement("h3");
    sh.className = "font-headline text-sm font-bold uppercase tracking-widest text-slate-400 mb-4";
    sh.textContent = label;
    sec.appendChild(sh);
    const ph = document.createElement("div");
    ph.className = "text-sm text-slate-600 text-center py-8 border border-dashed border-white/5";
    ph.textContent = "-- " + label + " --";
    sec.appendChild(ph);
    wrap.appendChild(sec);
  }

  container.appendChild(wrap);
}

/* ================================================================
   4. Toast System
   ================================================================ */

function showToast(message, type = "info") {
  const root = document.getElementById("toast-root");
  if (!root) return;

  const el = document.createElement("div");
  el.className = "toast " + type;
  el.textContent = message;
  root.appendChild(el);

  setTimeout(() => {
    el.classList.add("fade-out");
    el.addEventListener("animationend", () => el.remove());
  }, 3000);
}

/* ================================================================
   5. Modal System
   ================================================================ */

function showModal(title, bodyEl, actions) {
  const root = document.getElementById("modal-root");
  if (!root) return;

  root.textContent = "";

  const card = document.createElement("div");
  card.className = "modal-card";

  const titleEl = document.createElement("div");
  titleEl.className = "modal-title";
  titleEl.textContent = title;
  card.appendChild(titleEl);

  const bodyWrap = document.createElement("div");
  bodyWrap.className = "modal-body";
  if (typeof bodyEl === "string") {
    bodyWrap.appendChild(buildSafeHtml(bodyEl));
  } else if (bodyEl instanceof Node) {
    bodyWrap.appendChild(bodyEl);
  }
  card.appendChild(bodyWrap);

  const actionsWrap = document.createElement("div");
  actionsWrap.className = "modal-actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn";
  cancelBtn.textContent = "CANCEL";
  cancelBtn.addEventListener("click", closeModal);
  actionsWrap.appendChild(cancelBtn);

  if (actions && actions.length) {
    actions.forEach(a => {
      const btn = document.createElement("button");
      btn.className = "btn " + (a.cls || "");
      btn.textContent = a.label;
      if (a.handler) btn.addEventListener("click", a.handler);
      actionsWrap.appendChild(btn);
    });
  }

  card.appendChild(actionsWrap);
  root.appendChild(card);
  root.classList.add("visible");
}

function closeModal() {
  const root = document.getElementById("modal-root");
  if (root) {
    root.classList.remove("visible");
    root.textContent = "";
  }
}

function buildSafeHtml(text) {
  const span = document.createElement("span");
  span.textContent = text;
  return span;
}

/* ================================================================
   6. Login Screen
   ================================================================ */

function renderLogin() {
  const root = document.getElementById("login-root");
  if (!root) return;

  root.classList.remove("hidden");
  const app = document.getElementById("app");
  if (app) app.classList.remove("visible");

  root.textContent = "";
  const card = document.createElement("div");
  card.className = "login-card";

  const titleEl = document.createElement("div");
  titleEl.className = "login-title";
  titleEl.textContent = "MEMENTO MCP";
  card.appendChild(titleEl);

  const sub = document.createElement("div");
  sub.className = "login-sub";
  sub.textContent = "Operations Console Authentication Required";
  card.appendChild(sub);

  const input = document.createElement("input");
  input.type = "password";
  input.className = "login-input";
  input.id = "login-key";
  input.placeholder = "ACCESS_KEY";
  input.autocomplete = "off";
  card.appendChild(input);

  const errEl = document.createElement("div");
  errEl.className = "login-error";
  errEl.id = "login-error";
  errEl.textContent = "AUTHENTICATION FAILED";
  card.appendChild(errEl);

  const btn = document.createElement("button");
  btn.className = "login-btn";
  btn.id = "login-btn";
  btn.textContent = "AUTHENTICATE";
  card.appendChild(btn);

  root.appendChild(card);

  async function attemptLogin() {
    const key = input.value.trim();
    if (!key) return;

    btn.disabled = true;
    state.masterKey = key;

    const res = await api("/auth", { method: "POST", body: { key } });
    if (res.ok) {
      sessionStorage.setItem("adminKey", key);
      root.classList.add("hidden");
      const appEl = document.getElementById("app");
      if (appEl) appEl.classList.add("visible");
      navigate("overview");
    } else {
      errEl.classList.add("visible");
      state.masterKey = "";
      sessionStorage.removeItem("adminKey");
      btn.disabled = false;
    }
  }

  btn.addEventListener("click", attemptLogin);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") attemptLogin(); });
}

function logout() {
  state.masterKey = "";
  sessionStorage.removeItem("adminKey");
  renderLogin();
}

/* ================================================================
   7. Sidebar (Stitch: #0c1326, Space Grotesk, Material Symbols)
   ================================================================ */

const NAV_ITEMS = [
  { id: "overview", label: "개요",       icon: "dashboard" },
  { id: "keys",     label: "API 키",     icon: "vpn_key" },
  { id: "groups",   label: "그룹",       icon: "group" },
  { id: "memory",   label: "메모리 운영", icon: "memory" },
  { id: "sessions", label: "세션",       icon: "settings_input_component", scaffold: true },
  { id: "logs",     label: "로그",       icon: "terminal", scaffold: true }
];

function renderSidebar() {
  const el = document.getElementById("sidebar");
  if (!el) return;

  el.textContent = "";

  /* Brand */
  const brand = document.createElement("div");
  brand.className = "px-6 mb-8";

  const brandTitle = document.createElement("div");
  brandTitle.className = "text-xl font-bold tracking-tighter text-cyan-400 font-headline";
  brandTitle.textContent = "MEMENTO MCP";
  brand.appendChild(brandTitle);

  const brandSub = document.createElement("div");
  brandSub.className = "text-[10px] text-slate-500 tracking-[0.2em] font-medium uppercase mt-1 font-label";
  brandSub.textContent = "OPERATIONS CONSOLE";
  brand.appendChild(brandSub);

  el.appendChild(brand);

  /* Nav */
  const nav = document.createElement("nav");
  nav.className = "flex-1 px-3 space-y-1";

  NAV_ITEMS.forEach(n => {
    const item = document.createElement("a");
    item.href = "#";
    const isActive = n.id === state.currentView;

    if (isActive) {
      item.className = "flex items-center gap-3 px-4 py-2.5 rounded-sm text-cyan-400 bg-cyan-400/10 border-l-2 border-cyan-400 transition-all duration-200";
    } else {
      item.className = "flex items-center gap-3 px-4 py-2.5 rounded-sm text-slate-500 hover:text-slate-200 hover:bg-white/5 transition-all duration-200";
    }

    if (n.scaffold) {
      item.style.opacity = "0.6";
    }

    const icon = document.createElement("span");
    icon.className = "material-symbols-outlined text-[20px]";
    icon.textContent = n.icon;
    item.appendChild(icon);

    const label = document.createElement("span");
    label.className = "text-sm font-medium";
    label.textContent = n.label;
    item.appendChild(label);

    item.addEventListener("click", (e) => { e.preventDefault(); navigate(n.id); });
    nav.appendChild(item);
  });
  el.appendChild(nav);

  /* Bottom: Settings + Logout */
  const bottom = document.createElement("div");
  bottom.className = "px-3 py-4 border-t border-cyan-500/10 space-y-1 mt-auto";

  const logoutItem = document.createElement("a");
  logoutItem.href = "#";
  logoutItem.className = "flex items-center gap-3 px-4 py-2 text-slate-500 hover:text-red-400 transition-colors text-xs font-medium uppercase tracking-wider";
  const logoutIcon = document.createElement("span");
  logoutIcon.className = "material-symbols-outlined text-[18px]";
  logoutIcon.textContent = "logout";
  logoutItem.appendChild(logoutIcon);
  logoutItem.appendChild(document.createTextNode("LOGOUT"));
  logoutItem.addEventListener("click", (e) => { e.preventDefault(); logout(); });
  bottom.appendChild(logoutItem);

  el.appendChild(bottom);
}

/* ================================================================
   8. Command Bar (Stitch: bg-slate-950/60, PRODUCTION badge, status)
   ================================================================ */

const VIEW_TITLES = {
  overview: "Operations Overview",
  keys:     "API Key Management",
  groups:   "Group Management",
  memory:   "Memory Operations",
  sessions: "Session Management",
  logs:     "System Logs"
};

function renderCommandBar() {
  const el = document.getElementById("command-bar");
  if (!el) return;

  el.textContent = "";

  /* Left: Status badges */
  const left = document.createElement("div");
  left.className = "flex items-center gap-4";

  const envBadge = document.createElement("span");
  envBadge.className = "px-2 py-0.5 bg-cyan-400/10 text-cyan-400 border border-cyan-400/20 text-[10px] font-mono tracking-widest font-bold rounded-sm";
  envBadge.textContent = "PRODUCTION";
  left.appendChild(envBadge);

  const healthDot = document.createElement("div");
  healthDot.className = "flex items-center gap-2";
  const dot = document.createElement("div");
  dot.className = "w-1.5 h-1.5 bg-tertiary rounded-full pulsing-glow";
  dot.style.color = "#00fabf";
  healthDot.appendChild(dot);
  const healthText = document.createElement("span");
  healthText.className = "text-xs font-mono text-slate-400 uppercase tracking-tighter";
  healthText.textContent = "HEALTH: ONLINE";
  healthDot.appendChild(healthText);
  left.appendChild(healthDot);

  const sep = document.createElement("div");
  sep.className = "h-4 w-px bg-slate-800";
  left.appendChild(sep);

  const syncText = document.createElement("span");
  syncText.className = "text-[10px] font-mono text-slate-500 uppercase";
  syncText.textContent = "SYNCED: " + (state.lastUpdated ? relativeTime(state.lastUpdated) : "--");
  left.appendChild(syncText);

  el.appendChild(left);

  /* Right: actions */
  const right = document.createElement("div");
  right.className = "flex items-center gap-4";

  const refreshBtn = document.createElement("button");
  refreshBtn.className = "text-slate-400 hover:text-cyan-400 transition-all";
  const refreshIcon = document.createElement("span");
  refreshIcon.className = "material-symbols-outlined";
  refreshIcon.textContent = "refresh";
  refreshBtn.appendChild(refreshIcon);
  refreshBtn.addEventListener("click", () => renderView());
  right.appendChild(refreshBtn);

  const divider = document.createElement("div");
  divider.className = "h-8 w-px bg-white/10";
  right.appendChild(divider);

  const userInfo = document.createElement("div");
  userInfo.className = "flex items-center gap-3";
  const userText = document.createElement("div");
  userText.className = "text-right";
  const userName = document.createElement("div");
  userName.className = "text-xs font-bold text-slate-200 font-headline";
  userName.textContent = "ADMIN_ROOT";
  userText.appendChild(userName);
  const userLevel = document.createElement("div");
  userLevel.className = "text-[8px] font-mono text-slate-500";
  userLevel.textContent = "LVL 4 ACCESS";
  userText.appendChild(userLevel);
  userInfo.appendChild(userText);

  const userIcon = document.createElement("span");
  userIcon.className = "material-symbols-outlined text-slate-400 text-3xl";
  userIcon.textContent = "account_circle";
  userInfo.appendChild(userIcon);

  right.appendChild(userInfo);

  el.appendChild(right);
}

/* ================================================================
   9. Overview Dashboard (Stitch Screen 1)
   ================================================================ */

function renderOverviewCards(stats) {
  if (!stats) return loadingHtml();

  const queues = stats.queues ?? {};
  const cards  = [
    { label: "총 파편 수",    value: fmt(stats.fragments),             icon: "database" },
    { label: "활성 세션",     value: fmt(stats.sessions),              icon: "groups" },
    { label: "오늘 API 호출",  value: fmt(stats.apiCallsToday),         icon: "api" },
    { label: "활성 키",       value: fmt(stats.activeKeys),            icon: "vpn_key" },
    { label: "DB 크기",       value: stats.system?.dbSizeBytes ? fmtBytes(stats.system.dbSizeBytes) : "--", icon: "storage" },
    { label: "Redis 상태",    value: stats.redis ?? "unknown",         icon: "memory" }
  ];

  const grid = document.createElement("div");
  grid.className = "grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8";

  cards.forEach(c => {
    const card = document.createElement("div");
    card.className = "glass-panel p-5 relative overflow-hidden group";
    card.dataset.kpi = c.label;

    /* Ghost icon */
    const ghost = document.createElement("div");
    ghost.className = "absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity";
    const ghostIcon = document.createElement("span");
    ghostIcon.className = "material-symbols-outlined text-4xl";
    ghostIcon.textContent = c.icon;
    ghost.appendChild(ghostIcon);
    card.appendChild(ghost);

    /* Label */
    const label = document.createElement("div");
    label.className = "text-[10px] font-mono text-slate-400 mb-1 uppercase tracking-wider";
    label.textContent = c.label;
    card.appendChild(label);

    /* Value */
    const val = document.createElement("div");
    val.className = "metric-label text-2xl text-on-surface";
    val.textContent = c.value;
    card.appendChild(val);

    /* Trend */
    const trend = document.createElement("div");
    trend.className = "text-[10px] font-mono text-primary mt-2";
    trend.textContent = "--";
    card.appendChild(trend);

    grid.appendChild(card);
  });
  return grid;
}

function renderHealthPanel(stats) {
  if (!stats) return null;
  const sys = stats.system ?? {};

  const panel = document.createElement("section");
  panel.className = "glass-panel overflow-hidden";

  /* Header */
  const header = document.createElement("div");
  header.className = "bg-surface-container-highest px-6 py-3 flex justify-between items-center border-b border-white/5";
  const title = document.createElement("h2");
  title.className = "font-headline font-bold text-sm tracking-widest text-slate-200";
  title.textContent = "SYSTEM_HEALTH_MONITOR";
  header.appendChild(title);

  const rtWrap = document.createElement("div");
  rtWrap.className = "flex items-center gap-2";
  const rtDot = document.createElement("div");
  rtDot.className = "w-1.5 h-1.5 rounded-full bg-tertiary pulsing-glow";
  rtWrap.appendChild(rtDot);
  const rtLabel = document.createElement("span");
  rtLabel.className = "text-[9px] font-mono text-slate-400 uppercase tracking-widest";
  rtLabel.textContent = "REALTIME";
  rtWrap.appendChild(rtLabel);
  header.appendChild(rtWrap);
  panel.appendChild(header);

  /* Body */
  const body = document.createElement("div");
  body.className = "p-8 grid grid-cols-1 md:grid-cols-5 gap-8";

  /* Left: meters */
  const metersCol = document.createElement("div");
  metersCol.className = "md:col-span-3 grid grid-cols-2 gap-x-12 gap-y-8";

  function barFillClass(pct) {
    if (pct > 85) return "bg-error";
    if (pct > 60) return "bg-tertiary/40";
    return "bg-cyan-500/40";
  }

  [
    { label: "CPU LOAD",      pct: sys.cpu ?? 0 },
    { label: "MEMORY UTIL",   pct: sys.memory ?? 0 },
    { label: "DISK I/O",      pct: sys.disk ?? 0 },
    { label: "QUEUE BACKLOG", pct: 0 }
  ].forEach(b => {
    const meter = document.createElement("div");
    meter.className = "space-y-2";

    const row = document.createElement("div");
    row.className = "flex justify-between items-end";
    const lbl = document.createElement("span");
    lbl.className = "text-[11px] font-mono text-slate-400";
    lbl.textContent = b.label;
    row.appendChild(lbl);
    const valSpan = document.createElement("span");
    valSpan.className = "text-sm font-mono text-slate-100";
    valSpan.textContent = b.pct + "%";
    row.appendChild(valSpan);
    meter.appendChild(row);

    const track = document.createElement("div");
    track.className = "h-1.5 w-full bg-slate-900 overflow-hidden";
    const fill = document.createElement("div");
    fill.className = "h-full " + barFillClass(b.pct) + " border-r";
    fill.style.width = b.pct + "%";
    track.appendChild(fill);
    meter.appendChild(track);

    metersCol.appendChild(meter);
  });
  body.appendChild(metersCol);

  /* Right: uptime + info */
  const infoCol = document.createElement("div");
  infoCol.className = "md:col-span-2 border-l border-white/5 pl-8 flex flex-col justify-center space-y-4";

  const uptimeLabel = document.createElement("div");
  uptimeLabel.className = "text-[10px] font-mono text-slate-500 mb-1";
  uptimeLabel.textContent = "SYSTEM UPTIME";
  infoCol.appendChild(uptimeLabel);

  const uptimeVal = document.createElement("div");
  uptimeVal.className = "text-2xl font-headline font-light tracking-tight text-on-surface";
  uptimeVal.textContent = stats.uptime ?? "--";
  infoCol.appendChild(uptimeVal);

  const infoBox = document.createElement("div");
  infoBox.className = "p-3 glass-panel border border-white/5 text-[10px] font-mono leading-relaxed";
  const infoPrefix = document.createElement("span");
  infoPrefix.className = "text-primary-dim";
  infoPrefix.textContent = "INFO: ";
  infoBox.appendChild(infoPrefix);
  infoBox.appendChild(document.createTextNode("PostgreSQL: " + (stats.db ?? "unknown") + " / Redis: " + (stats.redis ?? "unknown") + " / Node: " + (stats.nodeVersion ?? "--")));
  infoCol.appendChild(infoBox);

  body.appendChild(infoCol);
  panel.appendChild(body);

  return panel;
}

function renderTimeline(activities) {
  const panel = document.createElement("section");
  panel.className = "glass-panel";

  /* Header */
  const header = document.createElement("div");
  header.className = "bg-surface-container-highest px-6 py-3 flex justify-between items-center";
  const title = document.createElement("h2");
  title.className = "font-headline font-bold text-sm tracking-widest text-slate-200 uppercase";
  title.textContent = "Memory Activity Timeline";
  header.appendChild(title);

  const viewAllBtn = document.createElement("button");
  viewAllBtn.className = "text-[10px] font-mono text-slate-400 hover:text-primary";
  viewAllBtn.textContent = "VIEW ALL LOGS";
  viewAllBtn.addEventListener("click", () => navigate("logs"));
  header.appendChild(viewAllBtn);
  panel.appendChild(header);

  if (!activities || !activities.length) {
    const empty = document.createElement("div");
    empty.className = "text-sm text-slate-600 py-6 text-center";
    empty.textContent = "활동 없음";
    panel.appendChild(empty);
    return panel;
  }

  const list = document.createElement("div");
  list.className = "divide-y divide-white/5";

  const typeColors = { fact: "bg-cyan-400", error: "bg-tertiary", decision: "bg-secondary", procedure: "bg-slate-500", preference: "bg-cyan-400" };
  const badgeColors = { fact: "border-cyan-400/30 text-cyan-400", error: "border-tertiary/30 text-tertiary", decision: "border-secondary/30 text-secondary", procedure: "border-slate-400/30 text-slate-400", preference: "border-cyan-400/30 text-cyan-400" };

  activities.forEach(a => {
    const row = document.createElement("div");
    row.className = "p-4 flex items-center gap-6 hover:bg-white/[0.02] transition-colors group";

    /* Timestamp */
    const ts = document.createElement("div");
    ts.className = "text-[10px] font-mono text-slate-500 w-24";
    ts.textContent = a.created_at ? relativeTime(a.created_at) : "";
    row.appendChild(ts);

    /* Dot */
    const dotEl = document.createElement("div");
    dotEl.className = "w-2 h-2 rounded-full " + (typeColors[a.type] ?? "bg-slate-500");
    row.appendChild(dotEl);

    /* Content */
    const content = document.createElement("div");
    content.className = "flex-1";
    const titleSpan = document.createElement("div");
    titleSpan.className = "text-xs font-bold text-slate-200";
    titleSpan.textContent = a.topic ?? "(무제)";
    content.appendChild(titleSpan);
    const agentSpan = document.createElement("div");
    agentSpan.className = "text-[10px] text-slate-500 font-mono";
    agentSpan.textContent = a.agent_id ?? a.key_name ?? "--";
    content.appendChild(agentSpan);
    row.appendChild(content);

    /* Type badge */
    const badge = document.createElement("span");
    badge.className = "px-2 py-0.5 border text-[9px] font-mono uppercase tracking-widest " + (badgeColors[a.type] ?? "border-slate-400/30 text-slate-400");
    badge.textContent = a.type ?? "?";
    row.appendChild(badge);

    /* Chevron */
    const chevron = document.createElement("span");
    chevron.className = "material-symbols-outlined text-slate-600 opacity-0 group-hover:opacity-100";
    chevron.textContent = "chevron_right";
    row.appendChild(chevron);

    list.appendChild(row);
  });

  panel.appendChild(list);
  return panel;
}

function renderRiskPanel(stats) {
  const panel = document.createElement("section");
  panel.className = "glass-panel";

  /* Header */
  const header = document.createElement("div");
  header.className = "px-5 py-3 border-b border-white/5 flex items-center justify-between";
  const title = document.createElement("span");
  title.className = "text-[10px] font-bold font-headline tracking-widest text-slate-400 uppercase";
  title.textContent = "리스크 및 이상 징후";
  header.appendChild(title);
  const alertDot = document.createElement("div");
  alertDot.className = "w-1.5 h-1.5 rounded-full bg-error pulsing-glow";
  header.appendChild(alertDot);
  panel.appendChild(header);

  /* Body */
  const body = document.createElement("div");
  body.className = "p-4 space-y-3";

  const queues = stats?.queues ?? {};

  /* Error item */
  const errItem = document.createElement("div");
  errItem.className = "flex items-start gap-3 p-3 bg-error-container/10 border border-error/20 rounded-sm";
  const errIcon = document.createElement("span");
  errIcon.className = "material-symbols-outlined text-error text-lg";
  errIcon.dataset.weight = "fill";
  errIcon.textContent = "warning";
  errItem.appendChild(errIcon);
  const errText = document.createElement("div");
  const errTitle = document.createElement("div");
  errTitle.className = "text-[11px] font-bold text-error";
  errTitle.textContent = "Embedding Backlog";
  errText.appendChild(errTitle);
  const errDesc = document.createElement("div");
  errDesc.className = "text-[9px] text-slate-400";
  errDesc.textContent = (queues.embeddingBacklog ?? 0) + " items pending";
  errText.appendChild(errDesc);
  errItem.appendChild(errText);
  body.appendChild(errItem);

  /* Normal items */
  [
    { label: "Quality Pending", value: fmt(queues.qualityPending ?? 0) },
    { label: "Decay Queue",     value: fmt(queues.decayQueue ?? 0) }
  ].forEach(n => {
    const item = document.createElement("div");
    item.className = "flex items-center justify-between p-2.5 bg-surface-container border border-white/5";
    const lbl = document.createElement("span");
    lbl.className = "text-[10px] font-mono text-slate-300";
    lbl.textContent = n.label;
    item.appendChild(lbl);
    const badge = document.createElement("span");
    badge.className = "px-1.5 py-0.5 bg-secondary-container/30 text-[8px] text-secondary-fixed font-bold";
    badge.textContent = n.value;
    item.appendChild(badge);
    body.appendChild(item);
  });

  panel.appendChild(body);
  return panel;
}

function renderQuickActions() {
  const panel = document.createElement("section");
  panel.className = "glass-panel bg-gradient-to-br from-surface-container to-surface-container-high";

  /* Header */
  const header = document.createElement("div");
  header.className = "px-5 py-3 border-b border-white/5";
  const title = document.createElement("span");
  title.className = "text-[10px] font-bold font-headline tracking-widest text-slate-400 uppercase";
  title.textContent = "빠른 작업";
  header.appendChild(title);
  panel.appendChild(header);

  /* Body */
  const body = document.createElement("div");
  body.className = "p-4 grid grid-cols-2 gap-2";

  [
    { icon: "add_link",  label: "Create Key",   view: "keys" },
    { icon: "group_add", label: "Create Group",  view: "groups" },
    { icon: "build",     label: "Run Maint",     view: null },
    { icon: "list_alt",  label: "Open Logs",     view: "logs" }
  ].forEach(a => {
    const btn = document.createElement("button");
    btn.className = "flex flex-col items-center justify-center p-3 bg-white/[0.03] hover:bg-white/[0.08] transition-all border border-white/5 group";

    const icon = document.createElement("span");
    icon.className = "material-symbols-outlined text-slate-400 group-hover:text-primary mb-2";
    icon.textContent = a.icon;
    btn.appendChild(icon);

    const label = document.createElement("span");
    label.className = "text-[10px] font-mono text-slate-300";
    label.textContent = a.label;
    btn.appendChild(label);

    if (a.view) {
      btn.addEventListener("click", () => navigate(a.view));
    }

    body.appendChild(btn);
  });

  panel.appendChild(body);
  return panel;
}

function renderLatencyIndex() {
  const panel = document.createElement("div");
  panel.className = "glass-panel p-4";

  const label = document.createElement("div");
  label.className = "text-[10px] font-mono text-slate-500 mb-3 tracking-widest uppercase";
  label.textContent = "Latency Index (L1/L2/L3)";
  panel.appendChild(label);

  const bars = document.createElement("div");
  bars.className = "flex items-end gap-2 h-16";

  [
    { cls: "bg-primary/20 hover:bg-primary/40 border-t-2 border-primary", h: "20%", tip: "L1" },
    { cls: "bg-secondary/20 hover:bg-secondary/40 border-t-2 border-secondary", h: "45%", tip: "L2" },
    { cls: "bg-tertiary/20 hover:bg-tertiary/40 border-t-2 border-tertiary", h: "85%", tip: "L3" }
  ].forEach(b => {
    const barWrap = document.createElement("div");
    barWrap.className = "flex-1 relative group";
    barWrap.style.height = "100%";
    barWrap.style.display = "flex";
    barWrap.style.alignItems = "flex-end";
    const bar = document.createElement("div");
    bar.className = b.cls;
    bar.style.width = "100%";
    bar.style.height = b.h;
    barWrap.appendChild(bar);
    const tooltip = document.createElement("span");
    tooltip.className = "absolute -top-4 text-[8px] font-mono hidden group-hover:block";
    tooltip.textContent = b.tip;
    barWrap.appendChild(tooltip);
    bars.appendChild(barWrap);
  });

  panel.appendChild(bars);
  return panel;
}

function renderQualityCoverage() {
  const panel = document.createElement("div");
  panel.className = "glass-panel p-4 flex items-center gap-4";

  /* SVG donut */
  const svgWrap = document.createElement("div");
  svgWrap.className = "relative";
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("class", "w-16 h-16");
  svg.setAttribute("viewBox", "0 0 64 64");

  const circleBg = document.createElementNS(svgNS, "circle");
  circleBg.setAttribute("cx", "32");
  circleBg.setAttribute("cy", "32");
  circleBg.setAttribute("r", "28");
  circleBg.setAttribute("fill", "none");
  circleBg.setAttribute("stroke-width", "4");
  circleBg.setAttribute("class", "text-slate-800");
  circleBg.setAttribute("stroke", "currentColor");
  svg.appendChild(circleBg);

  const circleFg = document.createElementNS(svgNS, "circle");
  circleFg.setAttribute("cx", "32");
  circleFg.setAttribute("cy", "32");
  circleFg.setAttribute("r", "28");
  circleFg.setAttribute("fill", "none");
  circleFg.setAttribute("stroke-width", "4");
  circleFg.setAttribute("class", "text-primary");
  circleFg.setAttribute("stroke", "currentColor");
  circleFg.setAttribute("stroke-dasharray", "175.9");
  circleFg.setAttribute("stroke-dashoffset", String(175.9 * 0.25));
  circleFg.setAttribute("transform", "rotate(-90 32 32)");
  svg.appendChild(circleFg);
  svgWrap.appendChild(svg);

  const centerText = document.createElement("div");
  centerText.className = "absolute inset-0 flex items-center justify-center text-[10px] font-bold";
  centerText.textContent = "75%";
  svgWrap.appendChild(centerText);
  panel.appendChild(svgWrap);

  /* Right text */
  const textWrap = document.createElement("div");
  const textLabel = document.createElement("div");
  textLabel.className = "text-[10px] font-mono text-slate-400 uppercase";
  textLabel.textContent = "Quality Coverage";
  textWrap.appendChild(textLabel);
  const textVal = document.createElement("div");
  textVal.className = "text-xs text-slate-200 mt-1 font-bold";
  textVal.textContent = "Optimal Signal";
  textWrap.appendChild(textVal);
  panel.appendChild(textWrap);

  return panel;
}

function renderTopTopics(stats) {
  const panel = document.createElement("div");
  panel.className = "glass-panel p-4";

  const label = document.createElement("div");
  label.className = "text-[10px] font-mono text-slate-500 mb-2 uppercase tracking-widest";
  label.textContent = "TOP TOPICS";
  panel.appendChild(label);

  const list = document.createElement("div");
  list.className = "space-y-2";

  const topics = stats?.topTopics ?? [
    { name: "architecture", pct: "32%" },
    { name: "error-handling", pct: "24%" },
    { name: "deployment", pct: "18%" },
    { name: "security", pct: "14%" },
    { name: "performance", pct: "12%" }
  ];

  topics.forEach(t => {
    const row = document.createElement("div");
    row.className = "flex justify-between items-center text-[10px] font-mono";
    const name = document.createElement("span");
    name.className = "text-slate-300";
    name.textContent = t.name;
    row.appendChild(name);
    const pct = document.createElement("span");
    pct.className = "text-slate-500";
    pct.textContent = t.pct;
    row.appendChild(pct);
    list.appendChild(row);
  });

  panel.appendChild(list);
  return panel;
}

async function renderOverview(container) {
  container.textContent = "";
  container.appendChild(loadingHtml());

  const [statsRes, activityRes] = await Promise.all([
    api("/stats"),
    api("/activity")
  ]);

  if (statsRes.ok) {
    state.stats = statsRes.data;
    state.lastUpdated = Date.now();
    renderCommandBar();
  }

  const activities = activityRes.ok ? activityRes.data : [];

  container.textContent = "";

  /* KPI Grid */
  container.appendChild(renderOverviewCards(state.stats));

  /* Main Layout: flex row */
  const mainLayout = document.createElement("div");
  mainLayout.className = "flex flex-col lg:flex-row gap-8";

  /* LEFT */
  const leftCol = document.createElement("div");
  leftCol.className = "flex-1 space-y-8";

  const hp = renderHealthPanel(state.stats);
  if (hp) leftCol.appendChild(hp);
  leftCol.appendChild(renderTimeline(activities));
  mainLayout.appendChild(leftCol);

  /* RIGHT */
  const rightCol = document.createElement("div");
  rightCol.className = "w-full lg:w-80 space-y-6";
  rightCol.appendChild(renderRiskPanel(state.stats));
  rightCol.appendChild(renderQuickActions());
  rightCol.appendChild(renderLatencyIndex());
  rightCol.appendChild(renderQualityCoverage());
  rightCol.appendChild(renderTopTopics(state.stats));
  mainLayout.appendChild(rightCol);

  container.appendChild(mainLayout);

  /* Backdrop accents */
  if (!document.querySelector(".backdrop-accent-primary")) {
    const bp = document.createElement("div");
    bp.className = "backdrop-accent-primary";
    document.body.appendChild(bp);
    const bs = document.createElement("div");
    bs.className = "backdrop-accent-secondary";
    document.body.appendChild(bs);
  }
}

/* ================================================================
   10. API Keys View (Stitch Screen 2)
   ================================================================ */

function renderKeyKpiRow(keys) {
  const total    = keys.length;
  const active   = keys.filter(k => k.status === "active").length;
  const inactive = total - active;
  const groups   = new Set(keys.flatMap(k => k.groups ?? [])).size;

  const cards = [
    { label: "ACTIVE KEYS",  value: active,   border: "bg-tertiary" },
    { label: "REVOKED KEYS", value: inactive,  border: "bg-error" },
    { label: "TOTAL GROUPS", value: groups,    border: "bg-secondary" },
    { label: "NO GROUP",     value: keys.filter(k => !k.groups?.length).length, border: "bg-primary" }
  ];

  const grid = document.createElement("div");
  grid.className = "grid grid-cols-4 gap-4 mb-8";

  cards.forEach(c => {
    const card = document.createElement("div");
    card.className = "glass-panel p-4 relative overflow-hidden";

    const bar = document.createElement("div");
    bar.className = "absolute left-0 top-0 bottom-0 w-1 " + c.border;
    card.appendChild(bar);

    const label = document.createElement("p");
    label.className = "text-[10px] font-bold text-slate-500 tracking-widest uppercase mb-1 font-label";
    label.textContent = c.label;
    card.appendChild(label);

    const val = document.createElement("p");
    val.className = "text-3xl font-headline font-bold text-on-surface";
    val.textContent = fmt(c.value);
    card.appendChild(val);

    grid.appendChild(card);
  });

  return grid;
}

function renderKeyTable(keys) {
  const wrap = document.createElement("div");
  wrap.className = "glass-panel flex-1 flex flex-col min-h-0";

  const tableWrap = document.createElement("div");
  tableWrap.className = "overflow-x-auto";

  const table = document.createElement("table");
  table.className = "w-full text-left border-collapse";
  table.id = "keys-table";

  const thead = document.createElement("thead");
  thead.className = "bg-white/5 border-b border-white/5";
  const hRow = document.createElement("tr");
  ["Name", "Prefix", "Status", "Groups", "Created Date", "Usage (24h)", ""].forEach(h => {
    const th = document.createElement("th");
    th.className = "px-6 py-4 text-[10px] font-bold text-slate-400 tracking-widest uppercase font-label";
    th.textContent = h;
    hRow.appendChild(th);
  });
  thead.appendChild(hRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  tbody.className = "divide-y divide-white/5";
  keys.forEach(k => {
    const tr = document.createElement("tr");
    tr.className = "hover:bg-white/5 transition-colors group cursor-pointer" + (k.id === state.selectedKeyId ? " bg-white/[0.02]" : "");
    tr.dataset.keyId = k.id;

    /* Name */
    const td1 = document.createElement("td");
    td1.className = "px-6 py-4";
    const nameWrap = document.createElement("div");
    nameWrap.className = "flex items-center gap-3";
    const statusDot = document.createElement("div");
    const isActive = k.status === "active";
    statusDot.className = "w-2 h-2 rounded-full " + (isActive ? "bg-tertiary" : "bg-slate-600");
    nameWrap.appendChild(statusDot);
    const nameSpan = document.createElement("span");
    nameSpan.className = "text-sm font-medium text-on-surface";
    nameSpan.textContent = k.name ?? "";
    nameWrap.appendChild(nameSpan);
    td1.appendChild(nameWrap);
    tr.appendChild(td1);

    /* Prefix */
    const td2 = document.createElement("td");
    td2.className = "px-6 py-4 font-mono text-xs text-primary";
    td2.textContent = k.key_prefix ?? "";
    tr.appendChild(td2);

    /* Status toggle */
    const td3 = document.createElement("td");
    td3.className = "px-6 py-4";
    const toggle = document.createElement("div");
    toggle.className = "w-8 h-4 rounded-full relative p-0.5 " + (isActive ? "bg-tertiary/20" : "bg-slate-800");
    const toggleDot = document.createElement("div");
    toggleDot.className = "absolute top-0.5 bottom-0.5 w-3 rounded-full " + (isActive ? "right-0.5 bg-tertiary" : "left-0.5 bg-slate-600");
    toggle.appendChild(toggleDot);
    td3.appendChild(toggle);
    tr.appendChild(td3);

    /* Groups */
    const td4 = document.createElement("td");
    td4.className = "px-6 py-4";
    const groupWrap = document.createElement("div");
    groupWrap.className = "flex gap-1";
    if (k.groups?.length) {
      k.groups.forEach(g => {
        const chip = document.createElement("span");
        chip.className = "px-2 py-0.5 bg-white/5 rounded-sm text-[10px] text-slate-400 border border-white/10 uppercase font-bold";
        chip.textContent = g;
        groupWrap.appendChild(chip);
      });
    } else {
      const noGroup = document.createElement("span");
      noGroup.className = "text-[10px] text-slate-600 italic";
      noGroup.textContent = "No groups";
      groupWrap.appendChild(noGroup);
    }
    td4.appendChild(groupWrap);
    tr.appendChild(td4);

    /* Created Date */
    const td5 = document.createElement("td");
    td5.className = "px-6 py-4 font-mono text-xs text-slate-500";
    td5.textContent = fmtDate(k.created_at);
    tr.appendChild(td5);

    /* Usage sparkline */
    const td6 = document.createElement("td");
    td6.className = "px-6 py-4";
    const usageWrap = document.createElement("div");
    usageWrap.className = "flex items-end gap-0.5 h-6";
    const usage = k.today_calls ?? 0;
    const heights = [2, 4, 3, 5, 6];
    heights.forEach((h, i) => {
      const bar = document.createElement("div");
      bar.className = "w-1 bg-primary/" + (20 + i * 20);
      bar.style.height = (usage > 0 ? h : 1) + "px";
      usageWrap.appendChild(bar);
    });
    const usageCount = document.createElement("span");
    usageCount.className = "ml-2 text-xs font-mono text-primary font-bold";
    usageCount.textContent = fmt(usage);
    usageWrap.appendChild(usageCount);
    td6.appendChild(usageWrap);
    tr.appendChild(td6);

    /* Actions: more_vert */
    const td7 = document.createElement("td");
    td7.className = "px-6 py-4";
    const moreBtn = document.createElement("button");
    moreBtn.className = "text-slate-500 hover:text-slate-300";
    const moreIcon = document.createElement("span");
    moreIcon.className = "material-symbols-outlined";
    moreIcon.textContent = "more_vert";
    moreBtn.appendChild(moreIcon);
    td7.appendChild(moreBtn);
    tr.appendChild(td7);

    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  tableWrap.appendChild(table);
  wrap.appendChild(tableWrap);

  /* Footer */
  const footer = document.createElement("div");
  footer.className = "mt-auto p-4 border-t border-white/5 flex justify-between items-center bg-white/[0.01]";
  const countText = document.createElement("span");
  countText.className = "text-xs text-slate-500";
  countText.textContent = "Showing " + keys.length + " entries";
  footer.appendChild(countText);
  wrap.appendChild(footer);

  return wrap;
}

function renderKeyInspector(key) {
  const panel = document.createElement("aside");
  panel.className = "w-96 bg-surface-container-high border-l border-white/5 flex flex-col p-6 gap-6 relative overflow-y-auto";
  panel.id = "key-inspector";

  if (!key) {
    const empty = document.createElement("div");
    empty.className = "flex flex-col items-center justify-center h-full text-slate-600";
    const icon = document.createElement("span");
    icon.className = "material-symbols-outlined text-4xl mb-4";
    icon.textContent = "vpn_key";
    empty.appendChild(icon);
    const txt = document.createElement("div");
    txt.className = "text-xs uppercase tracking-widest";
    txt.textContent = "SELECT A KEY TO INSPECT";
    empty.appendChild(txt);
    panel.appendChild(empty);
    return panel;
  }

  /* Inspector Header */
  const headerDiv = document.createElement("div");
  headerDiv.className = "flex items-center justify-between";
  const headerLabel = document.createElement("h3");
  headerLabel.className = "text-xs font-bold text-slate-400 tracking-widest uppercase font-label flex items-center gap-2";
  const infoIcon = document.createElement("span");
  infoIcon.className = "material-symbols-outlined text-primary text-lg";
  infoIcon.textContent = "info";
  headerLabel.appendChild(infoIcon);
  headerLabel.appendChild(document.createTextNode("KEY INSPECTOR"));
  headerDiv.appendChild(headerLabel);

  const closeBtn = document.createElement("button");
  closeBtn.className = "text-slate-500 hover:text-slate-300";
  closeBtn.addEventListener("click", () => { state.selectedKeyId = null; });
  const closeIcon = document.createElement("span");
  closeIcon.className = "material-symbols-outlined";
  closeIcon.textContent = "close";
  closeBtn.appendChild(closeIcon);
  headerDiv.appendChild(closeBtn);
  panel.appendChild(headerDiv);

  /* Key Identity Card */
  const idCard = document.createElement("div");
  idCard.className = "bg-surface-container-highest p-4 rounded-sm border-l-2 border-primary";

  const idName = document.createElement("h4");
  idName.className = "text-on-surface font-bold text-lg";
  idName.textContent = key.name ?? "";
  idCard.appendChild(idName);

  const idPrefix = document.createElement("p");
  idPrefix.className = "text-xs font-mono text-primary mt-1";
  idPrefix.textContent = key.key_prefix ?? "";
  idCard.appendChild(idPrefix);

  const isActive = key.status === "active";

  const statusBadge = document.createElement("div");
  statusBadge.className = "inline-block mt-2 px-2 py-1 text-[10px] font-bold border " + (isActive ? "bg-tertiary/10 text-tertiary border-tertiary/20" : "bg-slate-800 text-slate-500 border-slate-700");
  statusBadge.textContent = (key.status ?? "").toUpperCase();
  idCard.appendChild(statusBadge);

  /* Stats */
  const statsDiv = document.createElement("div");
  statsDiv.className = "mt-4 space-y-2";
  [
    { label: "Total Usage",  value: fmt(key.today_calls ?? 0) + " req" },
    { label: "Last Active",  value: fmtDate(key.created_at) }
  ].forEach(f => {
    const row = document.createElement("div");
    row.className = "flex justify-between items-center";
    const lbl = document.createElement("span");
    lbl.className = "text-xs text-slate-400";
    lbl.textContent = f.label;
    row.appendChild(lbl);
    const val = document.createElement("span");
    val.className = "text-xs font-mono text-on-surface";
    val.textContent = f.value;
    row.appendChild(val);
    statsDiv.appendChild(row);
  });
  idCard.appendChild(statsDiv);
  panel.appendChild(idCard);

  /* Assigned Groups */
  const groupsSection = document.createElement("div");
  const groupsLabel = document.createElement("div");
  groupsLabel.className = "text-[10px] font-bold text-slate-400 tracking-widest uppercase mb-2 font-label";
  groupsLabel.textContent = "ASSIGNED GROUPS";
  groupsSection.appendChild(groupsLabel);

  const groupChips = document.createElement("div");
  groupChips.className = "flex flex-wrap gap-2 mb-2";
  if (key.groups?.length) {
    key.groups.forEach(g => {
      const chip = document.createElement("span");
      chip.className = "px-2 py-0.5 bg-white/5 rounded-sm text-[10px] text-slate-400 border border-white/10 uppercase font-bold flex items-center gap-1";
      chip.textContent = g;
      const rmIcon = document.createElement("span");
      rmIcon.className = "material-symbols-outlined text-[12px] text-slate-500 cursor-pointer hover:text-error";
      rmIcon.textContent = "close";
      chip.appendChild(rmIcon);
      groupChips.appendChild(chip);
    });
  }

  const addGroupBtn = document.createElement("button");
  addGroupBtn.className = "px-2 py-0.5 border border-dashed border-white/10 text-[10px] text-slate-500 uppercase";
  addGroupBtn.textContent = "ADD GROUP";
  groupChips.appendChild(addGroupBtn);
  groupsSection.appendChild(groupChips);
  panel.appendChild(groupsSection);

  /* Groups Directory */
  const dirSection = document.createElement("div");
  dirSection.className = "mt-auto border-t border-white/5 pt-6";
  const dirLabel = document.createElement("div");
  dirLabel.className = "text-[10px] font-bold text-slate-400 tracking-widest uppercase mb-2 font-label";
  dirLabel.textContent = "GROUPS DIRECTORY";
  dirSection.appendChild(dirLabel);

  const dirList = document.createElement("div");
  dirList.className = "space-y-1";
  state.groups.forEach(g => {
    const row = document.createElement("div");
    row.className = "flex items-center justify-between p-2 hover:bg-white/5 transition-colors";
    const name = document.createElement("span");
    name.className = "text-xs text-slate-300";
    name.textContent = g.name;
    row.appendChild(name);
    const assignBtn = document.createElement("button");
    assignBtn.className = "text-[9px] text-primary font-bold uppercase";
    assignBtn.textContent = "ASSIGN";
    row.appendChild(assignBtn);
    dirList.appendChild(row);
  });
  dirSection.appendChild(dirList);
  panel.appendChild(dirSection);

  /* Danger Zone */
  const danger = document.createElement("div");
  danger.className = "pt-6 border-t border-white/5";
  const dangerLabel = document.createElement("p");
  dangerLabel.className = "text-[10px] font-bold text-error tracking-widest uppercase mb-3 font-label";
  dangerLabel.textContent = "DANGER ZONE";
  danger.appendChild(dangerLabel);

  const dangerGrid = document.createElement("div");
  dangerGrid.className = "space-y-2";

  const toggleStatus = isActive ? "inactive" : "active";
  const toggleBtn = document.createElement("button");
  toggleBtn.className = "w-full py-2 border border-error/30 text-error text-[10px] font-bold hover:bg-error/10 transition-all uppercase";
  toggleBtn.textContent = isActive ? "REVOKE KEY" : "ACTIVATE KEY";
  toggleBtn.dataset.keyAction = "toggle";
  toggleBtn.dataset.keyId     = key.id;
  toggleBtn.dataset.status    = toggleStatus;
  dangerGrid.appendChild(toggleBtn);

  const delBtn = document.createElement("button");
  delBtn.className = "w-full py-2 bg-error text-on-error text-[10px] font-bold hover:brightness-110 transition-all uppercase";
  delBtn.textContent = "DELETE PERMANENTLY";
  delBtn.dataset.keyAction = "delete";
  delBtn.dataset.keyId     = key.id;
  dangerGrid.appendChild(delBtn);

  danger.appendChild(dangerGrid);
  panel.appendChild(danger);

  return panel;
}

async function renderKeys(container) {
  container.textContent = "";
  container.appendChild(loadingHtml());

  const res = await api("/keys");
  if (res.ok) state.keys = res.data ?? [];

  const selectedKey = state.keys.find(k => k.id === state.selectedKeyId) ?? null;

  container.textContent = "";

  /* Header */
  const header = document.createElement("div");
  header.className = "flex justify-between items-end mb-8";
  const headerLeft = document.createElement("div");
  const h2 = document.createElement("h2");
  h2.className = "text-2xl font-headline font-bold text-on-surface tracking-tight";
  h2.textContent = "API Key Management";
  headerLeft.appendChild(h2);
  const subtitle = document.createElement("p");
  subtitle.className = "text-sm text-slate-400 mt-1";
  subtitle.textContent = "Operational key cycles and group access control.";
  headerLeft.appendChild(subtitle);
  header.appendChild(headerLeft);

  const createBtn = document.createElement("button");
  createBtn.className = "btn-primary px-5 py-2.5 bg-primary-container text-on-primary-fixed font-bold text-sm flex items-center gap-2";
  createBtn.id = "create-key-btn";
  const addIcon = document.createElement("span");
  addIcon.className = "material-symbols-outlined text-lg";
  addIcon.textContent = "add";
  createBtn.appendChild(addIcon);
  createBtn.appendChild(document.createTextNode("CREATE API KEY"));
  header.appendChild(createBtn);
  container.appendChild(header);

  /* KPI Row */
  container.appendChild(renderKeyKpiRow(state.keys));

  /* Split layout */
  const split = document.createElement("div");
  split.className = "flex gap-0";
  split.style.minHeight = "400px";

  split.appendChild(renderKeyTable(state.keys));
  split.appendChild(renderKeyInspector(selectedKey));
  container.appendChild(split);

  /* Event: table row click */
  container.querySelectorAll("#keys-table tbody tr").forEach(tr => {
    tr.addEventListener("click", () => {
      state.selectedKeyId = tr.dataset.keyId;
      renderKeys(container);
    });
  });

  /* Event: create key */
  createBtn.addEventListener("click", () => {
    const form = document.createElement("div");

    const g1 = document.createElement("div");
    g1.className = "form-group";
    const l1 = document.createElement("label");
    l1.className = "form-label";
    l1.textContent = "KEY NAME / IDENTIFIER";
    g1.appendChild(l1);
    const nameInput = document.createElement("input");
    nameInput.className = "form-input";
    nameInput.id = "modal-key-name";
    nameInput.placeholder = "e.g. analytical-hub-prod";
    g1.appendChild(nameInput);
    form.appendChild(g1);

    const g2 = document.createElement("div");
    g2.className = "form-group";
    const l2 = document.createElement("label");
    l2.className = "form-label";
    l2.textContent = "DAILY RATE LIMIT";
    g2.appendChild(l2);
    const limitInput = document.createElement("input");
    limitInput.className = "form-input";
    limitInput.id = "modal-key-limit";
    limitInput.type = "number";
    limitInput.value = "10000";
    g2.appendChild(limitInput);
    form.appendChild(g2);

    showModal("Generate New API Credential", form, [
      { id: "create", label: "GENERATE AND VIEW SECRET", cls: "btn-primary", handler: async () => {
        const name        = document.getElementById("modal-key-name")?.value.trim();
        const daily_limit = parseInt(document.getElementById("modal-key-limit")?.value) || 10000;
        if (!name) { showToast("Name required", "warning"); return; }
        const res = await api("/keys", { method: "POST", body: { name, daily_limit } });
        closeModal();
        if (res.ok && res.data?.raw_key) {
          const keyDisplay = document.createElement("div");
          const note = document.createElement("p");
          note.className = "text-xs text-primary leading-relaxed mb-4";
          note.textContent = "This secret key will only be displayed once. Store it in a secure vault.";
          keyDisplay.appendChild(note);

          const copyWrap = document.createElement("div");
          copyWrap.className = "copy-wrap";
          const copyVal = document.createElement("span");
          copyVal.className = "copy-value";
          copyVal.textContent = res.data.raw_key;
          copyWrap.appendChild(copyVal);
          const copyBtn = document.createElement("button");
          copyBtn.className = "copy-btn";
          copyBtn.textContent = "COPY";
          copyBtn.addEventListener("click", () => {
            navigator.clipboard.writeText(res.data.raw_key).then(() => showToast("Copied", "success"));
          });
          copyWrap.appendChild(copyBtn);
          keyDisplay.appendChild(copyWrap);

          showModal("Credential Generated", keyDisplay, [
            { id: "done", label: "DONE", cls: "btn-primary", handler: () => { closeModal(); renderKeys(container); } }
          ]);
        } else {
          showToast(res.data?.error ?? "Generation failed", "error");
          renderKeys(container);
        }
      }}
    ]);
  });

  /* Event: inspector actions */
  container.querySelectorAll("[data-key-action]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const action = btn.dataset.keyAction;
      const keyId  = btn.dataset.keyId;

      if (action === "toggle") {
        const newStatus = btn.dataset.status;
        const msg = document.createElement("span");
        msg.className = "text-sm text-slate-300";
        msg.textContent = "Change this key to " + newStatus + " status?";
        showModal("Confirm Status Change", msg, [
          { id: "confirm", label: "CONFIRM", cls: "btn-primary", handler: async () => {
            await api("/keys/" + keyId, { method: "PUT", body: { status: newStatus } });
            closeModal();
            showToast("Status updated", "success");
            renderKeys(container);
          }}
        ]);
      }

      if (action === "delete") {
        const msg = document.createElement("span");
        msg.className = "text-sm text-error";
        msg.textContent = "This action is irreversible. Delete permanently?";
        showModal("Confirm Permanent Deletion", msg, [
          { id: "confirm", label: "DELETE", cls: "btn-danger", handler: async () => {
            await api("/keys/" + keyId, { method: "DELETE" });
            closeModal();
            state.selectedKeyId = null;
            showToast("Key deleted", "success");
            renderKeys(container);
          }}
        ]);
      }
    });
  });
}

/* ================================================================
   11. Groups View (Stitch-aligned: table + inspector style)
   ================================================================ */

function renderGroupKpiRow(groups, keys) {
  const totalGroups = groups.length;
  const totalMembers = groups.reduce((sum, g) => sum + (g.member_count ?? 0), 0);
  const emptyGroups = groups.filter(g => (g.member_count ?? 0) === 0).length;
  const noGroupKeys = keys.filter(k => !k.groups?.length).length;

  const cards = [
    { label: "TOTAL GROUPS",   value: totalGroups,  border: "bg-secondary" },
    { label: "TOTAL MEMBERS",  value: totalMembers, border: "bg-tertiary" },
    { label: "EMPTY GROUPS",   value: emptyGroups,  border: "bg-error" },
    { label: "UNASSIGNED KEYS", value: noGroupKeys,  border: "bg-primary" }
  ];

  const grid = document.createElement("div");
  grid.className = "grid grid-cols-4 gap-4 mb-8";

  cards.forEach(c => {
    const card = document.createElement("div");
    card.className = "glass-panel p-4 relative overflow-hidden";

    const bar = document.createElement("div");
    bar.className = "absolute left-0 top-0 bottom-0 w-1 " + c.border;
    card.appendChild(bar);

    const label = document.createElement("p");
    label.className = "text-[10px] font-bold text-slate-500 tracking-widest uppercase mb-1 font-label";
    label.textContent = c.label;
    card.appendChild(label);

    const val = document.createElement("p");
    val.className = "text-3xl font-headline font-bold text-on-surface";
    val.textContent = fmt(c.value);
    card.appendChild(val);

    grid.appendChild(card);
  });

  return grid;
}

function renderGroupTable(groups) {
  const wrap = document.createElement("div");
  wrap.className = "glass-panel flex-1 flex flex-col min-h-0";

  const table = document.createElement("table");
  table.className = "w-full text-left border-collapse";
  table.id = "groups-table";

  const thead = document.createElement("thead");
  thead.className = "bg-white/5 border-b border-white/5";
  const hRow = document.createElement("tr");
  ["Name", "Description", "Members", "Created", ""].forEach(h => {
    const th = document.createElement("th");
    th.className = "px-6 py-4 text-[10px] font-bold text-slate-400 tracking-widest uppercase font-label";
    th.textContent = h;
    hRow.appendChild(th);
  });
  thead.appendChild(hRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  tbody.className = "divide-y divide-white/5";

  groups.forEach(g => {
    const tr = document.createElement("tr");
    tr.className = "hover:bg-white/5 transition-colors group cursor-pointer" + (g.id === state.selectedGroupId ? " bg-white/[0.02]" : "");
    tr.dataset.groupId = g.id;

    /* Name */
    const td1 = document.createElement("td");
    td1.className = "px-6 py-4";
    const nameWrap = document.createElement("div");
    nameWrap.className = "flex items-center gap-3";
    const icon = document.createElement("span");
    icon.className = "material-symbols-outlined text-lg text-secondary";
    icon.textContent = "shield";
    nameWrap.appendChild(icon);
    const name = document.createElement("span");
    name.className = "text-sm font-medium text-on-surface";
    name.textContent = g.name;
    nameWrap.appendChild(name);
    td1.appendChild(nameWrap);
    tr.appendChild(td1);

    /* Description */
    const td2 = document.createElement("td");
    td2.className = "px-6 py-4 text-xs text-slate-400";
    td2.textContent = g.description ?? "--";
    tr.appendChild(td2);

    /* Members */
    const td3 = document.createElement("td");
    td3.className = "px-6 py-4 text-xs font-mono text-on-surface";
    td3.textContent = fmt(g.member_count ?? 0);
    tr.appendChild(td3);

    /* Created */
    const td4 = document.createElement("td");
    td4.className = "px-6 py-4 font-mono text-xs text-slate-500";
    td4.textContent = fmtDate(g.created_at);
    tr.appendChild(td4);

    /* Actions */
    const td5 = document.createElement("td");
    td5.className = "px-6 py-4";
    const moreBtn = document.createElement("button");
    moreBtn.className = "text-slate-500 hover:text-slate-300";
    const moreIcon = document.createElement("span");
    moreIcon.className = "material-symbols-outlined";
    moreIcon.textContent = "more_vert";
    moreBtn.appendChild(moreIcon);
    td5.appendChild(moreBtn);
    tr.appendChild(td5);

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  wrap.appendChild(table);

  /* Footer */
  const footer = document.createElement("div");
  footer.className = "mt-auto p-4 border-t border-white/5 flex justify-between items-center bg-white/[0.01]";
  const countText = document.createElement("span");
  countText.className = "text-xs text-slate-500";
  countText.textContent = "Showing " + groups.length + " groups";
  footer.appendChild(countText);
  wrap.appendChild(footer);

  return wrap;
}

function renderGroupInspector(selected, members) {
  const panel = document.createElement("aside");
  panel.className = "w-96 bg-surface-container-high border-l border-white/5 flex flex-col p-6 gap-6 relative overflow-y-auto";
  panel.id = "group-inspector";

  if (!selected) {
    const empty = document.createElement("div");
    empty.className = "flex flex-col items-center justify-center h-full text-slate-600";
    const icon = document.createElement("span");
    icon.className = "material-symbols-outlined text-4xl mb-4";
    icon.textContent = "group";
    empty.appendChild(icon);
    const txt = document.createElement("div");
    txt.className = "text-xs uppercase tracking-widest";
    txt.textContent = "SELECT A GROUP TO INSPECT";
    empty.appendChild(txt);
    panel.appendChild(empty);
    return panel;
  }

  /* Header */
  const headerDiv = document.createElement("div");
  headerDiv.className = "flex items-center justify-between";
  const headerLabel = document.createElement("h3");
  headerLabel.className = "text-xs font-bold text-slate-400 tracking-widest uppercase font-label flex items-center gap-2";
  const infoIcon = document.createElement("span");
  infoIcon.className = "material-symbols-outlined text-secondary text-lg";
  infoIcon.textContent = "info";
  headerLabel.appendChild(infoIcon);
  headerLabel.appendChild(document.createTextNode("GROUP INSPECTOR"));
  headerDiv.appendChild(headerLabel);

  const closeBtn = document.createElement("button");
  closeBtn.className = "text-slate-500 hover:text-slate-300";
  closeBtn.dataset.groupAction = "close";
  const closeIcon = document.createElement("span");
  closeIcon.className = "material-symbols-outlined";
  closeIcon.textContent = "close";
  closeBtn.appendChild(closeIcon);
  headerDiv.appendChild(closeBtn);
  panel.appendChild(headerDiv);

  /* Group Identity */
  const idCard = document.createElement("div");
  idCard.className = "bg-surface-container-highest p-4 rounded-sm border-l-2 border-secondary";
  const gName = document.createElement("h4");
  gName.className = "text-on-surface font-bold text-lg";
  gName.textContent = selected.name;
  idCard.appendChild(gName);
  if (selected.description) {
    const gDesc = document.createElement("p");
    gDesc.className = "text-xs text-slate-400 mt-1";
    gDesc.textContent = selected.description;
    idCard.appendChild(gDesc);
  }
  const memberCount = document.createElement("div");
  memberCount.className = "mt-2 text-[10px] font-mono text-slate-500 uppercase";
  memberCount.textContent = fmt(selected.member_count ?? 0) + " Members";
  idCard.appendChild(memberCount);
  panel.appendChild(idCard);

  /* Member List */
  const membersLabel = document.createElement("div");
  membersLabel.className = "text-[10px] font-bold text-slate-400 tracking-widest uppercase mb-2 font-label";
  membersLabel.textContent = "MEMBERS";
  panel.appendChild(membersLabel);

  const memberList = document.createElement("div");
  memberList.className = "space-y-1";
  if (members && members.length) {
    members.forEach(m => {
      const row = document.createElement("div");
      row.className = "flex items-center justify-between p-2 bg-surface-container border border-white/5";
      const left = document.createElement("div");
      const mName = document.createElement("div");
      mName.className = "text-xs text-slate-200";
      mName.textContent = m.name ?? "";
      left.appendChild(mName);
      const mPrefix = document.createElement("div");
      mPrefix.className = "text-[10px] font-mono text-primary";
      mPrefix.textContent = m.key_prefix ?? "";
      left.appendChild(mPrefix);
      row.appendChild(left);
      const rmBtn = document.createElement("button");
      rmBtn.className = "text-[9px] text-error font-bold uppercase";
      rmBtn.textContent = "REMOVE";
      rmBtn.dataset.removeMember = m.id;
      row.appendChild(rmBtn);
      memberList.appendChild(row);
    });
  } else {
    const empty = document.createElement("div");
    empty.className = "text-[10px] text-slate-600 text-center py-4";
    empty.textContent = "No members";
    memberList.appendChild(empty);
  }
  panel.appendChild(memberList);

  /* Add member button */
  const addMemberBtn = document.createElement("button");
  addMemberBtn.className = "w-full py-2 border border-dashed border-white/10 text-[10px] text-slate-400 uppercase hover:border-secondary/30 hover:text-secondary transition-all";
  addMemberBtn.id = "add-member-btn";
  addMemberBtn.textContent = "ADD MEMBER";
  panel.appendChild(addMemberBtn);

  /* Danger Zone */
  const danger = document.createElement("div");
  danger.className = "pt-6 border-t border-white/5 mt-auto";
  const delBtn = document.createElement("button");
  delBtn.className = "w-full py-2 bg-error text-on-error text-[10px] font-bold hover:brightness-110 transition-all uppercase";
  delBtn.id = "delete-group-btn";
  delBtn.textContent = "DELETE GROUP";
  danger.appendChild(delBtn);
  panel.appendChild(danger);

  return panel;
}

async function renderGroups(container) {
  container.textContent = "";
  container.appendChild(loadingHtml());

  const [gRes, kRes] = await Promise.all([
    api("/groups"),
    api("/keys")
  ]);
  if (gRes.ok) state.groups = gRes.data ?? [];
  if (kRes.ok) state.keys   = kRes.data ?? [];

  const selected = state.groups.find(g => g.id === state.selectedGroupId) ?? null;
  let members = [];
  if (selected) {
    const mRes = await api("/groups/" + selected.id + "/members");
    if (mRes.ok) members = mRes.data ?? [];
  }

  container.textContent = "";

  /* Header */
  const header = document.createElement("div");
  header.className = "flex justify-between items-end mb-8";
  const headerLeft = document.createElement("div");
  const h2 = document.createElement("h2");
  h2.className = "text-2xl font-headline font-bold text-on-surface tracking-tight";
  h2.textContent = "Group Management";
  headerLeft.appendChild(h2);
  const subtitle = document.createElement("p");
  subtitle.className = "text-sm text-slate-400 mt-1";
  subtitle.textContent = "Organize API keys into logical access groups.";
  headerLeft.appendChild(subtitle);
  header.appendChild(headerLeft);

  const createBtn = document.createElement("button");
  createBtn.className = "btn-primary px-5 py-2.5 bg-primary-container text-on-primary-fixed font-bold text-sm flex items-center gap-2";
  const addIcon = document.createElement("span");
  addIcon.className = "material-symbols-outlined text-lg";
  addIcon.textContent = "add";
  createBtn.appendChild(addIcon);
  createBtn.appendChild(document.createTextNode("CREATE GROUP"));
  header.appendChild(createBtn);
  container.appendChild(header);

  /* KPI Row */
  container.appendChild(renderGroupKpiRow(state.groups, state.keys));

  /* Split layout */
  const split = document.createElement("div");
  split.className = "flex gap-0";
  split.style.minHeight = "400px";

  split.appendChild(renderGroupTable(state.groups));
  split.appendChild(renderGroupInspector(selected, members));
  container.appendChild(split);

  /* Event: table row click */
  container.querySelectorAll("#groups-table tbody tr").forEach(tr => {
    tr.addEventListener("click", () => {
      state.selectedGroupId = tr.dataset.groupId;
      renderGroups(container);
    });
  });

  /* Event: close inspector */
  container.querySelector("[data-group-action='close']")?.addEventListener("click", () => {
    state.selectedGroupId = null;
    renderGroups(container);
  });

  /* Event: add member */
  document.getElementById("add-member-btn")?.addEventListener("click", () => {
    const form = document.createElement("div");
    const g1 = document.createElement("div");
    g1.className = "form-group";
    const l1 = document.createElement("label");
    l1.className = "form-label";
    l1.textContent = "SELECT API KEY";
    g1.appendChild(l1);
    const sel = document.createElement("select");
    sel.className = "form-select";
    sel.id = "modal-member-key";
    state.keys.forEach(k => {
      const opt = document.createElement("option");
      opt.value = k.id;
      opt.textContent = k.name + " (" + (k.key_prefix ?? "") + ")";
      sel.appendChild(opt);
    });
    g1.appendChild(sel);
    form.appendChild(g1);

    showModal("Add Member", form, [
      { id: "add", label: "ADD", cls: "btn-primary", handler: async () => {
        const keyId = document.getElementById("modal-member-key")?.value;
        if (!keyId) return;
        await api("/groups/" + state.selectedGroupId + "/members", { method: "POST", body: { key_id: keyId } });
        closeModal();
        showToast("Member added", "success");
        renderGroups(container);
      }}
    ]);
  });

  /* Event: remove member */
  container.querySelectorAll("[data-remove-member]").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const keyId = btn.dataset.removeMember;
      await api("/groups/" + state.selectedGroupId + "/members/" + keyId, { method: "DELETE" });
      showToast("Member removed", "success");
      renderGroups(container);
    });
  });

  /* Event: delete group */
  document.getElementById("delete-group-btn")?.addEventListener("click", () => {
    const msg = document.createElement("span");
    msg.className = "text-sm text-error";
    msg.textContent = "This action is irreversible. Delete this group?";
    showModal("Confirm Group Deletion", msg, [
      { id: "confirm", label: "DELETE", cls: "btn-danger", handler: async () => {
        await api("/groups/" + state.selectedGroupId, { method: "DELETE" });
        closeModal();
        state.selectedGroupId = null;
        showToast("Group deleted", "success");
        renderGroups(container);
      }}
    ]);
  });

  /* Event: create group */
  createBtn.addEventListener("click", () => {
    const form = document.createElement("div");

    const g1 = document.createElement("div");
    g1.className = "form-group";
    const l1 = document.createElement("label");
    l1.className = "form-label";
    l1.textContent = "GROUP NAME";
    g1.appendChild(l1);
    const nameInput = document.createElement("input");
    nameInput.className = "form-input";
    nameInput.id = "modal-group-name";
    nameInput.placeholder = "e.g. CORE_OPERATIONS";
    g1.appendChild(nameInput);
    form.appendChild(g1);

    const g2 = document.createElement("div");
    g2.className = "form-group";
    const l2 = document.createElement("label");
    l2.className = "form-label";
    l2.textContent = "DESCRIPTION";
    g2.appendChild(l2);
    const descInput = document.createElement("input");
    descInput.className = "form-input";
    descInput.id = "modal-group-desc";
    descInput.placeholder = "(optional)";
    g2.appendChild(descInput);
    form.appendChild(g2);

    showModal("Create New Group", form, [
      { id: "create", label: "CREATE", cls: "btn-primary", handler: async () => {
        const name = document.getElementById("modal-group-name")?.value.trim();
        const description = document.getElementById("modal-group-desc")?.value.trim() || null;
        if (!name) { showToast("Name required", "warning"); return; }
        const res = await api("/groups", { method: "POST", body: { name, description } });
        closeModal();
        if (res.ok) { showToast("Group created", "success"); renderGroups(container); }
        else showToast(res.data?.error ?? "Creation failed", "error");
      }}
    ]);
  });
}

/* ================================================================
   12. Memory Operations View (Stitch Screen 3)
   ================================================================ */

function renderMemoryFilters() {
  const types = ["", "fact", "error", "decision", "procedure", "preference"];

  const bar = document.createElement("div");
  bar.className = "flex items-center justify-between gap-4 glass-panel p-2 rounded-sm border-l-2 border-primary/40";
  bar.id = "memory-filters";

  /* Left chips */
  const leftChips = document.createElement("div");
  leftChips.className = "flex gap-2";

  /* Topic chip */
  const topicChip = document.createElement("div");
  topicChip.className = "px-3 py-1 bg-surface-variant text-[10px] font-bold flex items-center gap-2 rounded-sm text-primary border border-primary/10";
  const topicInput = document.createElement("input");
  topicInput.className = "bg-transparent border-none outline-none text-[10px] font-bold text-primary placeholder:text-slate-500 w-24";
  topicInput.id = "filter-topic";
  topicInput.placeholder = "TOPIC: ALL";
  topicInput.value = state.memoryFilter.topic;
  topicChip.appendChild(topicInput);
  const topicExpand = document.createElement("span");
  topicExpand.className = "material-symbols-outlined text-[14px]";
  topicExpand.textContent = "expand_more";
  topicChip.appendChild(topicExpand);
  leftChips.appendChild(topicChip);

  /* Type chip */
  const typeChip = document.createElement("div");
  typeChip.className = "px-3 py-1 bg-surface-variant text-[10px] font-bold flex items-center gap-2 rounded-sm text-slate-400";
  const typeSelect = document.createElement("select");
  typeSelect.className = "bg-transparent border-none outline-none text-[10px] font-bold text-slate-400";
  typeSelect.id = "filter-type";
  types.forEach(t => {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t ? "TYPE: " + t.toUpperCase() : "TYPE: ALL";
    if (state.memoryFilter.type === t) opt.selected = true;
    typeSelect.appendChild(opt);
  });
  typeChip.appendChild(typeSelect);
  const typeExpand = document.createElement("span");
  typeExpand.className = "material-symbols-outlined text-[14px]";
  typeExpand.textContent = "expand_more";
  typeChip.appendChild(typeExpand);
  leftChips.appendChild(typeChip);

  /* Key chip */
  const keyChip = document.createElement("div");
  keyChip.className = "px-3 py-1 bg-surface-variant text-[10px] font-bold flex items-center gap-2 rounded-sm text-slate-400";
  const keyInput = document.createElement("input");
  keyInput.className = "bg-transparent border-none outline-none text-[10px] font-bold text-slate-400 placeholder:text-slate-500 w-16";
  keyInput.id = "filter-key-id";
  keyInput.placeholder = "KEY: *";
  keyInput.value = state.memoryFilter.key_id;
  keyChip.appendChild(keyInput);
  const keyExpand = document.createElement("span");
  keyExpand.className = "material-symbols-outlined text-[14px]";
  keyExpand.textContent = "expand_more";
  keyChip.appendChild(keyExpand);
  leftChips.appendChild(keyChip);

  bar.appendChild(leftChips);

  /* Right side */
  const rightSide = document.createElement("div");
  rightSide.className = "flex items-center gap-4";

  const rangeText = document.createElement("span");
  rangeText.className = "text-[10px] text-slate-500 font-mono tracking-tighter uppercase";
  rangeText.textContent = "RANGE: LAST 30 DAYS";
  rightSide.appendChild(rangeText);

  const exportBtn = document.createElement("button");
  exportBtn.className = "flex items-center gap-2 bg-transparent border border-outline-variant px-4 py-1.5 text-[10px] font-bold text-primary";
  exportBtn.id = "filter-search";
  const searchIcon = document.createElement("span");
  searchIcon.className = "material-symbols-outlined text-[14px]";
  searchIcon.textContent = "search";
  exportBtn.appendChild(searchIcon);
  exportBtn.appendChild(document.createTextNode("SEARCH"));
  rightSide.appendChild(exportBtn);

  bar.appendChild(rightSide);

  return bar;
}

function renderFragmentList(fragments) {
  if (!fragments || !fragments.length) {
    const empty = document.createElement("div");
    empty.className = "text-sm text-slate-600 py-8 text-center";
    empty.textContent = "결과 없음";
    return empty;
  }

  const panel = document.createElement("section");
  panel.className = "glass-panel rounded-sm p-6 shadow-2xl relative overflow-hidden";

  /* Ghost icon */
  const ghost = document.createElement("div");
  ghost.className = "absolute top-0 right-0 p-2 opacity-10";
  const ghostIcon = document.createElement("span");
  ghostIcon.className = "material-symbols-outlined text-6xl";
  ghostIcon.textContent = "search_insights";
  ghost.appendChild(ghostIcon);
  panel.appendChild(ghost);

  /* Title */
  const title = document.createElement("h2");
  title.className = "font-headline text-lg font-bold text-cyan-100 flex items-center gap-3 mb-6 uppercase tracking-widest";
  const titleBar = document.createElement("span");
  titleBar.className = "w-1 h-4 bg-cyan-400";
  title.appendChild(titleBar);
  title.appendChild(document.createTextNode("Search Explorer"));
  panel.appendChild(title);

  /* Query box */
  const queryBox = document.createElement("div");
  queryBox.className = "bg-surface-container-highest p-4 mb-6 border border-white/5";
  const queryTop = document.createElement("div");
  queryTop.className = "flex justify-between text-[9px] font-mono";
  const queryLabel = document.createElement("span");
  queryLabel.className = "text-slate-500";
  queryLabel.textContent = "QUERY";
  queryTop.appendChild(queryLabel);
  const resultCount = document.createElement("span");
  resultCount.className = "text-slate-500";
  resultCount.textContent = fragments.length + " RESULTS";
  queryTop.appendChild(resultCount);
  queryBox.appendChild(queryTop);
  const queryText = document.createElement("div");
  queryText.className = "text-sm font-mono text-cyan-100 py-2 border-b border-white/5";
  queryText.textContent = state.memoryFilter.topic || state.memoryFilter.type || "*";
  queryBox.appendChild(queryText);
  panel.appendChild(queryBox);

  /* Results */
  const list = document.createElement("div");
  list.className = "space-y-3";
  list.id = "fragment-table";

  fragments.forEach(f => {
    const item = document.createElement("div");
    item.className = "bg-surface-container-low p-4 hover:bg-surface-container-high border-l border-transparent hover:border-cyan-400/50 cursor-pointer" + (f.id === state.selectedFragment?.id ? " border-cyan-400/50 bg-surface-container-high" : "");
    item.dataset.fragId = f.id;

    /* Top row */
    const topRow = document.createElement("div");
    topRow.className = "flex justify-between items-start mb-2";

    const topLeft = document.createElement("div");
    topLeft.className = "flex items-center gap-3";
    const idBadge = document.createElement("span");
    idBadge.className = "text-[10px] font-mono text-primary bg-primary/10 px-2 py-0.5";
    idBadge.textContent = "#MEM_" + (f.id ?? "").toString().slice(-5).padStart(5, "0");
    topLeft.appendChild(idBadge);
    const topicSpan = document.createElement("span");
    topicSpan.className = "text-xs font-bold text-on-surface uppercase tracking-wider";
    topicSpan.textContent = f.topic ?? "(무제)";
    topLeft.appendChild(topicSpan);
    topRow.appendChild(topLeft);

    const topRight = document.createElement("div");
    topRight.className = "flex items-center gap-4 text-right";
    const scoreDiv = document.createElement("div");
    const scoreLbl = document.createElement("div");
    scoreLbl.className = "text-[9px] text-slate-500 font-mono";
    scoreLbl.textContent = "UTILITY_SCORE";
    scoreDiv.appendChild(scoreLbl);
    const scoreVal = document.createElement("div");
    scoreVal.className = "text-xs font-mono text-tertiary";
    scoreVal.textContent = String(f.importance ?? "-");
    scoreDiv.appendChild(scoreVal);
    topRight.appendChild(scoreDiv);

    const accessDiv = document.createElement("div");
    const accessLbl = document.createElement("div");
    accessLbl.className = "text-[9px] text-slate-500 font-mono";
    accessLbl.textContent = "ACCESS";
    accessDiv.appendChild(accessLbl);
    const accessVal = document.createElement("div");
    accessVal.className = "text-xs font-mono text-tertiary";
    accessVal.textContent = f.access_count ?? "0";
    accessDiv.appendChild(accessVal);
    topRight.appendChild(accessDiv);

    topRow.appendChild(topRight);
    item.appendChild(topRow);

    /* Content preview */
    const preview = document.createElement("p");
    preview.className = "text-[11px] text-slate-400 line-clamp-2 font-body leading-relaxed mb-3 italic";
    preview.textContent = truncate(f.content ?? "", 200);
    item.appendChild(preview);

    /* Bottom: tags + timestamp */
    const bottom = document.createElement("div");
    bottom.className = "flex justify-between items-center";
    const tags = document.createElement("div");
    tags.className = "flex gap-2";
    const topicTag = document.createElement("span");
    topicTag.className = "text-[9px] border border-outline-variant px-2 py-0.5 text-slate-500 uppercase";
    topicTag.textContent = f.topic ?? "?";
    tags.appendChild(topicTag);
    const typeTag = document.createElement("span");
    typeTag.className = "text-[9px] border border-outline-variant px-2 py-0.5 text-slate-500 uppercase";
    typeTag.textContent = f.type ?? "?";
    tags.appendChild(typeTag);
    bottom.appendChild(tags);

    const dateSpan = document.createElement("div");
    dateSpan.className = "text-[9px] font-mono text-slate-600 uppercase";
    dateSpan.textContent = fmtDate(f.created_at);
    bottom.appendChild(dateSpan);
    item.appendChild(bottom);

    list.appendChild(item);
  });

  panel.appendChild(list);
  return panel;
}

function renderRetrievalAnalytics(stats) {
  const panel = document.createElement("section");
  panel.className = "glass-panel rounded-sm p-6 border-t border-primary/20";

  const title = document.createElement("h2");
  title.className = "font-headline text-sm font-bold text-cyan-100 uppercase tracking-widest mb-4";
  title.textContent = "Retrieval Analytics";
  panel.appendChild(title);

  /* Latency bars */
  const latencyBars = document.createElement("div");
  latencyBars.className = "flex h-1.5 gap-1 mb-4";
  const l1 = document.createElement("div");
  l1.className = "w-[15%] bg-primary shadow";
  latencyBars.appendChild(l1);
  const l2 = document.createElement("div");
  l2.className = "w-[45%] bg-primary/40";
  latencyBars.appendChild(l2);
  const l3 = document.createElement("div");
  l3.className = "w-[40%] bg-white/10";
  latencyBars.appendChild(l3);
  panel.appendChild(latencyBars);

  /* Grid: Hit Rate + Rerank Usage */
  const grid = document.createElement("div");
  grid.className = "grid grid-cols-2 gap-3 mb-4";

  /* Hit Rate */
  const hitBox = document.createElement("div");
  hitBox.className = "bg-surface-container-high p-3 text-center";
  const hitLabel = document.createElement("div");
  hitLabel.className = "text-[9px] font-mono text-slate-500 uppercase";
  hitLabel.textContent = "HIT RATE";
  hitBox.appendChild(hitLabel);
  const hitVal = document.createElement("div");
  hitVal.className = "text-2xl font-headline font-bold text-tertiary";
  hitVal.textContent = stats?.searchMetrics?.hitRate ? fmtPct(stats.searchMetrics.hitRate) : "87%";
  hitBox.appendChild(hitVal);
  const hitBar = document.createElement("div");
  hitBar.className = "w-full bg-white/5 h-1 mt-2";
  const hitFill = document.createElement("div");
  hitFill.className = "h-full bg-tertiary";
  hitFill.style.width = "87%";
  hitBar.appendChild(hitFill);
  hitBox.appendChild(hitBar);
  grid.appendChild(hitBox);

  /* Rerank Usage */
  const rerankBox = document.createElement("div");
  rerankBox.className = "bg-surface-container-high p-3 text-center";
  const rerankLabel = document.createElement("div");
  rerankLabel.className = "text-[9px] font-mono text-slate-500 uppercase";
  rerankLabel.textContent = "RERANK USAGE";
  rerankBox.appendChild(rerankLabel);
  const rerankVal = document.createElement("div");
  rerankVal.className = "text-2xl font-headline font-bold text-secondary";
  rerankVal.textContent = "42%";
  rerankBox.appendChild(rerankVal);
  const rerankBar = document.createElement("div");
  rerankBar.className = "w-full bg-white/5 h-1 mt-2";
  const rerankFill = document.createElement("div");
  rerankFill.className = "h-full bg-secondary";
  rerankFill.style.width = "42%";
  rerankBar.appendChild(rerankFill);
  rerankBox.appendChild(rerankBar);
  grid.appendChild(rerankBox);

  panel.appendChild(grid);

  /* Semantic Threshold */
  const threshLabel = document.createElement("div");
  threshLabel.className = "text-[9px] font-mono text-slate-500 uppercase mb-1";
  threshLabel.textContent = "SEMANTIC THRESHOLD";
  panel.appendChild(threshLabel);
  const rangeInput = document.createElement("input");
  rangeInput.type = "range";
  rangeInput.min = "0";
  rangeInput.max = "100";
  rangeInput.value = "70";
  rangeInput.className = "w-full accent-primary";
  panel.appendChild(rangeInput);

  return panel;
}

function renderAnomalyCards(anomalies) {
  if (!anomalies) return document.createDocumentFragment();

  const panel = document.createElement("section");
  panel.className = "glass-panel rounded-sm p-6 border-t border-error/20";

  const title = document.createElement("h2");
  title.className = "font-headline text-sm font-bold text-error uppercase tracking-widest mb-4";
  title.textContent = "Anomaly Insights";
  panel.appendChild(title);

  const list = document.createElement("div");
  list.className = "space-y-3";

  const items = [
    { label: "Contradiction Queue",   key: "contradictions",     icon: "crisis_alert",         isCritical: true },
    { label: "Superseded Candidates", key: "superseded",         icon: "auto_awesome_motion",  isCritical: false },
    { label: "Low Quality Fragments", key: "qualityUnverified",  icon: "low_priority",         isCritical: false },
    { label: "Embedding Backlog",     key: "embeddingBacklog",   icon: "memory_alt",           isCritical: false }
  ];

  items.forEach(a => {
    const row = document.createElement("div");
    row.className = a.isCritical
      ? "flex items-center justify-between p-3 bg-error-container/10 border-l-2 border-error"
      : "flex items-center justify-between p-3 bg-surface-container-high";
    row.dataset.anomaly = a.key;

    const left = document.createElement("div");
    left.className = "flex items-center gap-3 " + (a.isCritical ? "" : "text-slate-400");
    const icon = document.createElement("span");
    icon.className = "material-symbols-outlined text-lg" + (a.isCritical ? " text-error" : "");
    icon.textContent = a.icon;
    left.appendChild(icon);
    const lbl = document.createElement("span");
    lbl.className = "text-[10px] font-bold uppercase";
    lbl.textContent = a.label;
    left.appendChild(lbl);
    row.appendChild(left);

    const val = document.createElement("span");
    val.className = "text-xs font-mono" + (a.isCritical ? " text-error font-bold" : "");
    val.textContent = fmt(anomalies[a.key] ?? 0);
    row.appendChild(val);

    list.appendChild(row);
  });

  panel.appendChild(list);
  return panel;
}

function renderRecentEventsChart() {
  const panel = document.createElement("section");
  panel.className = "glass-panel rounded-sm p-6";

  /* Header */
  const header = document.createElement("div");
  header.className = "flex justify-between items-center mb-6";
  const title = document.createElement("h2");
  title.className = "font-headline text-sm font-bold text-cyan-100 uppercase tracking-widest";
  title.textContent = "Recent Events";
  header.appendChild(title);

  const legend = document.createElement("div");
  legend.className = "flex items-center gap-4";
  const leg1 = document.createElement("div");
  leg1.className = "flex items-center gap-1";
  const leg1Dot = document.createElement("div");
  leg1Dot.className = "w-2 h-2 bg-primary";
  leg1.appendChild(leg1Dot);
  const leg1Text = document.createElement("span");
  leg1Text.className = "text-[9px] font-mono text-slate-500 uppercase";
  leg1Text.textContent = "RECALL_EVENTS";
  leg1.appendChild(leg1Text);
  legend.appendChild(leg1);

  const leg2 = document.createElement("div");
  leg2.className = "flex items-center gap-1";
  const leg2Dot = document.createElement("div");
  leg2Dot.className = "w-2 h-2 bg-secondary";
  leg2.appendChild(leg2Dot);
  const leg2Text = document.createElement("span");
  leg2Text.className = "text-[9px] font-mono text-slate-500 uppercase";
  leg2Text.textContent = "QUERY_LOAD";
  leg2.appendChild(leg2Text);
  legend.appendChild(leg2);
  header.appendChild(legend);
  panel.appendChild(header);

  /* Chart area */
  const chart = document.createElement("div");
  chart.className = "w-full h-48 bg-surface-container-lowest border border-white/5 relative flex items-end px-2 pb-4";

  /* Grid lines */
  const gridLines = document.createElement("div");
  gridLines.className = "absolute inset-0 grid grid-rows-4";
  for (let i = 0; i < 4; i++) {
    const line = document.createElement("div");
    line.className = "border-b border-white/5";
    gridLines.appendChild(line);
  }
  chart.appendChild(gridLines);

  /* Bars */
  const barsWrap = document.createElement("div");
  barsWrap.className = "flex-1 flex items-end justify-around h-full gap-1 relative";
  const heights = [20, 35, 50, 30, 65, 45, 80, 55, 40, 70, 25, 60];
  heights.forEach(h => {
    const bar = document.createElement("div");
    bar.className = "w-full bg-primary/20 hover:bg-primary";
    bar.style.height = h + "%";
    barsWrap.appendChild(bar);
  });
  chart.appendChild(barsWrap);
  panel.appendChild(chart);

  /* Time axis */
  const timeAxis = document.createElement("div");
  timeAxis.className = "flex justify-between mt-3 text-[8px] font-mono text-slate-600 uppercase tracking-[0.2em]";
  ["00:00", "04:00", "08:00", "12:00", "16:00", "20:00"].forEach(t => {
    const span = document.createElement("span");
    span.textContent = t;
    timeAxis.appendChild(span);
  });
  panel.appendChild(timeAxis);

  return panel;
}

function renderFragmentInspector(fragment) {
  if (!fragment) return document.createDocumentFragment();

  const panel = document.createElement("section");
  panel.className = "glass-panel rounded-sm p-6 border-t border-primary/20";
  panel.id = "fragment-inspector";

  const title = document.createElement("h2");
  title.className = "font-headline text-sm font-bold text-cyan-100 flex items-center gap-3 mb-6 uppercase tracking-widest";
  title.textContent = "Fragment Detail";
  panel.appendChild(title);

  const content = document.createElement("div");
  content.className = "bg-surface-container-highest p-4 mb-4 text-[11px] text-slate-300 leading-relaxed whitespace-pre-wrap border border-white/5";
  content.textContent = fragment.content ?? "";
  panel.appendChild(content);

  const meta = document.createElement("div");
  meta.className = "space-y-2";
  [
    { label: "ID",       value: fragment.id },
    { label: "Type",     value: fragment.type ?? "" },
    { label: "Importance", value: String(fragment.importance ?? "-") },
    { label: "Agent",    value: fragment.agent_id ?? "-" },
    { label: "Key",      value: fragment.key_id ?? "master" },
    { label: "Created",  value: fmtDate(fragment.created_at) },
    { label: "Keywords", value: JSON.stringify(fragment.keywords ?? []) }
  ].forEach(f => {
    const row = document.createElement("div");
    row.className = "flex justify-between text-[10px]";
    const lbl = document.createElement("span");
    lbl.className = "text-slate-500 uppercase font-mono";
    lbl.textContent = f.label;
    row.appendChild(lbl);
    const val = document.createElement("span");
    val.className = "text-slate-300 font-mono";
    val.textContent = f.value;
    row.appendChild(val);
    meta.appendChild(row);
  });

  panel.appendChild(meta);
  return panel;
}

function renderPagination() {
  if (state.memoryPages <= 1) return document.createDocumentFragment();

  const wrap = document.createElement("div");
  wrap.className = "flex gap-2 mt-4 justify-center";

  for (let i = 1; i <= state.memoryPages; i++) {
    const btn = document.createElement("button");
    btn.className = "p-1 hover:bg-white/5 rounded-sm px-3 text-xs " + (i === state.memoryPage ? "text-white border border-primary/20" : "text-slate-500");
    btn.dataset.page = i;
    btn.textContent = i;
    wrap.appendChild(btn);
  }

  return wrap;
}

async function renderMemory(container) {
  container.textContent = "";
  container.appendChild(loadingHtml());

  const params = new URLSearchParams();
  if (state.memoryFilter.topic)  params.set("topic", state.memoryFilter.topic);
  if (state.memoryFilter.type)   params.set("type", state.memoryFilter.type);
  if (state.memoryFilter.key_id) params.set("key_id", state.memoryFilter.key_id);
  params.set("page", state.memoryPage);

  const [fragRes, anomalyRes] = await Promise.all([
    api("/memory/fragments?" + params),
    api("/memory/anomalies")
  ]);

  if (fragRes.ok) {
    const data = fragRes.data ?? {};
    if (Array.isArray(fragRes.data)) {
      state.fragments   = fragRes.data;
      state.memoryPages = 1;
    } else {
      state.fragments   = data.fragments ?? [];
      state.memoryPages = data.pages ?? 1;
    }
  } else {
    state.fragments = [];
  }

  state.anomalies = anomalyRes.ok ? anomalyRes.data : null;

  container.textContent = "";

  /* Filter bar */
  container.appendChild(renderMemoryFilters());

  /* Grid */
  const grid = document.createElement("div");
  grid.className = "grid grid-cols-12 gap-6 mt-6";

  /* Center: fragments */
  const centerCol = document.createElement("div");
  centerCol.className = "col-span-12 lg:col-span-8 space-y-6";
  centerCol.appendChild(renderFragmentList(state.fragments));
  centerCol.appendChild(renderPagination());
  grid.appendChild(centerCol);

  /* Right: analytics + anomalies */
  const rightCol = document.createElement("div");
  rightCol.className = "col-span-12 lg:col-span-4 space-y-6";
  rightCol.appendChild(renderRetrievalAnalytics(state.stats));
  rightCol.appendChild(renderAnomalyCards(state.anomalies));
  grid.appendChild(rightCol);

  container.appendChild(grid);

  /* Bottom: Recent Events Chart */
  const bottomGrid = document.createElement("div");
  bottomGrid.className = "grid grid-cols-12 gap-6 mt-6";
  const bottomCol = document.createElement("div");
  bottomCol.className = "col-span-12";
  bottomCol.appendChild(renderRecentEventsChart());
  bottomGrid.appendChild(bottomCol);
  container.appendChild(bottomGrid);

  /* Event: search */
  document.getElementById("filter-search")?.addEventListener("click", () => {
    state.memoryFilter.topic  = document.getElementById("filter-topic")?.value ?? "";
    state.memoryFilter.type   = document.getElementById("filter-type")?.value ?? "";
    state.memoryFilter.key_id = document.getElementById("filter-key-id")?.value ?? "";
    state.memoryPage = 1;
    renderMemory(container);
  });

  /* Event: pagination */
  container.querySelectorAll("[data-page]").forEach(btn => {
    btn.addEventListener("click", () => {
      state.memoryPage = parseInt(btn.dataset.page);
      renderMemory(container);
    });
  });

  /* Event: fragment click */
  container.querySelectorAll("[data-frag-id]").forEach(el => {
    el.addEventListener("click", () => {
      state.selectedFragment = state.fragments.find(f => f.id === el.dataset.fragId) ?? null;
      renderMemory(container);
    });
  });
}

/* ================================================================
   13. Utilities
   ================================================================ */

function esc(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmt(n) {
  if (n == null) return "0";
  return Number(n).toLocaleString("ko-KR");
}

function fmtMs(ms) {
  if (ms == null) return "-";
  return Number(ms).toFixed(1) + "ms";
}

function fmtPct(val) {
  if (val == null) return "-";
  return (Number(val) * 100).toFixed(1) + "%";
}

function fmtDate(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleDateString("ko-KR") + " " + d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

function fmtBytes(bytes) {
  if (bytes == null) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let idx = 0;
  let val = Number(bytes);
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx++;
  }
  return val.toFixed(1) + " " + units[idx];
}

function truncate(str, len) {
  if (!str) return "";
  return str.length > len ? str.slice(0, len) + "..." : str;
}

function relativeTime(iso) {
  const ts   = typeof iso === "number" ? iso : new Date(iso).getTime();
  const diff = Date.now() - ts;
  const min  = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return min + "m ago";
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + "h ago";
  const day = Math.floor(hr / 24);
  return day + "d ago";
}

function loadingHtml() {
  const div = document.createElement("div");
  div.className = "loading-spinner";
  for (let i = 0; i < 3; i++) {
    const dot = document.createElement("span");
    dot.className = "spinner-dot";
    div.appendChild(dot);
  }
  return div;
}

/* ================================================================
   14. Init
   ================================================================ */

function init() {
  const urlKey = new URLSearchParams(window.location.search).get("key");
  if (urlKey && !state.masterKey) {
    state.masterKey = urlKey;
    sessionStorage.setItem("adminKey", urlKey);
  }

  if (state.masterKey) {
    api("/auth", { method: "POST", body: { key: state.masterKey } })
      .then(res => {
        if (res.ok) {
          document.getElementById("login-root")?.classList.add("hidden");
          document.getElementById("app")?.classList.add("visible");
          navigate("overview");
        } else {
          state.masterKey = "";
          sessionStorage.removeItem("adminKey");
          renderLogin();
        }
      });
  } else {
    renderLogin();
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", init);
}

/* ================================================================
   15. Exports for testing (Node.js environment detection)
   ================================================================ */

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    renderOverviewCards,
    renderHealthPanel,
    renderTimeline,
    renderRiskPanel,
    renderQuickActions,
    renderLatencyIndex,
    renderQualityCoverage,
    renderTopTopics,
    renderKeyTable,
    renderKeyKpiRow,
    renderKeyInspector,
    renderGroupKpiRow,
    renderGroupTable,
    renderGroupInspector,
    renderMemoryFilters,
    renderFragmentList,
    renderRetrievalAnalytics,
    renderAnomalyCards,
    renderRecentEventsChart,
    renderFragmentInspector,
    renderPagination,
    esc,
    fmt,
    fmtMs,
    fmtPct,
    fmtDate,
    fmtBytes,
    truncate,
    relativeTime,
    state
  };
}
