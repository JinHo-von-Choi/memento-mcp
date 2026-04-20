import { test, after } from "node:test";
import assert from "node:assert/strict";

import {
  createStreamableSession,
  validateStreamableSession,
  closeStreamableSession
} from "../../lib/sessions.js";
import { redisClient } from "../../lib/redis.js";

/**
 * lib/sessions.js import 체인이 Redis ioredis 클라이언트를 즉시 연결하므로
 * 테스트 종료 후 명시적으로 quit하지 않으면 event loop가 유지되어
 * node:test가 "Promise resolution is still pending" 메시지와 함께 cleanup hang.
 */
after(async () => {
  try { await redisClient.quit(); } catch (_) {}
  try {
    const { getPrimaryPool } = await import("../../lib/tools/db.js");
    await getPrimaryPool()?.end();
  } catch (_) {}
});

test("streamable SSE writes initial comment and flushes headers", async () => {
  const sessionId = await createStreamableSession(true);
  const { valid, session } = await validateStreamableSession(sessionId);

  assert.strictEqual(valid, true);

  const writes = [];
  let flushed = 0;

  session.setSseResponse({
    flushHeaders() {
      flushed += 1;
    },
    write(chunk) {
      writes.push(chunk);
    },
    end() {}
  });

  assert.strictEqual(flushed, 1);
  assert.deepStrictEqual(writes.slice(0, 1), [": connected\n\n"]);

  await closeStreamableSession(sessionId);
});

test("streamable SSE clears heartbeat when response is detached", async () => {
  const sessionId = await createStreamableSession(true);
  const { valid, session } = await validateStreamableSession(sessionId);

  assert.strictEqual(valid, true);

  let ended = 0;

  session.setSseResponse({
    flushHeaders() {},
    write() {},
    end() {
      ended += 1;
    }
  });

  session.setSseResponse(null);
  await closeStreamableSession(sessionId);

  assert.strictEqual(ended, 0);
});
