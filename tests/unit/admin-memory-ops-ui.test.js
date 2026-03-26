/**
 * admin.js -- Memory Operations 렌더러 단위 테스트
 *
 * 작성자: 최진호
 * 작성일: 2026-03-26
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { loadAdmin, flatQuery } from "./admin-test-helper.js";

let mod;

/* ================================================================
   Memory Filters
   ================================================================ */

describe("renderMemoryFilters", () => {
  beforeEach(() => { mod = loadAdmin(); });

  test("glass-panel + border-l-2 border-primary/40", () => {
    const bar = mod.renderMemoryFilters();
    assert.ok(bar.className.includes("glass-panel"));
    assert.ok(bar.className.includes("border-l-2"));
    assert.ok(bar.className.includes("border-primary/40"));
  });

  test("filter-topic, filter-type, filter-key-id 존재", () => {
    const bar = mod.renderMemoryFilters();
    const all = [];
    function walk(n) { all.push(n); (n.children ?? []).forEach(walk); }
    walk(bar);
    assert.ok(all.some(n => n.dataset?._id === "filter-topic"), "topic input");
    assert.ok(all.some(n => n.dataset?._id === "filter-type"), "type select");
    assert.ok(all.some(n => n.dataset?._id === "filter-key-id"), "key input");
  });

  test("SEARCH 버튼 존재", () => {
    const bar = mod.renderMemoryFilters();
    const all = [];
    function walk(n) { all.push(n); (n.children ?? []).forEach(walk); }
    walk(bar);
    assert.ok(all.some(n => n.dataset?._id === "filter-search"), "filter-search button");
  });
});

/* ================================================================
   Fragment List (Search Explorer)
   ================================================================ */

describe("renderFragmentList", () => {
  beforeEach(() => { mod = loadAdmin(); });

  test("fragments 비어있으면 빈 상태 텍스트", () => {
    const el = mod.renderFragmentList([]);
    assert.ok(el.textContent.includes("결과 없음"));
  });

  test("glass-panel + shadow-2xl + overflow-hidden", () => {
    const frags = [{ id: "f1", topic: "test", type: "fact", content: "hello", importance: 0.8, created_at: "2024-01-01" }];
    mod.state.selectedFragment = null;
    const panel = mod.renderFragmentList(frags);
    assert.ok(panel.className.includes("glass-panel"));
    assert.ok(panel.className.includes("shadow-2xl"));
    assert.ok(panel.className.includes("overflow-hidden"));
  });

  test("query box with bg-surface-container-highest", () => {
    const frags = [{ id: "f1", topic: "t", type: "fact", content: "c" }];
    mod.state.selectedFragment = null;
    const panel = mod.renderFragmentList(frags);
    const queryBox = panel.querySelector(".bg-surface-container-highest");
    assert.ok(queryBox, "query box 존재");
  });

  test("fragment item에 ID badge + UTILITY_SCORE + ACCESS", () => {
    const frags = [{ id: "f1", topic: "arch", type: "decision", content: "content", importance: 0.9, access_count: 5, created_at: "2024-06-01" }];
    mod.state.selectedFragment = null;
    const panel = mod.renderFragmentList(frags);
    const item = panel.querySelector("[data-frag-id]");
    assert.ok(item, "fragment item 존재");

    const all = [];
    function walk(n) { all.push(n); (n.children ?? []).forEach(walk); }
    walk(item);
    assert.ok(all.some(n => (n.textContent ?? "").includes("#MEM_")), "ID badge");
    assert.ok(all.some(n => (n.textContent ?? "").includes("UTILITY_SCORE")), "UTILITY_SCORE label");
    assert.ok(all.some(n => (n.textContent ?? "").includes("ACCESS")), "ACCESS label");
  });
});

/* ================================================================
   Retrieval Analytics
   ================================================================ */

