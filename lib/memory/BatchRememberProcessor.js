/**
 * BatchRememberProcessor -- batchRemember() 로직 전담 모듈
 *
 * 작성자: 최진호
 * 작성일: 2026-04-05
 *
 * MemoryManager.batchRemember() 247줄 본문을 추출.
 * Phase A(유효성 검증), Phase B(트랜잭션 INSERT), Phase C(후처리) 3단계 구조.
 */

import { getPrimaryPool }   from "../tools/db.js";
import { MEMORY_CONFIG }    from "../../config/memory.js";
import { pushToQueue }      from "../redis.js";
import { FragmentFactory }  from "./FragmentFactory.js";

const MAX_BATCH = 200;
const SCHEMA    = "agent_memory";

export class BatchRememberProcessor {
  #pool          = null;
  #poolOverridden = false;

  /**
   * @param {Object} deps
   *   - store          {FragmentStore}
   *   - index          {FragmentIndex}
   *   - factory        {FragmentFactory}
   */
  constructor({ store, index, factory }) {
    this.store   = store;
    this.index   = index;
    this.factory = factory;
  }

  /** 테스트용 pool 주입 (null 포함) */
  setPool(pool) {
    this.#pool          = pool;
    this.#poolOverridden = true;
  }

  /** @private */
  _getPool() {
    return this.#poolOverridden ? this.#pool : getPrimaryPool();
  }

