/**
 * admin.js -- Overview 렌더러 단위 테스트
 *
 * 작성자: 최진호
 * 작성일: 2026-03-26
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { loadAdmin, flatQuery } from "./admin-test-helper.js";

let mod;

describe("renderOverviewCards", () => {
  beforeEach(() => { mod = loadAdmin(); });

  test("stats=null이면 loading-spinner 반환", () => {
    const el = mod.renderOverviewCards(null);
    assert.ok(el.className.includes("loading-spinner"));
  });

  test("6개 KPI 카드 생성 (glass-panel)", () => {
    const stats = { fragments: 100, sessions: 5, apiCallsToday: 42, activeKeys: 3, system: { dbSizeBytes: 1048576 }, redis: "connected" };
    const grid = mod.renderOverviewCards(stats);
    assert.equal(grid.className, "grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8");
    const cards = grid.querySelectorAll(".glass-panel");
    assert.equal(cards.length, 6);
  });

  test("KPI 카드에 ghost icon wrapper (opacity-10) 존재", () => {
    const stats = { fragments: 50, sessions: 2, apiCallsToday: 10, activeKeys: 1, system: {}, redis: "connected" };
    const grid = mod.renderOverviewCards(stats);
    const card = grid.children[0];
    const ghost = card.querySelector(".opacity-10");
    assert.ok(ghost, "ghost icon wrapper 존재");
  });

  test("KPI 카드에 metric-label 클래스 존재", () => {
    const stats = { fragments: 50, sessions: 2, apiCallsToday: 10, activeKeys: 1, system: {}, redis: "connected" };
    const grid = mod.renderOverviewCards(stats);
    const card = grid.children[0];
    assert.ok(card.querySelector(".metric-label"), "metric-label 클래스 존재");
  });

  test("KPI 카드에 trend line 존재", () => {
    const stats = { fragments: 50, sessions: 2, apiCallsToday: 10, activeKeys: 1, system: {}, redis: "connected" };
    const grid = mod.renderOverviewCards(stats);
    const card = grid.children[0];
    const trend = flatQuery(card, ".text-primary").find(el => el.className.includes("mt-2"));
    assert.ok(trend, "trend 라인 존재");
  });
});

describe("renderHealthPanel", () => {
  beforeEach(() => { mod = loadAdmin(); });

  test("stats=null이면 null 반환", () => {
    assert.equal(mod.renderHealthPanel(null), null);
  });

  test("glass-panel + overflow-hidden", () => {
    const stats = { system: { cpu: 30, memory: 55, disk: 10 }, uptime: "5d 3h", db: "connected", redis: "connected", nodeVersion: "v20" };
    const panel = mod.renderHealthPanel(stats);
    assert.ok(panel.className.includes("glass-panel"));
    assert.ok(panel.className.includes("overflow-hidden"));
  });

  test("헤더에 SYSTEM_HEALTH_MONITOR 제목", () => {
    const stats = { system: {}, uptime: "--" };
    const panel = mod.renderHealthPanel(stats);
    const headers = flatQuery(panel, "h2");
    const found = headers.find(h => h.textContent === "SYSTEM_HEALTH_MONITOR");
    assert.ok(found, "SYSTEM_HEALTH_MONITOR h2 존재");
  });

  test("pulsing-glow dot 존재", () => {
    const stats = { system: {}, uptime: "--" };
    const panel = mod.renderHealthPanel(stats);
    assert.ok(panel.querySelector(".pulsing-glow"), "pulsing-glow dot 존재");
  });

  test("4개 meter bar 렌더링", () => {
    const stats = { system: { cpu: 20, memory: 40, disk: 15 } };
    const panel = mod.renderHealthPanel(stats);
    const meters = panel.querySelectorAll(".space-y-2");
    assert.equal(meters.length, 4);
  });

  test("SYSTEM UPTIME 값 표시", () => {
    const stats = { system: {}, uptime: "5d 3h" };
    const panel = mod.renderHealthPanel(stats);
    const all = [];
    function walk(n) { all.push(n); (n.children ?? []).forEach(walk); }
    walk(panel);
    assert.ok(all.some(n => n.textContent === "5d 3h"));
  });
});

describe("renderTimeline", () => {
  beforeEach(() => { mod = loadAdmin(); });

  test("activities 없으면 빈 상태 표시", () => {
    const panel = mod.renderTimeline([]);
    const all = [];
    function walk(n) { all.push(n); (n.children ?? []).forEach(walk); }
    walk(panel);
    assert.ok(all.some(n => n.textContent === "활동 없음"));
  });

  test("glass-panel 클래스 사용", () => {
    const panel = mod.renderTimeline([]);
    assert.ok(panel.className.includes("glass-panel"));
  });

  test("Memory Activity Timeline 헤더", () => {
    const panel = mod.renderTimeline([]);
    const headers = flatQuery(panel, "h2");
    assert.ok(headers.some(h => h.textContent === "Memory Activity Timeline"));
  });

  test("activity row에 divide-y container", () => {
    const activities = [{ topic: "test", type: "fact", agent_id: "claude", created_at: new Date().toISOString() }];
    const panel = mod.renderTimeline(activities);
    const divider = panel.querySelector(".divide-white\\/5");
    assert.ok(divider, "divide-y container 존재");
  });
});

describe("renderRiskPanel", () => {
  beforeEach(() => { mod = loadAdmin(); });

  test("glass-panel 클래스 사용", () => {
    const panel = mod.renderRiskPanel({});
    assert.ok(panel.className.includes("glass-panel"));
  });

  test("error item with bg-error-container/10", () => {
    const panel = mod.renderRiskPanel({ queues: { embeddingBacklog: 5 } });
    const errItem = panel.querySelector(".bg-error-container\\/10");
    assert.ok(errItem, "error container 존재");
  });

  test("normal items with bg-surface-container", () => {
    const panel = mod.renderRiskPanel({});
    const normals = panel.querySelectorAll(".bg-surface-container");
    assert.ok(normals.length >= 2, "최소 2개 normal item");
  });
});

describe("renderQuickActions", () => {
  beforeEach(() => { mod = loadAdmin(); });

  test("glass-panel + gradient 배경", () => {
    const panel = mod.renderQuickActions();
    assert.ok(panel.className.includes("glass-panel"));
    assert.ok(panel.className.includes("bg-gradient-to-br"));
  });

  test("4개 버튼 렌더링", () => {
    const panel = mod.renderQuickActions();
    const buttons = flatQuery(panel, "button");
    assert.equal(buttons.length, 4);
  });
});

describe("renderLatencyIndex", () => {
  beforeEach(() => { mod = loadAdmin(); });

  test("glass-panel wrapper", () => {
    const panel = mod.renderLatencyIndex();
    assert.ok(panel.className.includes("glass-panel"));
  });
});

describe("renderQualityCoverage", () => {
  beforeEach(() => { mod = loadAdmin(); });

  test("glass-panel + flex layout", () => {
    const panel = mod.renderQualityCoverage();
    assert.ok(panel.className.includes("glass-panel"));
    assert.ok(panel.className.includes("flex"));
  });
});

describe("renderTopTopics", () => {
  beforeEach(() => { mod = loadAdmin(); });

  test("glass-panel wrapper", () => {
    const panel = mod.renderTopTopics({});
    assert.ok(panel.className.includes("glass-panel"));
  });
});

describe("fmtBytes", () => {
  beforeEach(() => { mod = loadAdmin(); });

  test("null -> '-'", () => {
    assert.equal(mod.fmtBytes(null), "-");
  });

  test("1048576 -> '1.0 MB'", () => {
    assert.equal(mod.fmtBytes(1048576), "1.0 MB");
  });

  test("1024 -> '1.0 KB'", () => {
    assert.equal(mod.fmtBytes(1024), "1.0 KB");
  });
});