describe("renderRetrievalAnalytics", () => {
  beforeEach(() => { mod = loadAdmin(); });

  test("glass-panel + border-primary/20", () => {
    const panel = mod.renderRetrievalAnalytics({});
    assert.ok(panel.className.includes("glass-panel"));
    assert.ok(panel.className.includes("border-primary/20"));
  });

  test("Retrieval Analytics 타이틀", () => {
    const panel = mod.renderRetrievalAnalytics({});
    const all = [];
    function walk(n) { all.push(n); (n.children ?? []).forEach(walk); }
    walk(panel);
    assert.ok(all.some(n => (n.textContent ?? "").includes("Retrieval Analytics")));
  });

  test("HIT RATE + RERANK USAGE", () => {
    const panel = mod.renderRetrievalAnalytics({});
    const all = [];
    function walk(n) { all.push(n); (n.children ?? []).forEach(walk); }
    walk(panel);
    assert.ok(all.some(n => (n.textContent ?? "").includes("HIT RATE")));
    assert.ok(all.some(n => (n.textContent ?? "").includes("RERANK USAGE")));
  });
});

/* ================================================================
   Anomaly Cards
   ================================================================ */

describe("renderAnomalyCards", () => {
  beforeEach(() => { mod = loadAdmin(); });

  test("anomalies=null이면 empty fragment", () => {
    const el = mod.renderAnomalyCards(null);
    assert.equal(el.children.length, 0);
  });

  test("glass-panel + border-error/20", () => {
    const panel = mod.renderAnomalyCards({ contradictions: 2 });
    assert.ok(panel.className.includes("glass-panel"));
    assert.ok(panel.className.includes("border-error/20"));
  });

  test("4 anomaly items", () => {
    const panel = mod.renderAnomalyCards({ contradictions: 0, superseded: 0, qualityUnverified: 0, embeddingBacklog: 0 });
    const items = panel.querySelectorAll("[data-anomaly]");
    assert.equal(items.length, 4);
  });

  test("critical item with bg-error-container/10", () => {
    const panel = mod.renderAnomalyCards({ contradictions: 3 });
    const critical = panel.querySelector(".bg-error-container\\/10");
    assert.ok(critical);
  });
});

/* ================================================================
   Recent Events Chart
   ================================================================ */

describe("renderRecentEventsChart", () => {
  beforeEach(() => { mod = loadAdmin(); });

  test("glass-panel wrapper", () => {
    const panel = mod.renderRecentEventsChart();
    assert.ok(panel.className.includes("glass-panel"));
  });

  test("RECALL_EVENTS + QUERY_LOAD legend", () => {
    const panel = mod.renderRecentEventsChart();
    const all = [];
    function walk(n) { all.push(n); (n.children ?? []).forEach(walk); }
    walk(panel);
    assert.ok(all.some(n => (n.textContent ?? "").includes("RECALL_EVENTS")));
    assert.ok(all.some(n => (n.textContent ?? "").includes("QUERY_LOAD")));
  });

  test("bg-surface-container-lowest chart area", () => {
    const panel = mod.renderRecentEventsChart();
    assert.ok(panel.querySelector(".bg-surface-container-lowest"));
  });
});

/* ================================================================
   Fragment Inspector
   ================================================================ */

describe("renderFragmentInspector", () => {
  beforeEach(() => { mod = loadAdmin(); });

  test("fragment=null이면 empty fragment", () => {
    const el = mod.renderFragmentInspector(null);
    assert.equal(el.children.length, 0);
  });

  test("glass-panel + border-primary/20", () => {
    const frag = { id: "f1", content: "test", type: "fact", importance: 0.8, created_at: "2024-01-01" };
    const panel = mod.renderFragmentInspector(frag);
    assert.ok(panel.className.includes("glass-panel"));
    assert.ok(panel.className.includes("border-primary/20"));
  });
});

/* ================================================================
   Pagination
   ================================================================ */

describe("renderPagination", () => {
  beforeEach(() => { mod = loadAdmin(); });

  test("memoryPages <= 1이면 빈 fragment", () => {
    mod.state.memoryPages = 1;
    const el = mod.renderPagination();
    assert.equal(el.children.length, 0);
  });

  test("memoryPages=3이면 3개 버튼", () => {
    mod.state.memoryPages = 3;
    mod.state.memoryPage  = 1;
    const wrap = mod.renderPagination();
    const buttons = flatQuery(wrap, "button");
    assert.equal(buttons.length, 3);
  });
});
