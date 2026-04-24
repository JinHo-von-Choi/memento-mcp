/**
 * Unit tests: LLM Semaphore
 *
 * 작성자: 최진호
 * 작성일: 2026-04-24
 *
 * createSemaphore / getSemaphore / resetSemaphores 동작을 검증한다.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  createSemaphore,
  getSemaphore,
  resetSemaphores
} from "../../lib/llm/util/semaphore.js";

beforeEach(() => {
  resetSemaphores();
});

// ---------------------------------------------------------------------------
// a. Single acquire/release round-trip
// ---------------------------------------------------------------------------
describe("createSemaphore: single acquire/release", () => {
  it("resolves immediately when slot is available", async () => {
    const sem = createSemaphore({ key: "test", limit: 1, waitTimeoutMs: 1000 });
    await sem.acquire();
    assert.equal(sem.active(), 1);
    sem.release();
    assert.equal(sem.active(), 0);
  });
});

// ---------------------------------------------------------------------------
// b. limit=2 with 3 concurrent acquires
// ---------------------------------------------------------------------------
describe("createSemaphore: third acquire blocks until slot freed", () => {
  it("third acquire proceeds after first release", async () => {
    const sem    = createSemaphore({ key: "test", limit: 2, waitTimeoutMs: 2000 });
    const order  = [];

    await sem.acquire(); // slot 1
    await sem.acquire(); // slot 2

    assert.equal(sem.active(),   2);
    assert.equal(sem.waiting(),  0);

    // third acquire should block
    const p3 = sem.acquire().then(() => { order.push("third"); });

    // give event loop a tick so the waiter registers
    await new Promise(r => setImmediate(r));
    assert.equal(sem.waiting(), 1);

    sem.release(); // free slot 1 → wakes third
    await p3;

    order.push("done");
    assert.deepEqual(order, ["third", "done"]);
    assert.equal(sem.active(),  2);
    assert.equal(sem.waiting(), 0);
  });
});

// ---------------------------------------------------------------------------
// c. Timeout: 4th acquire rejects after ~50 ms
// ---------------------------------------------------------------------------
describe("createSemaphore: timeout", () => {
  it("rejects with 'semaphore wait timeout' when slots held too long", async () => {
    const sem = createSemaphore({ key: "test", limit: 3, waitTimeoutMs: 50 });

    await sem.acquire();
    await sem.acquire();
    await sem.acquire();

    const start = Date.now();
    await assert.rejects(
      () => sem.acquire(),
      (err) => {
        assert.equal(err.message, "semaphore wait timeout");
        return true;
      }
    );
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 40, `elapsed too short: ${elapsed}ms`);

    sem.release();
    sem.release();
    sem.release();
  });
});

// ---------------------------------------------------------------------------
// d. FIFO ordering: 3 waiters resolve in queue order
// ---------------------------------------------------------------------------
describe("createSemaphore: FIFO ordering", () => {
  it("waiters resolve in the order they were queued", async () => {
    const sem   = createSemaphore({ key: "test", limit: 1, waitTimeoutMs: 2000 });
    const order = [];

    await sem.acquire(); // hold the only slot

    const p1 = sem.acquire().then(() => { order.push(1); sem.release(); });
    const p2 = sem.acquire().then(() => { order.push(2); sem.release(); });
    const p3 = sem.acquire().then(() => { order.push(3); sem.release(); });

    await new Promise(r => setImmediate(r));
    assert.equal(sem.waiting(), 3);

    sem.release(); // wake p1

    await Promise.all([p1, p2, p3]);
    assert.deepEqual(order, [1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// e. getSemaphore returns same instance for same key
// ---------------------------------------------------------------------------
describe("getSemaphore: caching", () => {
  it("returns same instance for same key", () => {
    const s1 = getSemaphore("keyA", 5, 1000);
    const s2 = getSemaphore("keyA", 5, 1000);
    assert.strictEqual(s1, s2);
  });

  it("returns different instances for different keys", () => {
    const s1 = getSemaphore("keyA", 5, 1000);
    const s2 = getSemaphore("keyB", 5, 1000);
    assert.notStrictEqual(s1, s2);
  });
});

// ---------------------------------------------------------------------------
// f. active() and waiting() counters accurate through lifecycle
// ---------------------------------------------------------------------------
describe("createSemaphore: counter accuracy", () => {
  it("tracks active and waiting through acquire/release cycle", async () => {
    const sem = createSemaphore({ key: "test", limit: 2, waitTimeoutMs: 2000 });

    assert.equal(sem.active(),  0);
    assert.equal(sem.waiting(), 0);

    await sem.acquire();
    assert.equal(sem.active(),  1);
    assert.equal(sem.waiting(), 0);

    await sem.acquire();
    assert.equal(sem.active(),  2);
    assert.equal(sem.waiting(), 0);

    // third will block
    const p3 = sem.acquire();
    await new Promise(r => setImmediate(r));
    assert.equal(sem.active(),  2);
    assert.equal(sem.waiting(), 1);

    sem.release();
    await p3;
    assert.equal(sem.active(),  2);
    assert.equal(sem.waiting(), 0);

    sem.release();
    sem.release();
    assert.equal(sem.active(),  0);
    assert.equal(sem.waiting(), 0);
  });
});

// ---------------------------------------------------------------------------
// g. resetSemaphores() clears cache
// ---------------------------------------------------------------------------
describe("resetSemaphores: clears cache", () => {
  it("returns a fresh instance after reset", () => {
    const s1 = getSemaphore("keyX", 5, 1000);
    resetSemaphores();
    const s2 = getSemaphore("keyX", 5, 1000);
    assert.notStrictEqual(s1, s2);
  });
});
