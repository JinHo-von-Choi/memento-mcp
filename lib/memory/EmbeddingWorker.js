/**
 * EmbeddingWorker - Redis 큐 기반 비동기 임베딩 생성 워커
 *
 * 작성자: 최진호
 * 작성일: 2026-03-07
 *
 * FragmentStore.insert()의 인라인 임베딩을 제거하고,
 * Redis 큐에서 파편 ID를 소비하여 임베딩을 생성한 뒤 DB에 저장한다.
 * 임베딩 완료 시 `embedding_ready` 이벤트를 발행한다.
 */

import { EventEmitter }    from "node:events";
import { MEMORY_CONFIG }   from "../../config/memory.js";
import { redisClient }     from "../redis.js";
import { queryWithAgentVector } from "../tools/db.js";
import {
  generateEmbedding,
  prepareTextForEmbedding,
  vectorToSql,
  OPENAI_API_KEY
} from "../tools/embedding.js";
import { logWarn } from "../logger.js";

const SCHEMA = "agent_memory";

export class EmbeddingWorker extends EventEmitter {
  constructor() {
    super();
    this.running = false;
    this.config  = MEMORY_CONFIG.embeddingWorker;
    this.timer   = null;
  }

  /**
   * 워커 시작 — OPENAI_API_KEY가 없으면 조기 종료
   */
  async start() {
    if (!OPENAI_API_KEY) {
      console.warn("[EmbeddingWorker] OPENAI_API_KEY not set, worker disabled");
      return;
    }
    if (this.running) return;

    this.running = true;
    console.log("[EmbeddingWorker] Worker started");
    this._poll();
  }

  /**
   * 워커 중지
   */
  stop() {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log("[EmbeddingWorker] Worker stopped");
  }

  /**
   * intervalMs 간격으로 _processBatch 호출
   */
  _poll() {
    if (!this.running) return;

    this._processBatch()
      .catch(err => {
        console.error("[EmbeddingWorker] _processBatch error:", err.message);
      })
      .finally(() => {
        if (this.running) {
          this.timer = setTimeout(() => this._poll(), this.config.intervalMs);
        }
      });
  }

  /**
   * Redis 큐에서 batchSize개 ID를 추출하고 임베딩 생성
   */
  async _processBatch() {
    const queueRedisKey = `queue:${this.config.queueKey}`;
    const ids           = [];

    for (let i = 0; i < this.config.batchSize; i++) {
      const raw = await redisClient.rpop(queueRedisKey);
      if (!raw) break;

      try {
        const data = JSON.parse(raw);
        if (data.fragmentId) {
          ids.push(data.fragmentId);
        }
      } catch (err) {
        logWarn(`[EmbeddingWorker] Invalid queue item: ${raw} — ${err.message}`);
      }
    }

    if (ids.length === 0) return;

    /** DB에서 embedding IS NULL인 파편만 조회 */
    const { rows } = await queryWithAgentVector("system",
      `SELECT id, content FROM ${SCHEMA}.fragments
       WHERE id = ANY($1) AND embedding IS NULL`,
      [ids]
    );

    for (const row of rows) {
      await this._embedOne(row);
    }
  }

  /**
   * 단일 파편 임베딩 생성 및 DB 저장
   *
   * @param {Object} row - { id, content }
   */
  async _embedOne(row) {
    let lastError = null;

    for (let attempt = 1; attempt <= this.config.retryLimit; attempt++) {
      try {
        const text      = prepareTextForEmbedding(row.content, 500);
        const vec       = await generateEmbedding(text);
        const vecStr    = vectorToSql(vec);

        await queryWithAgentVector("system",
          `UPDATE ${SCHEMA}.fragments SET embedding = $2::vector WHERE id = $1`,
          [row.id, vecStr],
          "write"
        );

        this.emit("embedding_ready", { fragmentId: row.id });
        return;
      } catch (err) {
        lastError = err;
        console.warn(`[EmbeddingWorker] Attempt ${attempt}/${this.config.retryLimit} failed for ${row.id}: ${err.message}`);

        if (attempt < this.config.retryLimit) {
          await new Promise(r => setTimeout(r, this.config.retryDelayMs));
        }
      }
    }

    /** 재시도 초과 — dead letter 큐로 이동 */
    const deadLetterKey = `queue:${this.config.queueKey}:dead`;
    try {
      await redisClient.lpush(deadLetterKey, JSON.stringify({
        fragmentId: row.id,
        error     : lastError?.message || "unknown",
        failedAt  : new Date().toISOString()
      }));
      console.error(`[EmbeddingWorker] Fragment ${row.id} moved to dead letter queue: ${lastError?.message}`);
    } catch (dlqErr) {
      console.error(`[EmbeddingWorker] Dead letter push failed: ${dlqErr.message}`);
    }
  }
}
