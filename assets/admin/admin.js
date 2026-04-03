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

  selectedKeyId:     null,
  selectedGroupId:   null,
  selectedSessionId: null,

  keyFilterGroup:  "",
  keyFilterStatus: "",

  memoryFilter: { topic: "", type: "", key_id: "", group_id: "" },
  memoryPage:   1,
  memoryPages:  1,
  fragments:    [],
  selectedFragment: null,
  anomalies:    null,
  searchEvents: null,

  logFile:   "",
  logLevel:  "",
  logSearch: "",
  logTail:   200,
  logLines:  [],
  logFiles:  [],
  logStats:  null
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
    case "sessions":  renderSessions(container); break;
    case "logs":      renderLogs(container); break;
    case "graph":     renderGraph(container); break;
    default:          renderOverview(container);
  }
}

function renderScaffold(container, viewId) { // eslint-disable-line no-unused-vars
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
  { id: "sessions", label: "세션",       icon: "settings_input_component" },
  { id: "logs",     label: "로그",       icon: "terminal" },
  { id: "graph",    label: "지식 그래프", icon: "hub" }
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

const VIEW_TITLES = { // eslint-disable-line no-unused-vars
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
  ["Name", "Prefix", "Status", "Groups", "Created Date", "Usage (24h)", "Fragments", ""].forEach(h => {
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
        chip.textContent = typeof g === "string" ? g : (g.name ?? g.id ?? "?");
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

    /* Fragments quota */
    const tdFrag = document.createElement("td");
    tdFrag.className = "px-6 py-4";
    const fragCount = k.fragment_count ?? 0;
    const fragLimit = k.fragment_limit;
    const fragSpan  = document.createElement("span");
    fragSpan.className = "text-xs font-mono";
    if (fragLimit == null) {
      fragSpan.classList.add("text-slate-400");
      fragSpan.textContent = fmt(fragCount) + " / Unlimited";
    } else {
      const ratio = fragLimit > 0 ? fragCount / fragLimit : 0;
      if (ratio >= 1.0) {
        fragSpan.classList.add("text-red-400");
      } else if (ratio >= 0.8) {
        fragSpan.classList.add("text-orange-400");
      } else {
        fragSpan.classList.add("text-on-surface");
      }
      fragSpan.textContent = fmt(fragCount) + " / " + fmt(fragLimit);
    }
    tdFrag.appendChild(fragSpan);
    tr.appendChild(tdFrag);

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

function renderKeyInspector(key, container) {
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

  const inspFragCount = key.fragment_count ?? 0;
  const inspFragLimit = key.fragment_limit;
  const fragDisplayVal = inspFragLimit != null
    ? fmt(inspFragCount) + " / " + fmt(inspFragLimit)
    : fmt(inspFragCount) + " / Unlimited";

  [
    { label: "Total Usage",  value: fmt(key.today_calls ?? 0) + " req" },
    { label: "Last Active",  value: fmtDate(key.created_at) },
    { label: "Fragments",    value: fragDisplayVal, fragQuota: true }
  ].forEach(f => {
    const row = document.createElement("div");
    row.className = "flex justify-between items-center";
    const lbl = document.createElement("span");
    lbl.className = "text-xs text-slate-400";
    lbl.textContent = f.label;
    row.appendChild(lbl);
    const valWrap = document.createElement("div");
    valWrap.className = "flex items-center gap-2";
    const val = document.createElement("span");
    val.className = "text-xs font-mono text-on-surface";
    if (f.fragQuota && inspFragLimit != null) {
      const ratio = inspFragLimit > 0 ? inspFragCount / inspFragLimit : 0;
      if (ratio >= 1.0) val.classList.add("text-red-400");
      else if (ratio >= 0.8) val.classList.add("text-orange-400");
    }
    val.textContent = f.value;
    valWrap.appendChild(val);
    if (f.fragQuota) {
      const changeBtn = document.createElement("button");
      changeBtn.className = "text-[9px] text-primary font-bold uppercase hover:underline";
      changeBtn.textContent = "Change Limit";
      changeBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const current = inspFragLimit != null ? String(inspFragLimit) : "";
        const input   = prompt("New fragment limit (leave empty for unlimited):", current);
        if (input === null) return;
        const newLimit = input.trim() === "" ? null : parseInt(input.trim());
        if (newLimit !== null && (isNaN(newLimit) || newLimit < 0)) {
          showToast("Invalid limit value", "warning");
          return;
        }
        const res = await api("/keys/" + key.id + "/fragment-limit", {
          method: "PUT",
          body: { fragment_limit: newLimit }
        });
        if (res.ok) {
          showToast("Fragment limit updated", "success");
          renderKeys(container);
        } else {
          showToast(res.data?.error ?? "Update failed", "error");
        }
      });
      valWrap.appendChild(changeBtn);
    }
    row.appendChild(valWrap);
    statsDiv.appendChild(row);
  });
  idCard.appendChild(statsDiv);

  /* Daily Limit — editable */
  const dailyRow = document.createElement("div");
  dailyRow.className = "flex justify-between items-center mt-2";
  const dailyLabel = document.createElement("span");
  dailyLabel.className = "text-[10px] font-bold text-slate-500 uppercase tracking-wider";
  dailyLabel.textContent = "DAILY RATE LIMIT";
  dailyRow.appendChild(dailyLabel);
  const dailyVal = document.createElement("input");
  dailyVal.type = "number";
  dailyVal.min = "1";
  dailyVal.max = "99999";
  dailyVal.step = "1000";
  dailyVal.value = String(key.daily_limit ?? 10000);
  dailyVal.className = "w-24 bg-transparent border border-outline-variant/30 rounded-sm px-2 py-1 text-right text-sm font-mono text-on-surface focus:border-primary focus:outline-none";
  dailyVal.addEventListener("change", async () => {
    const val = parseInt(dailyVal.value);
    if (!val || val < 1) { showToast("1 이상 입력", "warning"); dailyVal.value = key.daily_limit; return; }
    const r = await api("/keys/" + key.id + "/daily-limit", { method: "PUT", body: { daily_limit: val } });
    if (r.ok) { showToast("Daily limit updated", "success"); key.daily_limit = val; }
    else showToast(r.data?.error ?? "Update failed", "error");
  });
  dailyRow.appendChild(dailyVal);
  idCard.appendChild(dailyRow);

  /* Permissions — toggle */
  const permRow = document.createElement("div");
  permRow.className = "flex justify-between items-center";
  const permLabel = document.createElement("span");
  permLabel.className = "text-[10px] font-bold text-slate-500 uppercase tracking-wider";
  permLabel.textContent = "PERMISSIONS";
  permRow.appendChild(permLabel);

  const permBtns = document.createElement("div");
  permBtns.className = "flex gap-1";
  ["read", "write"].forEach(p => {
    const btn = document.createElement("button");
    const active = (key.permissions || []).includes(p);
    btn.className = "px-2 py-0.5 text-[10px] font-bold rounded-sm border " +
      (active ? "bg-primary/20 text-primary border-primary/30" : "bg-transparent text-slate-600 border-white/10");
    btn.textContent = p.toUpperCase();
    btn.addEventListener("click", async () => {
      const current = new Set(key.permissions || []);
      if (current.has(p)) current.delete(p); else current.add(p);
      const perms = Array.from(current);
      if (!perms.length) { showToast("At least one permission required", "warning"); return; }
      const r = await api("/keys/" + key.id + "/permissions", { method: "PUT", body: { permissions: perms } });
      if (r.ok) { showToast("Permissions updated", "success"); key.permissions = perms; renderKeys(container); }
      else showToast(r.data?.error ?? "Update failed", "error");
    });
    permBtns.appendChild(btn);
  });
  permRow.appendChild(permBtns);
  idCard.appendChild(permRow);

  /* Fragment Limit — editable */
  const fragRow = document.createElement("div");
  fragRow.className = "flex justify-between items-center";
  const fragLabel = document.createElement("span");
  fragLabel.className = "text-[10px] font-bold text-slate-500 uppercase tracking-wider";
  fragLabel.textContent = "FRAGMENT LIMIT";
  fragRow.appendChild(fragLabel);

  const fragVal = document.createElement("input");
  fragVal.type = "number";
  fragVal.min = "0";
  fragVal.max = "99999";
  fragVal.step = "1000";
  fragVal.value = key.fragment_limit != null ? String(key.fragment_limit) : "";
  fragVal.placeholder = "Unlimited";
  fragVal.className = "w-24 bg-transparent border border-outline-variant/30 rounded-sm px-2 py-1 text-right text-sm font-mono text-on-surface focus:border-primary focus:outline-none";
  fragVal.addEventListener("change", async () => {
    const raw = fragVal.value.trim();
    const limit = raw === "" ? null : parseInt(raw);
    if (limit !== null && (isNaN(limit) || limit < 0)) { showToast("0 이상 입력 또는 빈칸(무제한)", "warning"); return; }
    const r = await api("/keys/" + key.id + "/fragment-limit", { method: "PUT", body: { fragment_limit: limit } });
    if (r.ok) { showToast("Fragment limit updated", "success"); key.fragment_limit = limit; }
    else showToast(r.data?.error ?? "Update failed", "error");
  });
  fragRow.appendChild(fragVal);
  idCard.appendChild(fragRow);

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
      const gName = typeof g === "string" ? g : (g.name ?? g.id ?? "?");
      const chip = document.createElement("span");
      chip.className = "px-2 py-0.5 bg-white/5 rounded-sm text-[10px] text-slate-400 border border-white/10 uppercase font-bold flex items-center gap-1";
      chip.textContent = gName;
      const rmIcon = document.createElement("span");
      rmIcon.className = "material-symbols-outlined text-[12px] text-slate-500 cursor-pointer hover:text-error";
      rmIcon.textContent = "close";
      const gId = typeof g === "string" ? g : g.id;
      rmIcon.addEventListener("click", async (e) => {
        e.stopPropagation();
        await api("/groups/" + gId + "/members/" + key.id, { method: "DELETE" });
        showToast("Removed from group", "success");
        renderKeys(container);
      });
      chip.appendChild(rmIcon);
      groupChips.appendChild(chip);
    });
  }

  const addGroupBtn = document.createElement("button");
  addGroupBtn.className = "px-2 py-0.5 border border-dashed border-white/10 text-[10px] text-slate-500 uppercase hover:border-primary hover:text-primary transition-colors cursor-pointer";
  addGroupBtn.textContent = "ADD GROUP";
  addGroupBtn.addEventListener("click", () => {
    const form = document.createElement("div");
    const g1 = document.createElement("div");
    g1.className = "form-group";
    const l1 = document.createElement("label");
    l1.className = "form-label";
    l1.textContent = "SELECT GROUP";
    g1.appendChild(l1);
    const sel = document.createElement("select");
    sel.className = "form-select";
    sel.id = "modal-assign-group";
    const existingGroupIds = new Set((key.groups ?? []).map(g => typeof g === "string" ? g : g.id));
    const available = (state.groups ?? []).filter(g => !existingGroupIds.has(g.id));
    if (!available.length) {
      const opt = document.createElement("option");
      opt.textContent = "(no available groups)";
      opt.disabled = true;
      sel.appendChild(opt);
    }
    available.forEach(g => {
      const opt = document.createElement("option");
      opt.value = g.id;
      opt.textContent = g.name;
      sel.appendChild(opt);
    });
    g1.appendChild(sel);
    form.appendChild(g1);

    showModal("Assign to Group", form, [
      { id: "assign", label: "ASSIGN", cls: "btn-primary", handler: async () => {
        const groupId = document.getElementById("modal-assign-group")?.value;
        if (!groupId) return;
        await api("/groups/" + groupId + "/members", { method: "POST", body: { key_id: key.id } });
        closeModal();
        showToast("Assigned to group", "success");
        renderKeys(container);
      }}
    ]);
  });
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
    assignBtn.className = "text-[9px] text-primary font-bold uppercase cursor-pointer hover:text-primary/80";
    assignBtn.textContent = "ASSIGN";
    assignBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await api("/groups/" + g.id + "/members", { method: "POST", body: { key_id: key.id } });
      showToast("Assigned to " + g.name, "success");
      renderKeys(container);
    });
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

  const [res, gRes] = await Promise.all([api("/keys"), api("/groups")]);
  if (res.ok) state.keys   = res.data ?? [];
  if (gRes.ok) state.groups = gRes.data ?? [];

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

  /* Filter Bar */
  const filterBar = document.createElement("div");
  filterBar.className = "glass-panel p-2 rounded-sm flex items-center gap-4 mb-6";

  const groupChip = document.createElement("div");
  groupChip.className = "px-3 py-1 bg-surface-variant text-[10px] font-bold flex items-center gap-2 rounded-sm text-primary";
  const groupSelect = document.createElement("select");
  groupSelect.id = "key-filter-group";
  groupSelect.className = "bg-transparent border-none outline-none text-[10px] font-bold text-slate-400 cursor-pointer";
  const groupOptAll = document.createElement("option");
  groupOptAll.value = "";
  groupOptAll.textContent = "GROUP: ALL";
  groupSelect.appendChild(groupOptAll);
  const groupOptNone = document.createElement("option");
  groupOptNone.value = "__none__";
  groupOptNone.textContent = "GROUP: UNASSIGNED";
  if (state.keyFilterGroup === "__none__") groupOptNone.selected = true;
  groupSelect.appendChild(groupOptNone);
  const seenGroups = new Map();
  state.keys.forEach(k => (k.groups ?? []).forEach(g => {
    const gid  = typeof g === "string" ? g : g.id;
    const gname = typeof g === "string" ? g : g.name;
    if (!seenGroups.has(gid)) seenGroups.set(gid, gname);
  }));
  for (const [gid, gname] of seenGroups) {
    const opt = document.createElement("option");
    opt.value = gid;
    opt.textContent = "GROUP: " + (gname ?? gid).toUpperCase();
    if (state.keyFilterGroup === gid) opt.selected = true;
    groupSelect.appendChild(opt);
  }
  groupChip.appendChild(groupSelect);
  filterBar.appendChild(groupChip);

  const statusChip = document.createElement("div");
  statusChip.className = "px-3 py-1 bg-surface-variant text-[10px] font-bold flex items-center gap-2 rounded-sm text-primary";
  const statusSelect = document.createElement("select");
  statusSelect.id = "key-filter-status";
  statusSelect.className = "bg-transparent border-none outline-none text-[10px] font-bold text-slate-400 cursor-pointer";
  ["", "active", "inactive"].forEach(v => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v ? "STATUS: " + v.toUpperCase() : "STATUS: ALL";
    if (state.keyFilterStatus === v) opt.selected = true;
    statusSelect.appendChild(opt);
  });
  statusChip.appendChild(statusSelect);
  filterBar.appendChild(statusChip);

  const countLabel = document.createElement("span");
  countLabel.className = "ml-auto text-[10px] text-slate-500 font-mono";
  countLabel.id = "key-filter-count";
  filterBar.appendChild(countLabel);

  container.appendChild(filterBar);

  /* Apply filters */
  let filteredKeys = state.keys;
  if (state.keyFilterStatus) {
    filteredKeys = filteredKeys.filter(k => k.status === state.keyFilterStatus);
  }
  if (state.keyFilterGroup === "__none__") {
    filteredKeys = filteredKeys.filter(k => !k.groups?.length);
  } else if (state.keyFilterGroup) {
    filteredKeys = filteredKeys.filter(k =>
      (k.groups ?? []).some(g => (typeof g === "string" ? g : g.id) === state.keyFilterGroup)
    );
  }
  countLabel.textContent = filteredKeys.length + " / " + state.keys.length;

  /* Split layout */
  const split = document.createElement("div");
  split.className = "flex gap-0";
  split.style.minHeight = "400px";

  split.appendChild(renderKeyTable(filteredKeys));
  split.appendChild(renderKeyInspector(selectedKey, container));
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
    limitInput.min = "1";
    limitInput.max = "99999";
    limitInput.step = "1000";
    limitInput.value = "10000";
    g2.appendChild(limitInput);
    form.appendChild(g2);

    const g3 = document.createElement("div");
    g3.className = "form-group";
    const l3 = document.createElement("label");
    l3.className = "form-label";
    l3.textContent = "FRAGMENT LIMIT";
    g3.appendChild(l3);
    const fragLimitInput = document.createElement("input");
    fragLimitInput.className = "form-input";
    fragLimitInput.id = "modal-key-frag-limit";
    fragLimitInput.type = "number";
    fragLimitInput.min = "0";
    fragLimitInput.max = "99999";
    fragLimitInput.step = "1000";
    fragLimitInput.placeholder = "5000";
    g3.appendChild(fragLimitInput);
    const fragHint = document.createElement("p");
    fragHint.className = "text-[10px] text-slate-500 mt-1";
    fragHint.textContent = "Leave empty for unlimited";
    g3.appendChild(fragHint);
    form.appendChild(g3);

    const g4 = document.createElement("div");
    g4.className = "form-group";
    const l4 = document.createElement("label");
    l4.className = "form-label";
    l4.textContent = "PERMISSIONS";
    g4.appendChild(l4);

    const permWrap = document.createElement("div");
    permWrap.className = "flex gap-4";

    const readLabel = document.createElement("label");
    readLabel.className = "flex items-center gap-2 text-sm text-on-surface cursor-pointer";
    const readCb = document.createElement("input");
    readCb.type = "checkbox";
    readCb.id = "modal-perm-read";
    readCb.checked = true;
    readCb.className = "accent-primary";
    readLabel.appendChild(readCb);
    readLabel.appendChild(document.createTextNode("Read"));
    permWrap.appendChild(readLabel);

    const writeLabel = document.createElement("label");
    writeLabel.className = "flex items-center gap-2 text-sm text-on-surface cursor-pointer";
    const writeCb = document.createElement("input");
    writeCb.type = "checkbox";
    writeCb.id = "modal-perm-write";
    writeCb.checked = true;
    writeCb.className = "accent-primary";
    writeLabel.appendChild(writeCb);
    writeLabel.appendChild(document.createTextNode("Write"));
    permWrap.appendChild(writeLabel);

    g4.appendChild(permWrap);
    form.appendChild(g4);

    showModal("Generate New API Credential", form, [
      { id: "create", label: "GENERATE AND VIEW SECRET", cls: "btn-primary", handler: async () => {
        const name        = document.getElementById("modal-key-name")?.value.trim();
        const daily_limit = parseInt(document.getElementById("modal-key-limit")?.value) || 10000;
        const fragLimitRaw = document.getElementById("modal-key-frag-limit")?.value.trim();
        const fragment_limit = fragLimitRaw ? parseInt(fragLimitRaw) : null;
        if (!name) { showToast("Name required", "warning"); return; }
        const perms = [];
        if (document.getElementById("modal-perm-read")?.checked) perms.push("read");
        if (document.getElementById("modal-perm-write")?.checked) perms.push("write");
        const body = { name, daily_limit, permissions: perms };
        if (fragment_limit != null) body.fragment_limit = fragment_limit;
        const res = await api("/keys", { method: "POST", body });
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

  /* Event: filter selects */
  document.getElementById("key-filter-group")?.addEventListener("change", (e) => {
    state.keyFilterGroup = e.target.value;
    renderKeys(container);
  });
  document.getElementById("key-filter-status")?.addEventListener("change", (e) => {
    state.keyFilterStatus = e.target.value;
    renderKeys(container);
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
   11.5. Sessions View (Stitch-aligned: table + inspector style)
   ================================================================ */

function renderSessionKpiRow(counts) {
  const cards = [
    { label: "STREAMABLE",   value: counts.streamable ?? 0,   border: "bg-primary" },
    { label: "LEGACY SSE",   value: counts.legacy ?? 0,       border: "bg-secondary" },
    { label: "UNREFLECTED",  value: counts.unreflected ?? 0,  border: "bg-error" },
    { label: "TOTAL",         value: counts.total ?? 0,        border: "bg-tertiary" }
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

function renderSessionTable(sessions) {
  const wrap = document.createElement("div");
  wrap.className = "glass-panel flex-1 flex flex-col min-h-0";

  const tableWrap = document.createElement("div");
  tableWrap.className = "overflow-x-auto";

  const table = document.createElement("table");
  table.className = "w-full text-left border-collapse";
  table.id = "sessions-table";

  const thead = document.createElement("thead");
  thead.className = "bg-white/5 border-b border-white/5";
  const hRow = document.createElement("tr");
  ["Session ID", "Type", "Key", "Created", "Last Active", "Tools", "Reflected"].forEach(h => {
    const th = document.createElement("th");
    th.className = "px-6 py-4 text-[10px] font-bold text-slate-400 tracking-widest uppercase font-label";
    th.textContent = h;
    hRow.appendChild(th);
  });
  thead.appendChild(hRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  tbody.className = "divide-y divide-white/5";

  sessions.forEach(s => {
    const tr = document.createElement("tr");
    tr.className = "hover:bg-white/5 transition-colors group cursor-pointer" + (s.sessionId === state.selectedSessionId ? " bg-white/[0.02]" : "");
    tr.dataset.sessionId = s.sessionId;

    /* Session ID */
    const td1 = document.createElement("td");
    td1.className = "px-6 py-4 font-mono text-xs text-on-surface";
    td1.textContent = (s.sessionId ?? "").slice(0, 8);
    tr.appendChild(td1);

    /* Type */
    const td2 = document.createElement("td");
    td2.className = "px-6 py-4";
    const typeBadge = document.createElement("span");
    const isStreamable = s.type === "streamable";
    typeBadge.className = "px-2 py-0.5 text-[10px] font-bold rounded-sm " + (isStreamable ? "bg-primary/10 text-primary" : "bg-secondary/10 text-secondary");
    typeBadge.textContent = isStreamable ? "STREAM" : "SSE";
    td2.appendChild(typeBadge);
    tr.appendChild(td2);

    /* Key */
    const td3 = document.createElement("td");
    td3.className = "px-6 py-4 text-xs text-slate-400";
    td3.textContent = s.keyId ?? "master";
    tr.appendChild(td3);

    /* Created */
    const td4 = document.createElement("td");
    td4.className = "px-6 py-4 font-mono text-xs text-slate-500";
    td4.textContent = relativeTime(s.createdAt);
    tr.appendChild(td4);

    /* Last Active */
    const td5 = document.createElement("td");
    td5.className = "px-6 py-4 font-mono text-xs text-slate-500";
    td5.textContent = s.lastActiveAt ? relativeTime(s.lastActiveAt) : "-";
    tr.appendChild(td5);

    /* Tools */
    const td6 = document.createElement("td");
    td6.className = "px-6 py-4 text-xs font-mono text-on-surface";
    const toolCalls = s.toolCalls ?? {};
    const totalTools = Object.values(toolCalls).reduce((sum, v) => sum + (Number(v) || 0), 0);
    td6.textContent = totalTools > 0 ? fmt(totalTools) : "-";
    tr.appendChild(td6);

    /* Reflected */
    const td7 = document.createElement("td");
    td7.className = "px-6 py-4";
    const reflectDot = document.createElement("div");
    reflectDot.className = "w-2 h-2 rounded-full " + (s.reflected ? "bg-tertiary" : "bg-error");
    td7.appendChild(reflectDot);
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
  countText.textContent = "Showing " + sessions.length + " sessions";
  footer.appendChild(countText);

  const btnWrap = document.createElement("div");
  btnWrap.className = "flex gap-2";

  const reflectAllBtn = document.createElement("button");
  reflectAllBtn.className = "btn px-3 py-1.5 text-[10px] font-bold flex items-center gap-1 border-secondary/30 text-secondary";
  reflectAllBtn.id = "session-reflect-all";
  const reflectIcon = document.createElement("span");
  reflectIcon.className = "material-symbols-outlined text-sm";
  reflectIcon.textContent = "auto_fix_high";
  reflectAllBtn.appendChild(reflectIcon);
  reflectAllBtn.appendChild(document.createTextNode("REFLECT ALL"));
  btnWrap.appendChild(reflectAllBtn);

  const cleanupBtn = document.createElement("button");
  cleanupBtn.className = "btn-primary px-3 py-1.5 text-[10px] font-bold flex items-center gap-1";
  cleanupBtn.id = "session-cleanup-footer";
  const cleanupIcon = document.createElement("span");
  cleanupIcon.className = "material-symbols-outlined text-sm";
  cleanupIcon.textContent = "cleaning_services";
  cleanupBtn.appendChild(cleanupIcon);
  cleanupBtn.appendChild(document.createTextNode("CLEANUP"));
  btnWrap.appendChild(cleanupBtn);

  footer.appendChild(btnWrap);

  wrap.appendChild(footer);

  return wrap;
}

function renderSessionInspector(data) {
  const panel = document.createElement("aside");
  panel.className = "w-96 bg-surface-container-high border-l border-white/5 flex flex-col p-6 gap-6 relative overflow-y-auto";
  panel.id = "session-inspector";

  /* Header */
  const headerDiv = document.createElement("div");
  headerDiv.className = "flex items-center justify-between";
  const headerLabel = document.createElement("h3");
  headerLabel.className = "text-xs font-bold text-slate-400 tracking-widest uppercase font-label flex items-center gap-2";
  const infoIcon = document.createElement("span");
  infoIcon.className = "material-symbols-outlined text-primary text-lg";
  infoIcon.textContent = "info";
  headerLabel.appendChild(infoIcon);
  headerLabel.appendChild(document.createTextNode("SESSION INSPECTOR"));
  headerDiv.appendChild(headerLabel);

  const closeBtn = document.createElement("button");
  closeBtn.className = "text-slate-500 hover:text-slate-300";
  closeBtn.dataset.sessionAction = "close";
  const closeIcon = document.createElement("span");
  closeIcon.className = "material-symbols-outlined";
  closeIcon.textContent = "close";
  closeBtn.appendChild(closeIcon);
  headerDiv.appendChild(closeBtn);
  panel.appendChild(headerDiv);

  const session = data.session ?? data;

  /* Identity Card */
  const idCard = document.createElement("div");
  idCard.className = "bg-surface-container-highest p-4 rounded-sm border-l-2 border-primary";

  const idLabel = document.createElement("div");
  idLabel.className = "text-[10px] font-bold text-slate-400 tracking-widest uppercase mb-1 font-label";
  idLabel.textContent = "SESSION ID";
  idCard.appendChild(idLabel);

  const idValue = document.createElement("p");
  idValue.className = "font-mono text-xs text-on-surface break-all";
  idValue.textContent = session.sessionId ?? "";
  idCard.appendChild(idValue);

  const isStreamable = session.type === "streamable";
  const typeBadge = document.createElement("div");
  typeBadge.className = "inline-block mt-2 px-2 py-1 text-[10px] font-bold rounded-sm " + (isStreamable ? "bg-primary/10 text-primary border border-primary/20" : "bg-secondary/10 text-secondary border border-secondary/20");
  typeBadge.textContent = isStreamable ? "STREAMABLE" : "LEGACY SSE";
  idCard.appendChild(typeBadge);

  const statsDiv = document.createElement("div");
  statsDiv.className = "mt-4 space-y-2";
  [
    { label: "Created",     value: fmtDate(session.createdAt) },
    { label: "Expires",     value: fmtDate(session.expiresAt) },
    { label: "Last Active", value: fmtDate(session.lastActiveAt) },
    { label: "Key",         value: session.keyId ?? "master" }
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

  /* Activity Summary */
  const actLabel = document.createElement("div");
  actLabel.className = "text-[10px] font-bold text-slate-400 tracking-widest uppercase mb-2 font-label";
  actLabel.textContent = "TOOL CALLS";
  panel.appendChild(actLabel);

  const toolCalls = session.toolCalls ?? {};
  const toolEntries = Object.entries(toolCalls);
  if (toolEntries.length) {
    const toolList = document.createElement("div");
    toolList.className = "space-y-1";
    toolEntries.forEach(([name, count]) => {
      const row = document.createElement("div");
      row.className = "flex justify-between items-center p-2 bg-surface-container border border-white/5";
      const nameEl = document.createElement("span");
      nameEl.className = "text-xs text-slate-300";
      nameEl.textContent = name;
      row.appendChild(nameEl);
      const countEl = document.createElement("span");
      countEl.className = "text-xs font-mono text-primary font-bold";
      countEl.textContent = fmt(count);
      row.appendChild(countEl);
      toolList.appendChild(row);
    });
    panel.appendChild(toolList);
  } else {
    const noTools = document.createElement("div");
    noTools.className = "text-[10px] text-slate-600 text-center py-4";
    noTools.textContent = "No tool calls recorded";
    panel.appendChild(noTools);
  }

  /* Keywords */
  const keywords = session.keywords ?? [];
  if (keywords.length) {
    const kwLabel = document.createElement("div");
    kwLabel.className = "text-[10px] font-bold text-slate-400 tracking-widest uppercase mb-2 font-label mt-2";
    kwLabel.textContent = "KEYWORDS";
    panel.appendChild(kwLabel);

    const kwWrap = document.createElement("div");
    kwWrap.className = "flex flex-wrap gap-1";
    keywords.forEach(kw => {
      const chip = document.createElement("span");
      chip.className = "px-2 py-0.5 bg-white/5 rounded-sm text-[10px] text-slate-400 border border-white/10";
      chip.textContent = kw;
      kwWrap.appendChild(chip);
    });
    panel.appendChild(kwWrap);
  }

  /* Fragment Count */
  const fragCount = session.fragmentCount ?? 0;
  if (fragCount > 0) {
    const fragLabel = document.createElement("div");
    fragLabel.className = "text-[10px] font-bold text-slate-400 tracking-widest uppercase mb-1 font-label mt-2";
    fragLabel.textContent = "FRAGMENTS";
    panel.appendChild(fragLabel);
    const fragVal = document.createElement("div");
    fragVal.className = "text-sm font-mono text-on-surface";
    fragVal.textContent = fmt(fragCount);
    panel.appendChild(fragVal);
  }

  /* Search Events */
  const searchEvents = data.searchEvents ?? [];
  if (searchEvents.length) {
    const seLabel = document.createElement("div");
    seLabel.className = "text-[10px] font-bold text-slate-400 tracking-widest uppercase mb-2 font-label mt-2";
    seLabel.textContent = "SEARCH EVENTS";
    panel.appendChild(seLabel);

    const seList = document.createElement("div");
    seList.className = "space-y-1 max-h-40 overflow-y-auto";
    searchEvents.slice(0, 10).forEach(ev => {
      const row = document.createElement("div");
      row.className = "flex items-center gap-2 p-2 bg-surface-container border border-white/5 text-[10px]";

      const qType = document.createElement("span");
      qType.className = "text-primary font-bold uppercase";
      qType.textContent = ev.query_type ?? "";
      row.appendChild(qType);

      const results = document.createElement("span");
      results.className = "text-slate-400";
      results.textContent = fmt(ev.result_count ?? 0) + " results";
      row.appendChild(results);

      const latency = document.createElement("span");
      latency.className = "text-slate-500 font-mono ml-auto";
      latency.textContent = fmtMs(ev.latency_ms);
      row.appendChild(latency);

      const time = document.createElement("span");
      time.className = "text-slate-600";
      time.textContent = relativeTime(ev.created_at);
      row.appendChild(time);

      seList.appendChild(row);
    });
    panel.appendChild(seList);
  }

  /* Tool Feedback */
  const toolFeedback = data.toolFeedback ?? [];
  if (toolFeedback.length) {
    const tfLabel = document.createElement("div");
    tfLabel.className = "text-[10px] font-bold text-slate-400 tracking-widest uppercase mb-2 font-label mt-2";
    tfLabel.textContent = "TOOL FEEDBACK";
    panel.appendChild(tfLabel);

    const tfList = document.createElement("div");
    tfList.className = "space-y-1 max-h-40 overflow-y-auto";
    toolFeedback.slice(0, 10).forEach(fb => {
      const row = document.createElement("div");
      row.className = "flex items-center gap-2 p-2 bg-surface-container border border-white/5 text-[10px]";

      const toolName = document.createElement("span");
      toolName.className = "text-slate-300";
      toolName.textContent = fb.tool_name ?? "";
      row.appendChild(toolName);

      const relevantIcon = document.createElement("span");
      relevantIcon.className = "material-symbols-outlined text-sm " + (fb.relevant ? "text-tertiary" : "text-slate-600");
      relevantIcon.textContent = fb.relevant ? "check_circle" : "cancel";
      row.appendChild(relevantIcon);

      const sufficientIcon = document.createElement("span");
      sufficientIcon.className = "material-symbols-outlined text-sm " + (fb.sufficient ? "text-tertiary" : "text-slate-600");
      sufficientIcon.textContent = fb.sufficient ? "verified" : "unpublished";
      row.appendChild(sufficientIcon);

      tfList.appendChild(row);
    });
    panel.appendChild(tfList);
  }

  /* Danger Zone */
  const danger = document.createElement("div");
  danger.className = "pt-6 border-t border-white/5 mt-auto";
  const dangerLabel = document.createElement("p");
  dangerLabel.className = "text-[10px] font-bold text-error tracking-widest uppercase mb-3 font-label";
  dangerLabel.textContent = "DANGER ZONE";
  danger.appendChild(dangerLabel);

  const dangerGrid = document.createElement("div");
  dangerGrid.className = "space-y-2";

  if (!session.reflected) {
    const reflectBtn = document.createElement("button");
    reflectBtn.className = "w-full py-2 border border-primary/30 text-primary text-[10px] font-bold hover:bg-primary/10 transition-all uppercase";
    reflectBtn.textContent = "FORCE REFLECT";
    reflectBtn.dataset.sessionAction = "reflect";
    reflectBtn.dataset.sessionId     = session.sessionId;
    dangerGrid.appendChild(reflectBtn);
  }

  const terminateBtn = document.createElement("button");
  terminateBtn.className = "w-full py-2 bg-error text-on-error text-[10px] font-bold hover:brightness-110 transition-all uppercase";
  terminateBtn.textContent = "TERMINATE SESSION";
  terminateBtn.dataset.sessionAction = "terminate";
  terminateBtn.dataset.sessionId     = session.sessionId;
  dangerGrid.appendChild(terminateBtn);

  danger.appendChild(dangerGrid);
  panel.appendChild(danger);

  return panel;
}

async function renderSessions(container) {
  container.textContent = "";
  container.appendChild(loadingHtml());

  const res = await api("/sessions");
  const data     = res.ok ? res.data : { sessions: [], counts: {} };
  const sessions = data.sessions ?? [];
  const counts   = data.counts ?? {};

  container.textContent = "";

  /* Header */
  const header = document.createElement("div");
  header.className = "flex justify-between items-end mb-8";
  const headerLeft = document.createElement("div");
  const h2 = document.createElement("h2");
  h2.className = "text-2xl font-headline font-bold text-on-surface tracking-tight";
  h2.textContent = "Session Management";
  headerLeft.appendChild(h2);
  const subtitle = document.createElement("p");
  subtitle.className = "text-sm text-slate-400 mt-1";
  subtitle.textContent = "Live session monitoring and lifecycle control.";
  headerLeft.appendChild(subtitle);
  header.appendChild(headerLeft);

  const cleanupBtn = document.createElement("button");
  cleanupBtn.className = "btn-primary px-5 py-2.5 bg-primary-container text-on-primary-fixed font-bold text-sm flex items-center gap-2";
  cleanupBtn.id = "session-cleanup-btn";
  const cleanupIcon = document.createElement("span");
  cleanupIcon.className = "material-symbols-outlined text-lg";
  cleanupIcon.textContent = "cleaning_services";
  cleanupBtn.appendChild(cleanupIcon);
  cleanupBtn.appendChild(document.createTextNode("CLEANUP"));
  header.appendChild(cleanupBtn);
  container.appendChild(header);

  /* KPI Row */
  container.appendChild(renderSessionKpiRow(counts));

  /* Split layout */
  const split = document.createElement("div");
  split.className = "flex gap-0";
  split.style.minHeight = "400px";

  split.appendChild(renderSessionTable(sessions));

  if (state.selectedSessionId) {
    const detailRes = await api("/sessions/" + state.selectedSessionId);
    if (detailRes.ok) {
      split.appendChild(renderSessionInspector(detailRes.data));
    }
  }

  container.appendChild(split);

  /* Event: table row click */
  container.querySelectorAll("#sessions-table tbody tr").forEach(tr => {
    tr.addEventListener("click", () => {
      state.selectedSessionId = tr.dataset.sessionId;
      renderSessions(container);
    });
  });

  /* Event: close inspector */
  container.querySelector("[data-session-action='close']")?.addEventListener("click", () => {
    state.selectedSessionId = null;
    renderSessions(container);
  });

  /* Event: force reflect */
  container.querySelector("[data-session-action='reflect']")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    const sid = e.currentTarget.dataset.sessionId;
    const reflectRes = await api("/sessions/" + sid + "/reflect", { method: "POST" });
    if (reflectRes.ok) {
      showToast("Session reflected", "success");
    } else {
      showToast(reflectRes.data?.error ?? "Reflect failed", "error");
    }
    renderSessions(container);
  });

  /* Event: terminate session */
  container.querySelector("[data-session-action='terminate']")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const sid = e.currentTarget.dataset.sessionId;
    const msg = document.createElement("span");
    msg.className = "text-sm text-error";
    msg.textContent = "This will immediately terminate the session. Proceed?";
    showModal("Confirm Session Termination", msg, [
      { id: "confirm", label: "TERMINATE", cls: "btn-danger", handler: async () => {
        await api("/sessions/" + sid, { method: "DELETE" });
        closeModal();
        state.selectedSessionId = null;
        showToast("Session terminated", "success");
        renderSessions(container);
      }}
    ]);
  });

  /* Event: cleanup (header + footer) */
  const handleCleanup = async () => {
    const cleanRes = await api("/sessions/cleanup", { method: "POST" });
    if (cleanRes.ok) {
      showToast("Cleanup completed", "success");
    } else {
      showToast(cleanRes.data?.error ?? "Cleanup failed", "error");
    }
    renderSessions(container);
  };

  document.getElementById("session-cleanup-btn")?.addEventListener("click", handleCleanup);
  document.getElementById("session-cleanup-footer")?.addEventListener("click", handleCleanup);

  /* Event: reflect all unreflected sessions */
  document.getElementById("session-reflect-all")?.addEventListener("click", async () => {
    const r = await api("/sessions/reflect-all", { method: "POST" });
    if (r.ok) {
      const d = r.data ?? {};
      showToast("Reflected " + (d.reflected ?? 0) + " sessions" + (d.failed ? " (" + d.failed + " failed)" : ""), "success");
    } else {
      showToast(r.data?.error ?? "Reflect all failed", "error");
    }
    renderSessions(container);
  });
}

/* ================================================================
   11.9. Knowledge Graph
   ================================================================ */

async function renderGraph(container) {
  container.textContent = "";

  const wrap = document.createElement("div");
  wrap.className = "space-y-6";

  /* Header */
  const header = document.createElement("div");
  header.className = "flex items-center justify-between";

  const title = document.createElement("h2");
  title.className = "text-2xl font-headline font-bold tracking-tight";
  title.textContent = "Knowledge Graph";
  header.appendChild(title);

  const statsSpan = document.createElement("span");
  statsSpan.id = "graph-stats";
  statsSpan.className = "text-sm text-slate-400 font-mono";
  statsSpan.textContent = "--";
  header.appendChild(statsSpan);

  wrap.appendChild(header);

  /* Controls */
  const controls = document.createElement("div");
  controls.className = "glass-panel p-4 rounded-sm flex items-center gap-4 flex-wrap";

  const topicInput = document.createElement("input");
  topicInput.type = "text";
  topicInput.id = "graph-topic";
  topicInput.placeholder = "Topic filter";
  topicInput.className = "bg-surface-container border border-outline-variant/30 rounded-sm px-3 py-1.5 text-sm text-on-surface focus:border-primary focus:outline-none w-48";

  const limitLabel = document.createElement("label");
  limitLabel.className = "text-sm text-slate-400 flex items-center gap-2";
  limitLabel.textContent = "Limit: ";

  const limitRange = document.createElement("input");
  limitRange.type = "range";
  limitRange.id = "graph-limit";
  limitRange.min = "10";
  limitRange.max = "10000";
  limitRange.value = "50";
  limitRange.step = "10";
  limitRange.className = "w-32 accent-primary";

  const limitValue = document.createElement("span");
  limitValue.id = "graph-limit-value";
  limitValue.className = "font-mono text-on-surface w-8";
  limitValue.textContent = "50";

  limitRange.addEventListener("input", () => {
    limitValue.textContent = limitRange.value;
  });

  limitLabel.appendChild(limitRange);
  limitLabel.appendChild(limitValue);

  const loadBtn = document.createElement("button");
  loadBtn.className = "btn btn-primary";
  loadBtn.textContent = "LOAD";
  loadBtn.addEventListener("click", loadGraph);

  const keySelect   = document.createElement("select");
  keySelect.id      = "graph-key-id";
  keySelect.className = "bg-surface-container border border-outline-variant/30 rounded-sm px-3 py-1.5 text-sm text-on-surface focus:border-primary focus:outline-none";

  const keyOptAll   = document.createElement("option");
  keyOptAll.value   = "";
  keyOptAll.textContent = "All keys";
  keySelect.appendChild(keyOptAll);

  const groupSelect = document.createElement("select");
  groupSelect.id    = "graph-group-id";
  groupSelect.className = "bg-surface-container border border-outline-variant/30 rounded-sm px-3 py-1.5 text-sm text-on-surface focus:border-primary focus:outline-none";

  const grpOptAll   = document.createElement("option");
  grpOptAll.value   = "";
  grpOptAll.textContent = "All groups";
  groupSelect.appendChild(grpOptAll);

  /** keySelect 변경 시 groupSelect 리셋 (상호 배타적 필터) */
  keySelect.addEventListener("change",   () => { if (keySelect.value)   groupSelect.value = ""; });
  groupSelect.addEventListener("change", () => { if (groupSelect.value) keySelect.value   = ""; });

  /** /admin/keys 와 /admin/groups 비동기 로딩 */
  (async () => {
    const [keysR, groupsR] = await Promise.all([
      api("/keys"),
      api("/groups"),
    ]);
    if (keysR.ok && Array.isArray(keysR.data)) {
      for (const k of keysR.data) {
        const opt = document.createElement("option");
        opt.value       = String(k.id);
        opt.textContent = k.name || k.key_prefix || String(k.id);
        keySelect.appendChild(opt);
      }
    }
    if (groupsR.ok && Array.isArray(groupsR.data)) {
      for (const g of groupsR.data) {
        const opt = document.createElement("option");
        opt.value       = String(g.id);
        opt.textContent = g.name || String(g.id);
        groupSelect.appendChild(opt);
      }
    }
  })();

  controls.appendChild(topicInput);
  controls.appendChild(keySelect);
  controls.appendChild(groupSelect);
  controls.appendChild(limitLabel);
  controls.appendChild(loadBtn);

  /* Legend */
  const TYPE_COLORS = {
    fact: "#5b8ef0", decision: "#8b5cf6", error: "#ef4444",
    procedure: "#22c55e", preference: "#f59e0b", relation: "#6b7280",
    episode: "#ec4899"
  };
  const legend = document.createElement("div");
  legend.className = "flex items-center gap-3 ml-auto";
  for (const [t, c] of Object.entries(TYPE_COLORS)) {
    const chip = document.createElement("span");
    chip.className = "flex items-center gap-1 text-xs text-slate-400";
    const dot = document.createElement("span");
    dot.className = "inline-block w-2.5 h-2.5 rounded-full";
    dot.style.backgroundColor = c;
    chip.appendChild(dot);
    chip.appendChild(document.createTextNode(t));
    legend.appendChild(chip);
  }
  controls.appendChild(legend);

  wrap.appendChild(controls);

  /* Graph Tooltip */
  const tooltip = document.createElement("div");
  tooltip.id = "graph-tooltip";
  Object.assign(tooltip.style, {
    position:      "fixed",
    display:       "none",
    maxWidth:      "280px",
    background:    "rgba(8,12,28,0.92)",
    border:        "1px solid rgba(120,160,220,0.25)",
    borderRadius:  "10px",
    padding:       "12px 14px",
    fontSize:      "12px",
    lineHeight:    "1.6",
    color:         "#d4dff0",
    backdropFilter:"blur(12px)",
    boxShadow:     "0 4px 24px rgba(0,0,0,0.6), 0 0 12px rgba(80,120,200,0.12)",
    pointerEvents: "none",
    zIndex:        "9999",
    transition:    "opacity 0.12s ease",
  });
  document.body.appendChild(tooltip);

  /* SVG Canvas */
  const canvasWrap = document.createElement("div");
  canvasWrap.style.position = "relative";
  canvasWrap.className = "glass-panel rounded-sm overflow-hidden";

  const svgNS = "http://www.w3.org/2000/svg";
  const svg   = document.createElementNS(svgNS, "svg");
  svg.id = "graph-canvas";
  svg.setAttribute("width", "100%");
  svg.style.minHeight       = "600px";
  svg.style.height          = "clamp(600px, 60vh, 1200px)";
  svg.style.backgroundColor = "#0e1322";
  canvasWrap.appendChild(svg);

  wrap.appendChild(canvasWrap);
  container.appendChild(wrap);

  /* Auto-load */
  loadGraph();
}

let _moonRafId = null; // 위성 애니메이션 rAF ID — 재로딩 시 취소

async function loadGraph() {
  if (_moonRafId !== null) { cancelAnimationFrame(_moonRafId); _moonRafId = null; }
  const topic   = document.getElementById("graph-topic")?.value   || "";
  const limit   = document.getElementById("graph-limit")?.value   || "50";
  const keyId   = document.getElementById("graph-key-id")?.value  || "";
  const groupId = document.getElementById("graph-group-id")?.value || "";

  const params = new URLSearchParams({ limit });
  if (topic)   params.set("topic",    topic);
  if (keyId)   params.set("key_id",   keyId);
  else if (groupId) params.set("group_id", groupId);

  const res = await api(`/memory/graph?${params.toString()}`);

  if (!res.ok || !res.data) {
    showToast("그래프 데이터 로딩 실패", "error");
    return;
  }
  const data = res.data;

  if (typeof d3 === "undefined") {
    showToast("D3.js가 로드되지 않았습니다", "error");
    return;
  }

  const TYPE_COLORS = {
    fact:       { base: "#5592d0", light: "#9ec4e8", dark: "#2a4f8a", link: "#4582c0" },
    decision:   { base: "#8878d0", light: "#bcb0e8", dark: "#3c2880", link: "#7868c0" },
    error:      { base: "#c05050", light: "#e49090", dark: "#701c1c", link: "#b04040" },
    procedure:  { base: "#50a870", light: "#8ccca8", dark: "#1c5835", link: "#409860" },
    preference: { base: "#d09820", light: "#e8c870", dark: "#785810", link: "#c08810" },
    relation:   { base: "#6080a0", light: "#a0b8cc", dark: "#304860", link: "#507090" },
    episode:    { base: "#b85898", light: "#dca0c8", dark: "#682858", link: "#a84888" },
  };
  const FALLBACK = TYPE_COLORS.relation;

  /**
   * 노드 밝기 계수 — 항성/행성 밝기 차이 모사
   * - anchor/pinned: 200%
   * - preference: 140%
   * - 나머지: ±30% 결정적 난수 (node id 기반)
   */
  const nodeBrightness = (d) => {
    if (d.is_anchor || d.pinned || d.anchor) return 2.0;
    if (d.type === "preference") return 1.4;
    const seed = (d.id || "").split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    return 0.7 + (Math.sin(seed * 91.3 + 17.7) * 0.5 + 0.5) * 0.6; // 0.70 ~ 1.30
  };

  const svg = d3.select("#graph-canvas");
  svg.selectAll("*").remove();

  const width  = svg.node().clientWidth  || 800;
  const height = svg.node().clientHeight || 600;
  svg.attr("viewBox", `0 0 ${width} ${height}`);

  const nodeById = new Map(data.nodes.map(n => [n.id, n]));
  const nodeIds  = new Set(data.nodes.map(n => n.id));
  const links    = data.edges
    .filter(e => nodeIds.has(e.from_id) && nodeIds.has(e.to_id))
    .map(e => ({ source: e.from_id, target: e.to_id, type: e.relation_type, weight: e.weight }));

  /** ── SVG Defs: 필터 + 그라데이션 ── */
  const defs = svg.append("defs");

  /** 노드 글로우 필터 (normal) */
  const fNodeNorm = defs.append("filter")
    .attr("id", "nodeGlow").attr("x", "-60%").attr("y", "-60%")
    .attr("width", "220%").attr("height", "220%");
  fNodeNorm.append("feGaussianBlur").attr("in", "SourceGraphic").attr("stdDeviation", "4").attr("result", "blur");
  const mNodeNorm = fNodeNorm.append("feMerge");
  mNodeNorm.append("feMergeNode").attr("in", "blur");
  mNodeNorm.append("feMergeNode").attr("in", "blur");
  mNodeNorm.append("feMergeNode").attr("in", "SourceGraphic");

  /** 노드 글로우 필터 (hover — 10% 강화) */
  const fNodeHov = defs.append("filter")
    .attr("id", "nodeGlowHover").attr("x", "-80%").attr("y", "-80%")
    .attr("width", "260%").attr("height", "260%");
  fNodeHov.append("feGaussianBlur").attr("in", "SourceGraphic").attr("stdDeviation", "6").attr("result", "blur");
  const mNodeHov = fNodeHov.append("feMerge");
  mNodeHov.append("feMergeNode").attr("in", "blur");
  mNodeHov.append("feMergeNode").attr("in", "blur");
  mNodeHov.append("feMergeNode").attr("in", "blur");
  mNodeHov.append("feMergeNode").attr("in", "SourceGraphic");

  /** 링크 글로우 필터 (normal) */
  const fLinkNorm = defs.append("filter")
    .attr("id", "linkGlow").attr("x", "-20%").attr("y", "-400%")
    .attr("width", "140%").attr("height", "900%");
  fLinkNorm.append("feGaussianBlur").attr("in", "SourceGraphic").attr("stdDeviation", "2").attr("result", "blur");
  const mLinkNorm = fLinkNorm.append("feMerge");
  mLinkNorm.append("feMergeNode").attr("in", "blur");
  mLinkNorm.append("feMergeNode").attr("in", "SourceGraphic");

  /** 링크 글로우 필터 (hover) */
  const fLinkHov = defs.append("filter")
    .attr("id", "linkGlowHover").attr("x", "-20%").attr("y", "-400%")
    .attr("width", "140%").attr("height", "900%");
  fLinkHov.append("feGaussianBlur").attr("in", "SourceGraphic").attr("stdDeviation", "3.5").attr("result", "blur");
  const mLinkHov = fLinkHov.append("feMerge");
  mLinkHov.append("feMergeNode").attr("in", "blur");
  mLinkHov.append("feMergeNode").attr("in", "blur");
  mLinkHov.append("feMergeNode").attr("in", "SourceGraphic");

  /** 성운(nebula) 방사형 그라데이션 — 매우 절제된 색조 */
  [
    ["#101828", "#070b18"],
    ["#141228", "#08060f"],
    ["#1a0f10", "#090507"],
    ["#0c1810", "#060a07"],
    ["#161108", "#090704"],
  ].forEach(([inner, outer], i) => {
    const rg = defs.append("radialGradient")
      .attr("id", `nebula-${i}`).attr("cx", "50%").attr("cy", "50%").attr("r", "50%");
    rg.append("stop").attr("offset", "0%").attr("stop-color", inner).attr("stop-opacity", "0.9");
    rg.append("stop").attr("offset", "100%").attr("stop-color", outer).attr("stop-opacity", "0");
  });

  /** 타입별 노드 방사형 그라데이션 (구형 광원 효과) */
  Object.entries(TYPE_COLORS).forEach(([type, c]) => {
    const rg = defs.append("radialGradient")
      .attr("id", `grad-${type}`).attr("cx", "35%").attr("cy", "35%").attr("r", "65%");
    rg.append("stop").attr("offset", "0%").attr("stop-color", c.light).attr("stop-opacity", "0.95");
    rg.append("stop").attr("offset", "55%").attr("stop-color", c.base);
    rg.append("stop").attr("offset", "100%").attr("stop-color", c.dark);
  });

  /** ── 배경: 은하계 스타필드 (zoom 영향 없는 고정 레이어) ── */
  const bg = svg.append("g").attr("class", "bg-layer").style("pointer-events", "none");

  /* 딥스페이스 바탕 */
  bg.append("rect").attr("width", width).attr("height", height).attr("fill", "#070b18");

  /* 성운 블롭 */
  [
    { x: width * 0.15, y: height * 0.25, rx: width * 0.35, ry: height * 0.45, idx: 0 },
    { x: width * 0.72, y: height * 0.65, rx: width * 0.30, ry: height * 0.40, idx: 1 },
    { x: width * 0.50, y: height * 0.05, rx: width * 0.25, ry: height * 0.30, idx: 2 },
    { x: width * 0.88, y: height * 0.18, rx: width * 0.20, ry: height * 0.28, idx: 3 },
    { x: width * 0.08, y: height * 0.80, rx: width * 0.22, ry: height * 0.30, idx: 4 },
  ].forEach(n => {
    bg.append("ellipse")
      .attr("cx", n.x).attr("cy", n.y).attr("rx", n.rx).attr("ry", n.ry)
      .attr("fill", `url(#nebula-${n.idx})`).attr("opacity", 0.5);
  });

  /* 별 — 결정적 의사난수(seed 기반) */
  const rng = s => { const x = Math.sin(s + 1) * 10000; return x - Math.floor(x); };
  for (let i = 0; i < 220; i++) {
    const r  = rng(i * 3 + 2) * 1.4 + 0.2;
    const op = rng(i * 7 + 5) * 0.55 + 0.15;
    bg.append("circle")
      .attr("cx", rng(i * 3 + 0) * width)
      .attr("cy", rng(i * 3 + 1) * height)
      .attr("r",  r).attr("fill", "white").attr("opacity", op);
  }
  /* 밝은 별 (글로우) */
  for (let i = 0; i < 18; i++) {
    bg.append("circle")
      .attr("cx", rng(i * 11 + 100) * width)
      .attr("cy", rng(i * 11 + 101) * height)
      .attr("r", rng(i * 11 + 102) * 1.2 + 0.8)
      .attr("fill", "white").attr("opacity", 0.85)
      .attr("filter", "url(#nodeGlow)");
  }

  /** ── zoom + pan ── */
  const zoomBehavior = d3.zoom()
    .scaleExtent([0.1, 5])
    .on("zoom", (e) => g.attr("transform", e.transform));
  svg.call(zoomBehavior);

  /** zoom 가능한 메인 그래프 레이어 */
  const g = svg.append("g");

  /** ── 행성 장식 데이터 (결정적 난수) ── */
  const nodeR    = d => 4 + (d.importance || 0.5) * 10;
  const fragRng  = (id, salt) => {
    const seed = (id || "").split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    const x    = Math.sin(seed * salt + 1) * 10000;
    return x - Math.floor(x); // 0~1
  };

  const planetData = [];
  data.nodes.forEach(d => {
    if (d.is_anchor || d.pinned || d.anchor) return; // 항성(앵커)은 제외
    if (fragRng(d.id, 47.3) > 0.55) return;          // ~55% 노드만 행성화

    const hasRing   = fragRng(d.id, 13.7) < 0.40;
    const nMoons    = Math.floor(fragRng(d.id, 31.1) * 3.7);
    const ringTilt  = 0.16 + fragRng(d.id, 5.3)  * 0.30;       // 납작도
    const ringRot   = (fragRng(d.id, 9.1) - 0.5) * 60;         // 기울기 ±30°
    const ringSizeM = 1.7  + fragRng(d.id, 71.3) * 0.9;        // 크기 배율 1.7~2.6
    const ringWidth = 0.35 + fragRng(d.id, 83.7) * 0.9;        // 두께 0.35~1.25
    /* 색상: base/light/dark 중 가중 혼합 (밝은 쪽 편향) */
    const ringColorIdx = fragRng(d.id, 97.1);                   // 0~1
    const ringOpacity  = 0.25 + fragRng(d.id, 61.9) * 0.30;    // 투명도 0.25~0.55

    const moons = Array.from({ length: nMoons }, (_, i) => ({
      orbitR:  nodeR(d) * (1.85 + fragRng(d.id, 17.3 + i * 7) * 1.1),
      period:  5 + fragRng(d.id, 23.7 + i * 11) * 10,  // 5~15초
      phase:   fragRng(d.id, 37.1 + i * 13) * Math.PI * 2,
      r:       0.9 + fragRng(d.id, 43.3 + i * 7) * 1.4,
      yScale:  0.45 + fragRng(d.id, 59.1 + i * 3) * 0.35, // 궤도 납작도
    }));

    planetData.push({ node: d, hasRing, ringTilt, ringRot, ringSizeM, ringWidth, ringColorIdx, ringOpacity, moons });
  });

  /** 행성 장식 레이어 — 노드/링크보다 뒤에 렌더 */
  const decoG = g.append("g").attr("class", "planet-deco-layer");

  /** 고리 */
  planetData.filter(p => p.hasRing).forEach(p => {
    const r   = nodeR(p.node);
    const tc  = TYPE_COLORS[p.node.type] || FALLBACK;
    /* 색상: idx < 0.45 → light, 0.45~0.75 → base, > 0.75 → 중간 혼합 */
    const ringColor = p.ringColorIdx < 0.45 ? tc.light
                    : p.ringColorIdx < 0.75 ? tc.base
                    : tc.link;
    const ell = decoG.append("ellipse")
      .attr("data-pid", p.node.id)
      .attr("rx", r * p.ringSizeM)
      .attr("ry", r * p.ringSizeM * p.ringTilt)
      .attr("fill", "none")
      .attr("stroke", ringColor)
      .attr("stroke-width", r * p.ringWidth * 0.08 + p.ringWidth * 0.3)
      .attr("stroke-opacity", p.ringOpacity)
      .attr("filter", "url(#linkGlow)");
    p._ringEl = ell;
  });

  /** 위성 */
  const moonEntries = [];
  planetData.forEach(p => {
    const tc = TYPE_COLORS[p.node.type] || FALLBACK;
    p.moons.forEach(m => {
      const moonEl = decoG.append("circle")
        .attr("r", m.r)
        .attr("fill", tc.light)
        .attr("fill-opacity", 0.72)
        .attr("filter", "url(#nodeGlow)");
      moonEntries.push({ el: moonEl, planet: p, moon: m });
    });
  });

  /** ── Force Simulation ── */
  const chargeStrength = data.nodes.length > 80 ? -80 : data.nodes.length > 30 ? -150 : -200;

  const sim = d3.forceSimulation(data.nodes)
    .force("link",    d3.forceLink(links).id(d => d.id).distance(80))
    .force("charge",  d3.forceManyBody().strength(chargeStrength))
    .force("center",  d3.forceCenter(width / 2, height / 2))
    .force("collide", d3.forceCollide().radius(d => 8 + (d.importance || 0.5) * 10));

  /** 링크 색상 헬퍼 — 소스 노드 타입 기준 */
  const linkColor = (d) => {
    const srcId   = typeof d.source === "object" ? d.source.id : d.source;
    const srcType = nodeById.get(srcId)?.type;
    return (TYPE_COLORS[srcType] || FALLBACK).link;
  };

  /** ── 링크 레이어 ── */
  const linkGroup = g.append("g");

  /* 글로우 후광 (블러 레이어) */
  const linkGlow = linkGroup.selectAll("line.lg")
    .data(links).join("line").attr("class", "lg")
    .attr("stroke", linkColor)
    .attr("stroke-opacity", 0.22)
    .attr("stroke-width", d => Math.min(8, (d.weight || 1) * 2.5))
    .attr("filter", "url(#linkGlow)");

  /* 코어 라인 */
  const link = linkGroup.selectAll("line.lc")
    .data(links).join("line").attr("class", "lc")
    .attr("stroke", linkColor)
    .attr("stroke-opacity", 0.45)
    .attr("stroke-width", d => Math.min(2.5, d.weight || 1));

  /** ── 노드 레이어 ── */
  const nodeGroup = g.append("g");

  /* 외곽 헤일로 링 — brightness 반영 opacity, 반경 ±10% 랜덤 */
  const halo = nodeGroup.selectAll("circle.hl")
    .data(data.nodes).join("circle").attr("class", "hl")
    .attr("r", d => {
      const seed   = (d.id || "").split("").reduce((a, c) => a + c.charCodeAt(0), 0);
      const jitter = 0.9 + (Math.sin(seed * 53.7 + 9.1) * 0.5 + 0.5) * 0.2; // 0.90 ~ 1.10
      return (4 + (d.importance || 0.5) * 10) * 1.7 * jitter;
    })
    .attr("fill", "none")
    .attr("stroke", d => (TYPE_COLORS[d.type] || FALLBACK).base)
    .attr("stroke-width", 1.2)
    .attr("stroke-opacity", d => Math.min(0.92, 0.28 * nodeBrightness(d)))
    .attr("filter", "url(#nodeGlow)")
    .style("pointer-events", "none");

  /* 노드 본체 — 방사형 그라데이션 + CSS brightness */
  const node = nodeGroup.selectAll("circle.nd")
    .data(data.nodes).join("circle").attr("class", "nd")
    .attr("r", d => 4 + (d.importance || 0.5) * 10)
    .attr("fill", d => `url(#grad-${d.type in TYPE_COLORS ? d.type : "relation"})`)
    .attr("stroke", d => (TYPE_COLORS[d.type] || FALLBACK).light)
    .attr("stroke-width", 1)
    .attr("stroke-opacity", 0.75)
    .style("filter", d => `brightness(${nodeBrightness(d)})`)
    .style("cursor", "grab")
    .call(d3.drag()
      .on("start", (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on("drag",  (e, d) => { d.fx = e.x; d.fy = e.y; })
      .on("end",   (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; })
    );

  /** ── 툴팁 (renderGraph 스코프 외부 → getElementById로 참조) ── */
  const tooltip = document.getElementById("graph-tooltip");

  /** ── 툴팁 헬퍼 (DOM API — XSS 안전) ── */
  const TYPE_LABEL = {
    fact: "사실", decision: "의사결정", error: "오류",
    procedure: "절차", preference: "선호", relation: "관계", episode: "에피소드",
  };
  const relTime = (iso) => {
    if (!iso) return null;
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1)  return "방금";
    if (m < 60) return `${m}분 전`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}시간 전`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d}일 전`;
    return `${Math.floor(d / 30)}개월 전`;
  };
  const bar = (v) => {
    const n = Math.round(Math.min(Math.max(v, 0), 1) * 10);
    return "█".repeat(n) + "░".repeat(10 - n);
  };
  const connCount = (nid) => links.filter(l => {
    const s = typeof l.source === "object" ? l.source.id : l.source;
    const t = typeof l.target === "object" ? l.target.id : l.target;
    return s === nid || t === nid;
  }).length;

  const mk = (tag, css = {}, txt = null) => {
    const el = document.createElement(tag);
    Object.assign(el.style, css);
    if (txt !== null) el.textContent = txt;
    return el;
  };

  const showTooltipFor = (d, event) => {
    if (!tooltip) return;
    while (tooltip.firstChild) tooltip.removeChild(tooltip.firstChild);

    const tc  = TYPE_COLORS[d.type] || FALLBACK;
    const imp = (d.importance || 0).toFixed(2);
    const act = d.ema_activation != null ? d.ema_activation.toFixed(2) : null;

    /* 타입 배지 */
    tooltip.appendChild(mk("span", {
      display: "inline-block", background: `${tc.base}22`,
      border: `1px solid ${tc.base}88`, borderRadius: "4px",
      padding: "1px 7px", fontSize: "11px", color: tc.light, letterSpacing: ".05em",
    }, (TYPE_LABEL[d.type] || d.type).toUpperCase()));

    /* 토픽 */
    if (d.topic) tooltip.appendChild(
      mk("div", { color: "#7090b0", fontSize: "11px", marginTop: "3px" }, d.topic)
    );

    /* 내용 */
    const rawText = d.content || d.label;
    const shown   = rawText.slice(0, 300) + (rawText.length > 300 ? "…" : "");
    tooltip.appendChild(mk("div", {
      margin: "6px 0 4px", color: "#e0eaf8", fontSize: "12px", lineHeight: "1.5",
    }, shown));

    /* 통계 그리드 */
    const grid = mk("div", {
      borderTop: "1px solid rgba(120,160,220,0.15)", margin: "6px 0 0", paddingTop: "6px",
      display: "grid", gridTemplateColumns: "auto 1fr", gap: "3px 12px", fontSize: "11px",
    });
    const row = (label, val, mono = false) => {
      grid.appendChild(mk("span", { color: "#8090b0" }, label));
      grid.appendChild(mk("span", { color: "#b0c0d8", fontFamily: mono ? "monospace" : "" }, val));
    };
    row("중요도", `${bar(parseFloat(imp))} ${imp}`, true);
    row("활성화", act ? `${bar(parseFloat(act))} ${act}` : "—", true);
    row("연결",   `${connCount(d.id)}개`);
    row("조회",   `${d.access_count ?? 0}회`);
    const ct = relTime(d.created_at);
    if (ct) row("생성", ct);
    const at = relTime(d.accessed_at);
    if (at) row("최근 조회", at);
    if (d.session_id) row("세션", d.session_id.slice(0, 16) + "…");
    tooltip.appendChild(grid);

    /* 에피소드 context_summary */
    if (d.context_summary) {
      const cs = d.context_summary.slice(0, 120) + (d.context_summary.length > 120 ? "…" : "");
      tooltip.appendChild(mk("div", {
        fontSize: "11px", color: "#6878a0", marginTop: "6px", fontStyle: "italic",
      }, cs));
    }

    tooltip.style.display = "block";
    const pad = 16, tw = 296;
    const th  = tooltip.offsetHeight || 180;
    let   tx  = event.clientX + 14;
    let   ty  = event.clientY - 10;
    if (tx + tw > window.innerWidth  - pad) tx = event.clientX - tw - 14;
    if (ty + th > window.innerHeight - pad) ty = event.clientY - th + 10;
    tooltip.style.left = `${tx}px`;
    tooltip.style.top  = `${ty}px`;
  };

  /** ── Hover: 10% 강화 글로우 + 툴팁 ── */
  node
    .on("mouseover", function (e, d) {
      const br = Math.min(nodeBrightness(d) * 1.1, 2.2);
      d3.select(this).style("filter", `brightness(${br})`).attr("stroke-opacity", 1);
      halo.filter(h => h.id === d.id)
        .attr("stroke-opacity", Math.min(0.95, 0.28 * br * 1.5))
        .attr("filter", "url(#nodeGlowHover)");
      const isConn = l => {
        const s = typeof l.source === "object" ? l.source.id : l.source;
        const t = typeof l.target === "object" ? l.target.id : l.target;
        return s === d.id || t === d.id;
      };
      link.filter(isConn).attr("stroke-opacity", 0.90).attr("filter", "url(#linkGlowHover)");
      linkGlow.filter(isConn).attr("stroke-opacity", 0.50);
      showTooltipFor(d, e);
    })
    .on("mousemove", (e, d) => showTooltipFor(d, e))
    .on("mouseout", function (e, d) {
      const br = nodeBrightness(d);
      d3.select(this).style("filter", `brightness(${br})`).attr("stroke-opacity", 0.75);
      halo.filter(h => h.id === d.id)
        .attr("stroke-opacity", Math.min(0.92, 0.28 * br))
        .attr("filter", "url(#nodeGlow)");
      link.attr("stroke-opacity", 0.45).attr("filter", null);
      linkGlow.attr("stroke-opacity", 0.22);
      tooltip.style.display = "none";
    });

  /** ── 레이블 ── */
  const labels = g.append("g")
    .selectAll("text")
    .data(data.nodes).join("text")
    .text(d => d.label.slice(0, 20))
    .attr("font-size", "10px")
    .attr("fill", "#cbd5e1")
    .attr("dx", 12).attr("dy", 4)
    .style("pointer-events", "none");

  /** ── Tick ── */
  sim.on("tick", () => {
    linkGlow
      .attr("x1", d => d.source.x).attr("y1", d => d.source.y)
      .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
    link
      .attr("x1", d => d.source.x).attr("y1", d => d.source.y)
      .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
    node.attr("cx",  d => d.x).attr("cy",  d => d.y);
    halo.attr("cx",  d => d.x).attr("cy",  d => d.y);
    labels.attr("x", d => d.x).attr("y",   d => d.y);
    /* 고리 위치 (시뮬레이션 이동 반영) */
    planetData.filter(p => p._ringEl).forEach(p => {
      p._ringEl.attr("cx", p.node.x ?? 0)
               .attr("cy", p.node.y ?? 0)
               .attr("transform", `rotate(${p.ringRot},${p.node.x ?? 0},${p.node.y ?? 0})`);
    });
  });

  /** ── 위성 자전 애니메이션 (rAF) ── */
  const _rafStart = performance.now();
  const _animateMoons = (now) => {
    const t = (now - _rafStart) / 1000; // 초
    moonEntries.forEach(({ el, planet, moon }) => {
      const nx    = planet.node.x ?? 0;
      const ny    = planet.node.y ?? 0;
      const angle = moon.phase + (t / moon.period) * Math.PI * 2;
      el.attr("cx", nx + moon.orbitR * Math.cos(angle))
        .attr("cy", ny + moon.orbitR * Math.sin(angle) * moon.yScale);
    });
    _moonRafId = requestAnimationFrame(_animateMoons);
  };
  if (moonEntries.length > 0) _moonRafId = requestAnimationFrame(_animateMoons);

  /** 초기 줌: simulation 안정 후 전체 노드가 보이도록 fit */
  sim.on("end", () => {
    const bounds = g.node().getBBox();
    if (bounds.width === 0 || bounds.height === 0) return;
    const pad    = 40;
    const scale  = Math.min(
      width  / (bounds.width  + pad * 2),
      height / (bounds.height + pad * 2),
      1.5
    );
    const tx = width  / 2 - (bounds.x + bounds.width  / 2) * scale;
    const ty = height / 2 - (bounds.y + bounds.height / 2) * scale;
    svg.transition().duration(500)
      .call(zoomBehavior.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
  });

  const statsEl = document.getElementById("graph-stats");
  if (statsEl) {
    statsEl.textContent = `${data.nodes.length} nodes, ${links.length} edges`;
  }
}

/* ================================================================
   11.8. Log Viewer
   ================================================================ */

async function renderLogs(container) {
  container.textContent = "";
  container.appendChild(loadingHtml());

  const [statsRes, filesRes] = await Promise.all([
    api("/logs/stats"),
    api("/logs/files")
  ]);

  state.logStats = statsRes.ok ? statsRes.data : null;
  state.logFiles = filesRes.ok ? (filesRes.data?.files ?? []) : [];

  if (!state.logFile && state.logFiles.length) {
    const today = state.logFiles.find(f => f.type === "combined");
    if (today) state.logFile = today.name;
  }

  if (state.logFile) {
    const params = new URLSearchParams({ file: state.logFile, tail: state.logTail });
    if (state.logLevel)  params.set("level", state.logLevel);
    if (state.logSearch) params.set("search", state.logSearch);
    const readRes = await api("/logs/read?" + params);
    state.logLines = readRes.ok ? (readRes.data?.lines ?? []) : [];
  }

  container.textContent = "";

  /* Header */
  const header = document.createElement("div");
  header.className = "flex justify-between items-end mb-8";
  const headerLeft = document.createElement("div");
  const h2 = document.createElement("h2");
  h2.className = "text-2xl font-headline font-bold text-on-surface tracking-tight";
  h2.textContent = "System Logs";
  headerLeft.appendChild(h2);
  const subtitle = document.createElement("p");
  subtitle.className = "text-sm text-slate-400 mt-1";
  subtitle.textContent = "Winston log files viewer and level filtering.";
  headerLeft.appendChild(subtitle);
  header.appendChild(headerLeft);

  const refreshBtn = document.createElement("button");
  refreshBtn.className = "btn-primary px-5 py-2.5 bg-primary-container text-on-primary-fixed font-bold text-sm flex items-center gap-2";
  const refreshIcon = document.createElement("span");
  refreshIcon.className = "material-symbols-outlined text-lg";
  refreshIcon.textContent = "refresh";
  refreshBtn.appendChild(refreshIcon);
  refreshBtn.appendChild(document.createTextNode("REFRESH"));
  refreshBtn.addEventListener("click", () => renderLogs(container));
  header.appendChild(refreshBtn);
  container.appendChild(header);

  /* KPI Row */
  container.appendChild(renderLogKpiRow(state.logStats));

  /* Main layout: viewer + sidebar */
  const split = document.createElement("div");
  split.className = "flex gap-6";

  const left = document.createElement("div");
  left.className = "flex-1 space-y-4";
  left.appendChild(renderLogFilterBar());
  left.appendChild(renderLogViewer(state.logLines));
  split.appendChild(left);

  split.appendChild(renderLogSidebar(state.logFiles, state.logStats));
  container.appendChild(split);

  /* Event: apply filter */
  document.getElementById("log-apply-btn")?.addEventListener("click", () => {
    state.logFile   = document.getElementById("log-file-select")?.value ?? "";
    state.logLevel  = document.getElementById("log-level-select")?.value ?? "";
    state.logSearch = document.getElementById("log-search-input")?.value ?? "";
    state.logTail   = parseInt(document.getElementById("log-tail-select")?.value) || 200;
    renderLogs(container);
  });

  /* Event: sidebar file click */
  container.querySelectorAll("[data-log-file]").forEach(el => {
    el.addEventListener("click", () => {
      state.logFile = el.dataset.logFile;
      renderLogs(container);
    });
  });
}

function renderLogKpiRow(stats) {
  const today = stats?.today ?? {};
  const cards = [
    { label: "INFO",  value: today.info ?? 0,         border: "bg-primary" },
    { label: "WARN",  value: today.warn ?? 0,         border: "bg-secondary" },
    { label: "ERROR", value: today.error ?? 0,        border: "bg-error" },
    { label: "FILES", value: stats?.fileCount ?? 0,   border: "bg-tertiary" }
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

function renderLogFilterBar() {
  const bar = document.createElement("div");
  bar.className = "flex items-center gap-3 bg-surface-container-low p-3 rounded-sm border-l-2 border-primary/40";

  /* File select */
  const fileSelect = document.createElement("select");
  fileSelect.id = "log-file-select";
  fileSelect.className = "bg-surface-container text-[11px] text-on-surface border border-white/10 rounded-sm px-2 py-1.5 outline-none";

  const grouped = {};
  state.logFiles.forEach(f => {
    const key = f.type || "other";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(f);
  });

  Object.keys(grouped).forEach(type => {
    const optgroup = document.createElement("optgroup");
    optgroup.label = type.toUpperCase();
    grouped[type].forEach(f => {
      const opt = document.createElement("option");
      opt.value    = f.name;
      opt.selected = f.name === state.logFile;
      opt.textContent = f.name;
      optgroup.appendChild(opt);
    });
    fileSelect.appendChild(optgroup);
  });
  bar.appendChild(fileSelect);

  /* Level filter */
  const levelSelect = document.createElement("select");
  levelSelect.id = "log-level-select";
  levelSelect.className = "bg-surface-container text-[11px] text-on-surface border border-white/10 rounded-sm px-2 py-1.5 outline-none";
  ["", "info", "warn", "error", "debug"].forEach(lv => {
    const opt  = document.createElement("option");
    opt.value    = lv;
    opt.selected = lv === state.logLevel;
    opt.textContent = lv ? lv.toUpperCase() : "ALL";
    levelSelect.appendChild(opt);
  });
  bar.appendChild(levelSelect);

  /* Search input */
  const searchInput = document.createElement("input");
  searchInput.type        = "text";
  searchInput.id          = "log-search-input";
  searchInput.placeholder = "Search logs...";
  searchInput.value       = state.logSearch;
  searchInput.className   = "flex-1 bg-surface-container text-[11px] text-on-surface border border-white/10 rounded-sm px-3 py-1.5 outline-none placeholder:text-slate-500";
  bar.appendChild(searchInput);

  /* Tail count */
  const tailSelect = document.createElement("select");
  tailSelect.id = "log-tail-select";
  tailSelect.className = "bg-surface-container text-[11px] text-on-surface border border-white/10 rounded-sm px-2 py-1.5 outline-none";
  [100, 200, 500, 1000].forEach(n => {
    const opt  = document.createElement("option");
    opt.value    = String(n);
    opt.selected = n === state.logTail;
    opt.textContent = n + " lines";
    tailSelect.appendChild(opt);
  });
  bar.appendChild(tailSelect);

  /* Apply button */
  const applyBtn = document.createElement("button");
  applyBtn.id = "log-apply-btn";
  applyBtn.className = "btn px-3 py-1.5 flex items-center gap-1";
  const applyIcon = document.createElement("span");
  applyIcon.className = "material-symbols-outlined text-sm";
  applyIcon.textContent = "search";
  applyBtn.appendChild(applyIcon);
  bar.appendChild(applyBtn);

  return bar;
}

function renderLogViewer(lines) {
  const panel = document.createElement("div");
  panel.className = "glass-panel rounded-sm overflow-hidden";

  /* Header bar */
  const headerBar = document.createElement("div");
  headerBar.className = "bg-surface-container-highest px-6 py-3 flex justify-between items-center";
  const titleEl = document.createElement("span");
  titleEl.className = "text-[10px] font-bold text-slate-400 tracking-widest uppercase font-label";
  titleEl.textContent = "LOG_OUTPUT";
  headerBar.appendChild(titleEl);
  const countEl = document.createElement("span");
  countEl.className = "text-[10px] text-slate-500";
  countEl.textContent = lines.length + " lines";
  headerBar.appendChild(countEl);
  panel.appendChild(headerBar);

  /* Content */
  const content = document.createElement("div");
  content.className = "p-0 overflow-y-auto";
  content.style.maxHeight = "600px";

  if (lines.length === 0) {
    const empty = document.createElement("div");
    empty.className = "text-center text-slate-500 text-sm py-16";
    empty.textContent = "\uB85C\uADF8 \uC5C6\uC74C";
    content.appendChild(empty);
  } else {
    const levelColors = {
      info:  "text-cyan-400",
      warn:  "text-[#dcb8ff]",
      error: "text-[#ffb4ab]",
      debug: "text-slate-600"
    };

    lines.forEach(line => {
      const row = document.createElement("div");
      row.className = "px-6 py-1 font-mono text-[11px] border-b border-white/[0.02] hover:bg-white/[0.02]";

      /* Timestamp */
      if (line.timestamp) {
        const ts = document.createElement("span");
        ts.className = "text-slate-500 mr-2";
        ts.textContent = line.timestamp;
        row.appendChild(ts);
      }

      /* Level badge */
      if (line.level) {
        const lv     = line.level.toLowerCase();
        const badge  = document.createElement("span");
        const color  = levelColors[lv] ?? "text-slate-500";
        badge.className = color + (lv === "error" ? " font-bold" : "") + " mr-2";
        badge.textContent = "[" + line.level.toUpperCase() + "]";
        row.appendChild(badge);
      }

      /* Message */
      const msg = document.createElement("span");
      msg.className = "text-slate-300";
      msg.textContent = line.message ?? (typeof line === "string" ? line : JSON.stringify(line));
      row.appendChild(msg);

      content.appendChild(row);
    });
  }

  panel.appendChild(content);
  return panel;
}

function renderLogSidebar(files, stats) {
  const sidebar = document.createElement("div");
  sidebar.className = "w-80 space-y-6";

  /* File Browser */
  const fileBrowser = document.createElement("div");
  fileBrowser.className = "glass-panel";

  const fbHeader = document.createElement("div");
  fbHeader.className = "px-4 py-3 border-b border-white/5";
  const fbTitle = document.createElement("span");
  fbTitle.className = "text-[10px] font-bold text-slate-400 tracking-widest uppercase font-label";
  fbTitle.textContent = "LOG FILES";
  fbHeader.appendChild(fbTitle);
  fileBrowser.appendChild(fbHeader);

  const iconMap = {
    combined:   "description",
    error:      "error_outline",
    agent:      "smart_toy",
    exceptions: "bug_report",
    rejections: "cancel"
  };

  /* Group files by date (newest first) */
  const byDate = {};
  files.forEach(f => {
    const dateKey = f.date ?? "unknown";
    if (!byDate[dateKey]) byDate[dateKey] = [];
    byDate[dateKey].push(f);
  });
  const dateKeys = Object.keys(byDate).sort().reverse();

  const fileList = document.createElement("div");
  fileList.className = "divide-y divide-white/5";

  dateKeys.forEach(dateKey => {
    const dateLabel = document.createElement("div");
    dateLabel.className = "px-4 py-2 text-[9px] font-bold text-slate-600 tracking-widest uppercase bg-white/[0.02]";
    dateLabel.textContent = dateKey;
    fileList.appendChild(dateLabel);

    byDate[dateKey].forEach(f => {
      const row = document.createElement("div");
      row.className = "flex justify-between items-center px-4 py-2 hover:bg-white/5 cursor-pointer transition-colors" + (f.name === state.logFile ? " bg-white/[0.04]" : "");
      row.dataset.logFile = f.name;

      const leftPart = document.createElement("div");
      leftPart.className = "flex items-center gap-2";
      const icon = document.createElement("span");
      icon.className = "material-symbols-outlined text-sm text-slate-500";
      icon.textContent = iconMap[f.type] ?? "description";
      leftPart.appendChild(icon);
      const nameEl = document.createElement("span");
      nameEl.className = "text-[11px] font-mono text-slate-300";
      nameEl.textContent = f.name;
      leftPart.appendChild(nameEl);
      row.appendChild(leftPart);

      const sizeEl = document.createElement("span");
      sizeEl.className = "text-[10px] text-slate-500";
      sizeEl.textContent = fmtBytes(f.sizeBytes);
      row.appendChild(sizeEl);

      fileList.appendChild(row);
    });
  });

  fileBrowser.appendChild(fileList);
  sidebar.appendChild(fileBrowser);

  /* Recent Errors */
  const errPanel = document.createElement("div");
  errPanel.className = "glass-panel";

  const errHeader = document.createElement("div");
  errHeader.className = "px-4 py-3 border-b border-white/5";
  const errTitle = document.createElement("span");
  errTitle.className = "text-[10px] font-bold text-error tracking-widest uppercase font-label";
  errTitle.textContent = "RECENT ERRORS";
  errHeader.appendChild(errTitle);
  errPanel.appendChild(errHeader);

  const errList = document.createElement("div");
  errList.className = "p-4 space-y-3";
  const recentErrors = stats?.recentErrors ?? [];

  if (recentErrors.length === 0) {
    const noErr = document.createElement("p");
    noErr.className = "text-[11px] text-slate-600 text-center py-4";
    noErr.textContent = "No errors today";
    errList.appendChild(noErr);
  } else {
    recentErrors.slice(0, 5).forEach(err => {
      const item = document.createElement("div");
      item.className = "text-[11px]";
      const tsEl = document.createElement("div");
      tsEl.className = "text-[10px] text-slate-500 mb-0.5";
      tsEl.textContent = err.timestamp ?? "";
      item.appendChild(tsEl);
      const msgEl = document.createElement("div");
      msgEl.className = "text-error font-mono";
      msgEl.textContent = truncate(err.message ?? "", 80);
      item.appendChild(msgEl);
      errList.appendChild(item);
    });
  }

  errPanel.appendChild(errList);
  sidebar.appendChild(errPanel);

  /* Disk Usage */
  const diskPanel = document.createElement("div");
  diskPanel.className = "glass-panel p-4 space-y-2";

  const diskTitle = document.createElement("span");
  diskTitle.className = "text-[10px] font-bold text-slate-400 tracking-widest uppercase font-label";
  diskTitle.textContent = "DISK USAGE";
  diskPanel.appendChild(diskTitle);

  const totalRow = document.createElement("div");
  totalRow.className = "flex justify-between text-[11px] mt-2";
  const totalLabel = document.createElement("span");
  totalLabel.className = "text-slate-500";
  totalLabel.textContent = "Total size";
  totalRow.appendChild(totalLabel);
  const totalVal = document.createElement("span");
  totalVal.className = "text-on-surface font-mono";
  totalVal.textContent = fmtBytes(stats?.totalSizeBytes);
  totalRow.appendChild(totalVal);
  diskPanel.appendChild(totalRow);

  const rangeRow = document.createElement("div");
  rangeRow.className = "flex justify-between text-[11px]";
  const rangeLabel = document.createElement("span");
  rangeLabel.className = "text-slate-500";
  rangeLabel.textContent = "Date range";
  rangeRow.appendChild(rangeLabel);
  const rangeVal = document.createElement("span");
  rangeVal.className = "text-on-surface font-mono text-[10px]";
  rangeVal.textContent = (stats?.oldestFile ?? "?") + " ~ " + (stats?.newestFile ?? "?");
  rangeRow.appendChild(rangeVal);
  diskPanel.appendChild(rangeRow);

  const countRow = document.createElement("div");
  countRow.className = "flex justify-between text-[11px]";
  const countLabel = document.createElement("span");
  countLabel.className = "text-slate-500";
  countLabel.textContent = "File count";
  countRow.appendChild(countLabel);
  const countVal = document.createElement("span");
  countVal.className = "text-on-surface font-mono";
  countVal.textContent = String(stats?.fileCount ?? 0);
  countRow.appendChild(countVal);
  diskPanel.appendChild(countRow);

  sidebar.appendChild(diskPanel);

  return sidebar;
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

  /* Group chip */
  const groupChip = document.createElement("div");
  groupChip.className = "px-3 py-1 bg-surface-variant text-[10px] font-bold flex items-center gap-2 rounded-sm text-slate-400";
  const groupSelect = document.createElement("select");
  groupSelect.id = "filter-group";
  groupSelect.className = "bg-transparent border-none outline-none text-[10px] font-bold text-slate-400 cursor-pointer";
  const gOptAll = document.createElement("option");
  gOptAll.value = "";
  gOptAll.textContent = "GROUP: ALL";
  groupSelect.appendChild(gOptAll);
  (state.groups ?? []).forEach(g => {
    const opt = document.createElement("option");
    opt.value = g.id;
    opt.textContent = "GROUP: " + g.name.toUpperCase();
    if (state.memoryFilter.group_id === g.id) opt.selected = true;
    groupSelect.appendChild(opt);
  });
  groupChip.appendChild(groupSelect);
  const groupExpand = document.createElement("span");
  groupExpand.className = "material-symbols-outlined text-[14px]";
  groupExpand.textContent = "expand_more";
  groupChip.appendChild(groupExpand);
  leftChips.appendChild(groupChip);

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
  const total   = state.memoryPages;
  const current = state.memoryPage;
  if (total <= 1) return document.createDocumentFragment();

  const wrap = document.createElement("div");
  wrap.className = "flex gap-1 mt-4 justify-center items-center";

  const btnCls     = "p-1 hover:bg-white/5 rounded-sm px-3 text-xs text-slate-500";
  const activeCls  = "p-1 rounded-sm px-3 text-xs text-white border border-primary/20 bg-white/5";
  const arrowCls   = "p-1 hover:bg-white/5 rounded-sm text-slate-500";

  function mkBtn(label, page, cls) {
    const btn = document.createElement("button");
    btn.className = cls;
    btn.dataset.page = page;
    btn.textContent = label;
    if (page < 1 || page > total) {
      btn.disabled = true;
      btn.style.opacity = "0.3";
      btn.style.cursor = "default";
    }
    return btn;
  }

  function mkArrow(iconName, page) {
    const btn = document.createElement("button");
    btn.className = arrowCls;
    btn.dataset.page = page;
    const icon = document.createElement("span");
    icon.className = "material-symbols-outlined text-sm";
    icon.textContent = iconName;
    btn.appendChild(icon);
    if (page < 1 || page > total) { btn.disabled = true; btn.style.opacity = "0.3"; }
    return btn;
  }

  wrap.appendChild(mkArrow("chevron_left", current - 1));

  /* Window of 10 pages centered on current */
  const windowSize = 10;
  let start = Math.max(1, current - Math.floor(windowSize / 2));
  let end   = start + windowSize - 1;
  if (end > total) {
    end   = total;
    start = Math.max(1, end - windowSize + 1);
  }

  if (start > 1) {
    wrap.appendChild(mkBtn("1", 1, btnCls));
    if (start > 2) {
      const dots = document.createElement("span");
      dots.className = "text-xs text-slate-600 px-1";
      dots.textContent = "...";
      wrap.appendChild(dots);
    }
  }

  for (let i = start; i <= end; i++) {
    wrap.appendChild(mkBtn(String(i), i, i === current ? activeCls : btnCls));
  }

  if (end < total) {
    if (end < total - 1) {
      const dots = document.createElement("span");
      dots.className = "text-xs text-slate-600 px-1";
      dots.textContent = "...";
      wrap.appendChild(dots);
    }
    wrap.appendChild(mkBtn(String(total), total, btnCls));
  }

  wrap.appendChild(mkArrow("chevron_right", current + 1));

  return wrap;
}

async function renderMemory(container) {
  container.textContent = "";
  container.appendChild(loadingHtml());

  const params = new URLSearchParams();
  if (state.memoryFilter.topic)    params.set("topic",    state.memoryFilter.topic);
  if (state.memoryFilter.type)     params.set("type",     state.memoryFilter.type);
  if (state.memoryFilter.key_id)   params.set("key_id",   state.memoryFilter.key_id);
  if (state.memoryFilter.group_id) params.set("group_id", state.memoryFilter.group_id);
  params.set("page", state.memoryPage);

  const [fragRes, anomalyRes, groupsRes] = await Promise.all([
    api("/memory/fragments?" + params),
    api("/memory/anomalies"),
    api("/groups")
  ]);
  if (groupsRes.ok) state.groups = groupsRes.data ?? [];

  if (fragRes.ok) {
    const data = fragRes.data ?? {};
    if (Array.isArray(fragRes.data)) {
      state.fragments   = fragRes.data;
      state.memoryPages = 1;
    } else {
      state.fragments   = data.items ?? data.fragments ?? [];
      state.memoryPages = Math.ceil((data.total ?? 0) / (data.limit ?? 20)) || 1;
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
    state.memoryFilter.topic    = document.getElementById("filter-topic")?.value ?? "";
    state.memoryFilter.type     = document.getElementById("filter-type")?.value ?? "";
    state.memoryFilter.key_id   = document.getElementById("filter-key-id")?.value ?? "";
    state.memoryFilter.group_id = document.getElementById("filter-group")?.value ?? "";
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

if (typeof module !== "undefined" && module.exports) { // eslint-disable-line no-undef
  module.exports = { // eslint-disable-line no-undef
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
    renderSessionKpiRow,
    renderSessionTable,
    renderSessionInspector,
    renderLogKpiRow,
    renderGraph,
    loadGraph,
    renderLogViewer,
    renderLogSidebar,
    renderLogFilterBar,
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
