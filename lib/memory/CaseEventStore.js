/**
 * CaseEventStore - case_events / case_event_edges / fragment_evidence CRUD
 *
 * 작성자: 최진호
 * 작성일: 2026-04-03
 */

import { getPrimaryPool } from "../tools/db.js";
import { buildSearchPath } from "../config.js";
import { logWarn }         from "../logger.js";

const SCHEMA = "agent_memory";

export class CaseEventStore {
  /**
   * case_events에 이벤트를 추가한다.
   * sequence_no는 동일 case_id 내 MAX + 1로 원자적으로 결정된다.
   *
   * @param {Object}      event
   * @param {string}      event.case_id
   * @param {string}      [event.session_id]
   * @param {string}      event.event_type
   * @param {string}      event.summary
   * @param {string[]}    [event.entity_keys]
   * @param {string}      [event.source_fragment_id]
   * @param {number}      [event.source_search_event_id]
   * @param {number|null} [event.key_id]
   * @returns {Promise<{ event_id: string, sequence_no: number }>}
   */
  async append(event) {
    const pool = getPrimaryPool();
    if (!pool) throw new Error("Database pool not available");

    const client = await pool.connect();
    try {
      await client.query(buildSearchPath(SCHEMA));
      await client.query("BEGIN");

      /** sequence_no: 동일 case_id 내 MAX(sequence_no) + 1, 없으면 0. FOR UPDATE로 경쟁 조건 방지. */
      const seqResult = await client.query(
        `SELECT COALESCE(MAX(sequence_no), -1) + 1 AS next_seq
           FROM ${SCHEMA}.case_events
          WHERE case_id = $1
            FOR UPDATE`,
        [event.case_id]
      );
      const seqNo = seqResult.rows[0].next_seq;

      const insertResult = await client.query(
        `INSERT INTO ${SCHEMA}.case_events
                (case_id, session_id, sequence_no, event_type, summary,
                 entity_keys, source_fragment_id, source_search_event_id, key_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING event_id, sequence_no`,
        [
          event.case_id,
          event.session_id             ?? null,
          seqNo,
          event.event_type,
          event.summary,
          event.entity_keys            ?? [],
          event.source_fragment_id     ?? null,
          event.source_search_event_id ?? null,
          event.key_id                 ?? null
        ]
      );

      await client.query("COMMIT");

      const row = insertResult.rows[0];
      return { event_id: row.event_id, sequence_no: row.sequence_no };

    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * case_event_edges에 방향성 엣지를 추가한다.
   * 이미 존재하는 경우 무시한다.
   *
   * @param {string} fromEventId
   * @param {string} toEventId
   * @param {string} edgeType    - 'caused_by' | 'resolved_by' | 'preceded_by' | 'contradicts'
   * @param {number} [confidence=1.0]
   * @returns {Promise<void>}
   */
  async addEdge(fromEventId, toEventId, edgeType, confidence = 1.0) {
    const pool = getPrimaryPool();
    if (!pool) throw new Error("Database pool not available");

    await pool.query(
      `INSERT INTO ${SCHEMA}.case_event_edges
              (from_event_id, to_event_id, edge_type, confidence)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (from_event_id, to_event_id, edge_type) DO NOTHING`,
      [fromEventId, toEventId, edgeType, confidence]
    );
  }

  /**
   * fragment_evidence에 증거 링크를 추가한다.
   * 이미 존재하는 경우 무시한다.
   *
   * @param {string} fragmentId
   * @param {string} eventId
   * @param {string} kind        - 'supports' | 'contradicts' | 'produced_by'
   * @param {number} [confidence=1.0]
   * @returns {Promise<void>}
   */
  async addEvidence(fragmentId, eventId, kind, confidence = 1.0) {
    const pool = getPrimaryPool();
    if (!pool) throw new Error("Database pool not available");

    await pool.query(
      `INSERT INTO ${SCHEMA}.fragment_evidence
              (fragment_id, event_id, kind, confidence)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (fragment_id, event_id, kind) DO NOTHING`,
      [fragmentId, eventId, kind, confidence]
    );
  }

  /**
   * 특정 case_id의 이벤트 목록을 시간순으로 조회한다.
   *
   * @param {string}      caseId
   * @param {Object}      [opts={}]
   * @param {number}      [opts.limit=100]
   * @param {string}      [opts.from]      - ISO8601 하한 (created_at >=)
   * @param {string}      [opts.to]        - ISO8601 상한 (created_at <=)
   * @param {string}      [opts.eventType] - 특정 event_type 필터
   * @param {number|null} [opts.keyId]     - API 키 격리 필터
   * @returns {Promise<Object[]>}
   */
  async getByCase(caseId, opts = {}) {
    const pool  = getPrimaryPool();
    if (!pool) return [];

    const limit     = Math.min(opts.limit ?? 100, 500);
    const keyId     = opts.keyId     ?? null;
    const eventType = opts.eventType ?? null;

    const params  = [caseId];
    const clauses = [];

    /** 시간 범위 */
    if (opts.from) {
      params.push(opts.from);
      clauses.push(`created_at >= $${params.length}::timestamptz`);
    }
    if (opts.to) {
      params.push(opts.to);
      clauses.push(`created_at <= $${params.length}::timestamptz`);
    }

    /** event_type 필터 */
    if (eventType) {
      params.push(eventType);
      clauses.push(`event_type = $${params.length}`);
    }

    /** key_id 격리 */
    params.push(keyId);
    clauses.push(`(key_id IS NULL OR key_id = $${params.length})`);

    /** limit */
    params.push(limit);
    const limitIdx = params.length;

    const whereExtra = clauses.length > 0 ? `AND ${clauses.join(" AND ")}` : "";

    const sql = `
      SELECT event_id, case_id, session_id, sequence_no, event_type,
             summary, entity_keys, source_fragment_id, source_search_event_id,
             key_id, created_at
        FROM ${SCHEMA}.case_events
       WHERE case_id = $1
         ${whereExtra}
       ORDER BY created_at ASC, sequence_no ASC
       LIMIT $${limitIdx}`;

    const { rows } = await pool.query(sql, params);
    return rows;
  }

  /**
   * 특정 session_id의 이벤트 목록을 시간순으로 조회한다.
   *
   * @param {string}      sessionId
   * @param {Object}      [opts={}]
   * @param {number}      [opts.limit=50]
   * @param {number|null} [opts.keyId]
   * @returns {Promise<Object[]>}
   */
  async getBySession(sessionId, opts = {}) {
    const pool = getPrimaryPool();
    if (!pool) return [];

    const limit = Math.min(opts.limit ?? 50, 500);
    const keyId = opts.keyId ?? null;

    const params = [sessionId, keyId, limit];

    const { rows } = await pool.query(
      `SELECT event_id, case_id, session_id, sequence_no, event_type,
              summary, entity_keys, source_fragment_id, source_search_event_id,
              key_id, created_at
         FROM ${SCHEMA}.case_events
        WHERE session_id = $1
          AND (key_id IS NULL OR key_id = $2)
        ORDER BY created_at ASC, sequence_no ASC
        LIMIT $3`,
      params
    );
    return rows;
  }

  /**
   * 이벤트 ID 배열에 연결된 엣지를 양방향으로 조회한다.
   *
   * @param {string[]} eventIds
   * @returns {Promise<Object[]>}
   */
  async getEdgesByEvents(eventIds) {
    if (!eventIds || eventIds.length === 0) return [];

    const pool = getPrimaryPool();
    if (!pool) return [];

    const { rows } = await pool.query(
      `SELECT from_event_id, to_event_id, edge_type, confidence
         FROM ${SCHEMA}.case_event_edges
        WHERE from_event_id = ANY($1::uuid[])
           OR to_event_id   = ANY($1::uuid[])`,
      [eventIds]
    );
    return rows;
  }

  /**
   * 90일 이상 경과한 이벤트를 삭제한다.
   * case_event_edges, fragment_evidence는 CASCADE로 자동 삭제된다.
   *
   * @returns {Promise<number>} 삭제된 이벤트 건수
   */
  async deleteExpired() {
    const pool = getPrimaryPool();
    if (!pool) return 0;

    const result = await pool.query(
      `DELETE FROM ${SCHEMA}.case_events
        WHERE created_at < NOW() - INTERVAL '90 days'`
    ).catch(err => {
      logWarn(`[CaseEventStore] deleteExpired failed: ${err.message}`);
      return { rowCount: 0 };
    });

    return result.rowCount ?? 0;
  }
}