  /**
   * 복수 파편을 단일 트랜잭션으로 일괄 저장한다.
   *
   * @param {Object} params
   *   - fragments {Array<Object>} 파편 배열
   *   - agentId   {string}       에이전트 ID (선택)
   *   - _keyId    {string|null}  API 키 ID (선택)
   *   - workspace {string|null}  워크스페이스 (선택)
   *   - _defaultWorkspace {string|null}
   * @returns {{ results: Array<{id, success, error?}>, inserted: number, skipped: number }}
   */
  async process(params) {
    const fragments = params.fragments;
    if (!Array.isArray(fragments) || fragments.length === 0) {
      throw new Error("fragments array is required and must not be empty");
    }

    if (fragments.length > MAX_BATCH) {
      throw new Error(`Batch size ${fragments.length} exceeds maximum ${MAX_BATCH}`);
    }

    const agentId   = params.agentId || "default";
    const keyId     = params._keyId ?? null;
    const workspace = params.workspace ?? params._defaultWorkspace ?? null;
    const results   = [];

    /** Phase A: 유효성 검증 + 파편 생성 (DB 밖에서 수행) */
    const validFragments = [];

    for (let i = 0; i < fragments.length; i++) {
      const item = fragments[i];
      try {
        const validation = FragmentFactory.validateContent(
          (item.content || "").trim(),
          item.type ?? null,
          item.topic ?? null
        );
        if (!validation.valid) {
          results.push({ index: i, id: null, success: false, error: validation.reason });
          continue;
        }

        const fragment     = this.factory.create(item);
        fragment.agent_id  = agentId;
        fragment.key_id    = keyId;
        fragment.workspace = item.workspace ?? workspace;
        validFragments.push({ index: i, fragment });
        results.push({ index: i, id: fragment.id, success: true });
      } catch (err) {
        results.push({ index: i, id: null, success: false, error: err.message });
      }
    }

    if (validFragments.length === 0) {
      return { results, inserted: 0, skipped: fragments.length };
    }

    /** 할당량 초과 검사: API 키의 잔여 슬롯만큼만 INSERT 허용 (partial insert) */
    if (keyId) {
      const quotaResult = await this._checkQuotaPhaseA(keyId, validFragments, results, fragments.length);
      if (quotaResult) return quotaResult;
    }

    /** Phase B: 단일 트랜잭션 multi-row INSERT */
    const pool = this._getPool();
    if (!pool) throw new Error("Database pool unavailable");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const safeAgent = String(agentId).replace(/[^a-zA-Z0-9_-]/g, "");
      await client.query(`SET LOCAL search_path TO ${SCHEMA}, public`);
      await client.query(`SET LOCAL app.current_agent_id = '${safeAgent}'`);

      /**
       * Phase B 할당량 재검증 (TOCTOU 방어):
       * Phase A의 quota check와 이 INSERT 트랜잭션 사이 간극에서 동시 요청이
       * limit을 초과할 수 있다. INSERT 트랜잭션 내에서 api_keys를 FOR UPDATE로
       * 재잠금하고 현재 count를 재확인하여 초과분을 재조정한다.
       */
      if (keyId) {
        const quotaResultB = await this._checkQuotaPhaseB(
          client, keyId, safeAgent, validFragments, results, fragments.length
        );
        if (quotaResultB) {
          await client.query("ROLLBACK");
          return quotaResultB;
        }
      }

      let insertedCount = 0;

      for (const { index, fragment } of validFragments) {
        try {
          const contentHash     = fragment.content_hash;
          const estimatedTokens = fragment.estimated_tokens || Math.ceil((fragment.content || "").length / 4);
          const validFrom       = fragment.valid_from || new Date().toISOString();
          const isAnchor        = fragment.is_anchor === true;

          const insertSql = `INSERT INTO ${SCHEMA}.fragments
                    (id, content, topic, keywords, type, importance, content_hash,
                     source, linked_to, agent_id, ttl_tier, estimated_tokens, valid_from, key_id, is_anchor,
                     context_summary, session_id, workspace,
                     case_id, goal, outcome, phase, resolution_status, assertion_status,
                     embedding)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::timestamptz,
                         $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, NULL)
                 ON CONFLICT (content_hash) DO UPDATE SET
                    importance  = GREATEST(${SCHEMA}.fragments.importance, EXCLUDED.importance),
                    is_anchor   = ${SCHEMA}.fragments.is_anchor OR EXCLUDED.is_anchor,
                    accessed_at = NOW()
                 RETURNING id`;

          const insertParams = [
            fragment.id,
            fragment.content,
            fragment.topic,
            fragment.keywords || [],
            fragment.type,
            fragment.importance ?? 0.5,
            contentHash,
            fragment.source || null,
            fragment.linked_to || [],
            agentId,
            fragment.ttl_tier || "warm",
            estimatedTokens,
            validFrom,
            keyId,
            isAnchor,
            fragment.context_summary || null,
            fragment.session_id || null,
            fragment.workspace ?? null,
            fragment.case_id || null,
            fragment.goal || null,
            fragment.outcome || null,
            fragment.phase || null,
            fragment.resolution_status || null,
            fragment.assertion_status || "observed"
          ];

          const row = await client.query(insertSql, insertParams);
          const insertedId   = row.rows[0]?.id || fragment.id;
          results[index].id  = insertedId;
          insertedCount++;
        } catch (err) {
          results[index].success = false;
          results[index].error   = err.message;
          results[index].id      = null;
        }
      }

      await client.query("COMMIT");

      /** Phase C: 비동기 후처리 (임베딩 큐, Redis 인덱스) -- 트랜잭션 외부 */
      for (const { fragment } of validFragments) {
        const idx = results.findIndex(r => r.id === fragment.id && r.success);
        if (idx < 0) continue;

        this.index.index({ ...fragment, id: results[idx].id }, null, keyId).catch(() => {});
        pushToQueue(MEMORY_CONFIG.embeddingWorker.queueKey, { fragmentId: results[idx].id }).catch(() => {});
      }

      return {
        results,
        inserted: insertedCount,
        skipped : fragments.length - insertedCount
      };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Phase A 할당량 검사.
   * keyId의 잔여 슬롯을 확인하고, 초과 시 validFragments를 잘라내거나 전량 거부한다.
   * 전량 거부 시 반환값을 돌려준다. 부분 거부/통과 시 null 반환.
   *
   * @private
   */
  async _checkQuotaPhaseA(keyId, validFragments, results, totalCount) {
    const quotaPool = this._getPool();
    if (!quotaPool) return null;

    const qClient = await quotaPool.connect();
    try {
      await qClient.query("BEGIN");
      await qClient.query("SET LOCAL app.current_agent_id = 'system'");
      const { rows: [keyRow] } = await qClient.query(
        `SELECT fragment_limit FROM agent_memory.api_keys WHERE id = $1 FOR UPDATE`,
        [keyId]
      );
      if (keyRow && keyRow.fragment_limit !== null) {
        const { rows: [countRow] } = await qClient.query(
          `SELECT COUNT(*)::int AS count FROM agent_memory.fragments
           WHERE key_id = $1 AND valid_to IS NULL`,
          [keyId]
        );
        const remaining = keyRow.fragment_limit - countRow.count;
        if (remaining <= 0) {
          /** 전량 초과: 모든 valid 파편을 에러 처리 */
          for (const { index } of validFragments) {
            results[index].success = false;
            results[index].error   = "fragment_limit_exceeded";
            results[index].id      = null;
          }
          await qClient.query("COMMIT");
          return {
            results,
            inserted          : 0,
            skipped           : totalCount,
            fragment_limit    : keyRow.fragment_limit,
            current_count     : countRow.count,
            rejected_by_quota : validFragments.length
          };
        }
        if (remaining < validFragments.length) {
          /** 부분 초과: 잔여 할당량 이후의 파편을 에러 처리 */
          const rejected = validFragments.splice(remaining);
          for (const { index } of rejected) {
            results[index].success = false;
            results[index].error   = "fragment_limit_exceeded";
            results[index].id      = null;
          }
        }
      }
      await qClient.query("COMMIT");
    } catch (err) {
      await qClient.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      qClient.release();
    }

    return null;
  }

  /**
   * Phase B 할당량 재검증 (TOCTOU 방어).
   * INSERT 트랜잭션 내에서 api_keys를 FOR UPDATE로 재잠금하여 초과분 재조정.
   * 전량 거부 시 반환값을 돌려준다. 부분 거부/통과 시 null 반환.
   *
   * @private
   */
  async _checkQuotaPhaseB(client, keyId, safeAgent, validFragments, results, totalCount) {
    await client.query("SET LOCAL app.current_agent_id = 'system'");
    const { rows: [keyRowB] } = await client.query(
      `SELECT fragment_limit FROM ${SCHEMA}.api_keys WHERE id = $1 FOR UPDATE`,
      [keyId]
    );
    if (keyRowB && keyRowB.fragment_limit !== null) {
      const { rows: [countRowB] } = await client.query(
        `SELECT COUNT(*)::int AS count FROM ${SCHEMA}.fragments
         WHERE key_id = $1 AND valid_to IS NULL`,
        [keyId]
      );
      const remainingB = keyRowB.fragment_limit - countRowB.count;
      if (remainingB <= 0) {
        for (const { index } of validFragments) {
          results[index].success = false;
          results[index].error   = "fragment_limit_exceeded";
          results[index].id      = null;
        }
        return {
          results,
          inserted          : 0,
          skipped           : totalCount,
          fragment_limit    : keyRowB.fragment_limit,
          current_count     : countRowB.count,
          rejected_by_quota : validFragments.length
        };
      }
      if (remainingB < validFragments.length) {
        const rejectedB = validFragments.splice(remainingB);
        for (const { index } of rejectedB) {
          results[index].success = false;
          results[index].error   = "fragment_limit_exceeded";
          results[index].id      = null;
        }
      }
    }
    await client.query(`SET LOCAL app.current_agent_id = '${safeAgent}'`);
    return null;
  }
}
