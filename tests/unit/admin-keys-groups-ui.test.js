/**
 * admin.js -- Keys/Groups 렌더러 단위 테스트
 *
 * 작성자: 최진호
 * 작성일: 2026-03-26
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { loadAdmin, flatQuery } from "./admin-test-helper.js";

let mod;

/* ================================================================
   Keys View
   ================================================================ */

describe("renderKeyKpiRow", () => {
  beforeEach(() => { mod = loadAdmin(); });

  test("4개 KPI 카드 (glass-panel)", () => {
    const keys = [
      { id: "1", status: "active", groups: ["A"] },
      { id: "2", status: "active", groups: [] },
      { id: "3", status: "inactive", groups: ["A"] }
    ];
    const grid = mod.renderKeyKpiRow(keys);
    assert.equal(grid.className, "grid grid-cols-4 gap-4 mb-8");
    const cards = grid.querySelectorAll(".glass-panel");
    assert.equal(cards.length, 4);
  });

  test("ACTIVE KEYS, REVOKED KEYS, TOTAL GROUPS, NO GROUP 라벨", () => {
    const keys = [{ id: "1", status: "active", groups: [] }];
    const grid = mod.renderKeyKpiRow(keys);
    const labels = grid.querySelectorAll(".font-label").map(l => l.textContent);
    assert.ok(labels.includes("ACTIVE KEYS"));
    assert.ok(labels.includes("REVOKED KEYS"));
    assert.ok(labels.includes("TOTAL GROUPS"));
    assert.ok(labels.includes("NO GROUP"));
  });

  test("값에 font-headline text-3xl 사용", () => {
    const keys = [{ id: "1", status: "active", groups: [] }];
    const grid = mod.renderKeyKpiRow(keys);
    const vals = grid.querySelectorAll(".text-3xl");
    assert.equal(vals.length, 4);
  });

  test("left accent bar 존재", () => {
    const keys = [];
    const grid = mod.renderKeyKpiRow(keys);
    const bars = grid.querySelectorAll(".absolute");
    assert.equal(bars.length, 4);
  });
});

describe("renderKeyTable", () => {
  beforeEach(() => { mod = loadAdmin(); });

  test("glass-panel wrapper", () => {
    const wrap = mod.renderKeyTable([]);
    assert.ok(wrap.className.includes("glass-panel"));
  });

  test("7 columns in thead", () => {
    const wrap = mod.renderKeyTable([]);
    const ths = flatQuery(wrap, "th");
    assert.equal(ths.length, 7);
  });

  test("footer에 entry count 표시", () => {
    const keys = [
      { id: "k1", name: "A", status: "active" },
      { id: "k2", name: "B", status: "active" }
    ];
    const wrap = mod.renderKeyTable(keys);
    const all = [];
    function walk(n) { all.push(n); (n.children ?? []).forEach(walk); }
    walk(wrap);
    assert.ok(all.some(n => (n.textContent ?? "").includes("2 entries")));
  });
});

describe("renderKeyInspector", () => {
  beforeEach(() => { mod = loadAdmin(); mod.state.groups = []; });

  test("key=null이면 empty placeholder", () => {
    const panel = mod.renderKeyInspector(null);
    const all = [];
    function walk(n) { all.push(n); (n.children ?? []).forEach(walk); }
    walk(panel);
    assert.ok(all.some(n => (n.textContent ?? "").includes("SELECT A KEY TO INSPECT")));
  });

  test("key identity card with border-l-2 border-primary", () => {
    const key = { id: "k1", name: "TestKey", key_prefix: "m_test", status: "active", today_calls: 10, created_at: "2024-01-01" };
    const panel = mod.renderKeyInspector(key);
    const idCard = panel.querySelector(".border-l-2");
    assert.ok(idCard);
  });

  test("REVOKE KEY + DELETE PERMANENTLY 버튼", () => {
    const key = { id: "k1", name: "K", key_prefix: "m_k", status: "active" };
    const panel = mod.renderKeyInspector(key);
    const buttons = flatQuery(panel, "button");
    const texts = buttons.map(b => b.textContent);
    assert.ok(texts.includes("REVOKE KEY"));
    assert.ok(texts.includes("DELETE PERMANENTLY"));
  });

  test("ASSIGNED GROUPS + ADD GROUP", () => {
    const key = { id: "k1", name: "K", key_prefix: "m_k", status: "active", groups: ["G1"] };
    const panel = mod.renderKeyInspector(key);
    const all = [];
    function walk(n) { all.push(n); (n.children ?? []).forEach(walk); }
    walk(panel);
    assert.ok(all.some(n => (n.textContent ?? "").includes("ASSIGNED GROUPS")));
    assert.ok(all.some(n => (n.textContent ?? "").includes("ADD GROUP")));
  });
});

/* ================================================================
   Groups View
   ================================================================ */

describe("renderGroupKpiRow", () => {
  beforeEach(() => { mod = loadAdmin(); });

  test("4개 KPI 카드 (glass-panel)", () => {
    const groups = [{ id: "g1", name: "A", member_count: 2 }];
    const keys = [{ id: "k1", groups: ["A"] }];
    const grid = mod.renderGroupKpiRow(groups, keys);
    const cards = grid.querySelectorAll(".glass-panel");
    assert.equal(cards.length, 4);
  });

  test("TOTAL GROUPS, TOTAL MEMBERS, EMPTY GROUPS, UNASSIGNED KEYS", () => {
    const grid = mod.renderGroupKpiRow([], []);
    const labels = grid.querySelectorAll(".font-label").map(l => l.textContent);
    assert.ok(labels.includes("TOTAL GROUPS"));
    assert.ok(labels.includes("TOTAL MEMBERS"));
    assert.ok(labels.includes("EMPTY GROUPS"));
    assert.ok(labels.includes("UNASSIGNED KEYS"));
  });
});

describe("renderGroupTable", () => {
  beforeEach(() => { mod = loadAdmin(); });

  test("glass-panel wrapper", () => {
    const wrap = mod.renderGroupTable([]);
    assert.ok(wrap.className.includes("glass-panel"));
  });

  test("5 columns", () => {
    const wrap = mod.renderGroupTable([]);
    const ths = flatQuery(wrap, "th");
    assert.equal(ths.length, 5);
  });
});

describe("renderGroupInspector", () => {
  beforeEach(() => { mod = loadAdmin(); });

  test("selected=null이면 empty placeholder", () => {
    const panel = mod.renderGroupInspector(null, []);
    const all = [];
    function walk(n) { all.push(n); (n.children ?? []).forEach(walk); }
    walk(panel);
    assert.ok(all.some(n => (n.textContent ?? "").includes("SELECT A GROUP TO INSPECT")));
  });

  test("group identity card with border-l-2 border-secondary", () => {
    const group = { id: "g1", name: "TestGroup", description: "Test", member_count: 2 };
    const panel = mod.renderGroupInspector(group, []);
    const idCard = panel.querySelector(".border-secondary");
    assert.ok(idCard);
  });

  test("ADD MEMBER + DELETE GROUP 버튼", () => {
    const group = { id: "g1", name: "G", member_count: 0 };
    const panel = mod.renderGroupInspector(group, []);
    const buttons = flatQuery(panel, "button");
    const texts = buttons.map(b => b.textContent);
    assert.ok(texts.includes("ADD MEMBER"));
    assert.ok(texts.includes("DELETE GROUP"));
  });
});
