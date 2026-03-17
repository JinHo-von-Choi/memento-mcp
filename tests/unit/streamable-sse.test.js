import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createStreamableSession,
  validateStreamableSession,
  closeStreamableSession
} from "../../lib/sessions.js";

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
