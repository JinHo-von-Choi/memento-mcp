import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { readJsonBody } from "../../lib/utils.js";

function fakeReq(body) {
  const r      = new Readable({ read() {} });
  r.push(typeof body === "string" ? body : body);
  r.push(null);
  r.headers    = {};
  return r;
}

describe("readJsonBody", () => {
  it("parses valid JSON within limit", async () => {
    const result = await readJsonBody(fakeReq('{"ok":true}'));
    assert.deepStrictEqual(result, { ok: true });
  });

  it("rejects payload exceeding MAX_BODY_BYTES", async () => {
    const big = Buffer.alloc(2 * 1024 * 1024 + 1, 0x61);
    await assert.rejects(
      () => readJsonBody(fakeReq(big)),
      (err) => err.message.includes("Payload too large") && err.statusCode === 413
    );
  });

  it("accepts custom maxBytes parameter", async () => {
    const body = JSON.stringify({ x: "a".repeat(100) });
    await assert.rejects(
      () => readJsonBody(fakeReq(body), 50),
      (err) => err.statusCode === 413
    );
  });
});
