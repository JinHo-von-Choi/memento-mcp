/**
 * FragmentReader - PostgreSQL 파편 읽기 전용 작업
 *
 * 작성자: 최진호
 * 작성일: 2026-03-15
 */

import { queryWithAgentVector } from "../tools/db.js";
import { vectorToSql }          from "../tools/embedding.js";

const SCHEMA = "agent_memory";

export class FragmentReader {

  /**
   * ID로 파편 조회
   */
  async getById(id, agentId = "default") {
    const result = await queryWithAgentVector(agentId,
      `SELECT id, content, topic, keywords, type, importance, utility_score,
                    source, linked_to, agent_id, access_count,
                    accessed_at, created_at, ttl_tier, verified_at, is_anchor, key_id
             FROM ${SCHEMA}.fragments WHERE id = $1`,
      [id]
    );

    return result.rows[0] || null;
  }

  /**
   * 복수 ID로 파편 조회
   *
   * @param {string[]}    ids
   * @param {string}      agentId
   * @param {string|null} keyId - null: 마스터(전체), string: 해당 API 키 소유만
   */
  async getByIds(ids, agentId = "default", keyId = null) {
    if (ids.length === 0) return [];

    const whereClause = keyId
      ? "WHERE id = ANY($1) AND key_id = ANY($2)"
      : "WHERE id = ANY($1)";
    const params      = keyId ? [ids, keyId] : [ids];

    const result = await queryWithAgentVector(agentId,
      `SELECT id, content, topic, keywords, type, importance, utility_score,
                    source, linked_to, agent_id, access_count,
                    accessed_at, created_at, ttl_tier, verified_at, is_anchor, valid_to
             FROM ${SCHEMA}.fragments
             ${whereClause}
             ORDER BY importance DESC, accessed_at DESC NULLS LAST`,
      params
    );

    return result.rows;
  }

  /**
   * 파편의 전체 변경 이력 조회 (fragment_versions + superseded_by 체인)
   *
   * @param {string} fragmentId
   * @param {string} agentId
   * @returns {Promise<Object>} { current, versions, superseded_by_chain }
   */
  async getHistory(fragmentId, agentId = "default") {
    const current = await this.getById(fragmentId, agentId);

    const versions = await queryWithAgentVector(agentId,
      `SELECT fragment_id, content, topic, keywords, type, importance,
              amended_by, amended_at
       FROM ${SCHEMA}.fragment_versions
       WHERE fragment_id = $1
       ORDER BY amended_at DESC`,
      [fragmentId]
    );

    const chain = await queryWithAgentVector(agentId,
      `SELECT fl.to_id, f.content, f.created_at, f.valid_from
       FROM ${SCHEMA}.fragment_links fl
       JOIN ${SCHEMA}.fragments f ON f.id = fl.to_id
       WHERE fl.from_id = $1 AND fl.relation_type = 'superseded_by'
       ORDER BY f.created_at ASC`,
      [fragmentId]
    );

    return {
      current            : current || null,
      versions           : versions.rows,
      superseded_by_chain: chain.rows
    };
  }

  /**
   * 키워드 기반 검색 (GIN 인덱스)
   */
  async searchByKeywords(keywords, options = {}) {
    const agentId    = options.agentId || "default";
    const conditions = ["keywords && $1"];
    const params     = [keywords];
    let paramIdx     = 2;

    if (options.type) {
      conditions.push(`type = $${paramIdx}`);
      params.push(options.type);
      paramIdx++;
    }
    if (options.topic) {
      conditions.push(`topic = $${paramIdx}`);
      params.push(options.topic);
      paramIdx++;
    }
    if (options.minImportance) {
      conditions.push(`importance >= $${paramIdx}`);
      params.push(options.minImportance);
      paramIdx++;
    }
    if (options.isAnchor !== undefined) {
      conditions.push(`is_anchor = $${paramIdx}`);
      params.push(options.isAnchor);
      paramIdx++;
    }

    /** API 키 격리 필터: keyId가 있으면 해당 키 소유 파편만 조회 */
    if (options.keyId) {
      conditions.push(`key_id = ANY($${paramIdx})`);
      params.push(options.keyId);
      paramIdx++;
    }

    /** superseded 파편 필터: includeSuperseded가 아니면 valid_to IS NULL만 조회 */
    if (!options.includeSuperseded) {
      conditions.push("valid_to IS NULL");
    }

    /** timeRange 필터 (created_at 기준) */
    if (options.timeRange) {
      if (options.timeRange.from) {
        conditions.push(`created_at >= $${paramIdx}`);
        params.push(options.timeRange.from);
        paramIdx++;
      }
      if (options.timeRange.to) {
        conditions.push(`created_at < $${paramIdx}`);
        params.push(options.timeRange.to);
        paramIdx++;
      }
    }

    const limit = options.limit || 20;
    params.push(limit);

    const result = await queryWithAgentVector(agentId,
      `SELECT f.id, f.content, f.topic, f.keywords, f.type, f.importance, f.utility_score,
                    f.linked_to, f.access_count, f.created_at, f.verified_at, f.is_anchor, f.valid_to
             FROM ${SCHEMA}.fragments f
             WHERE ${conditions.join(" AND ")}
             ORDER BY f.importance DESC, f.created_at DESC
             LIMIT $${paramIdx}`,
      params
    );

    return result.rows;
  }

  /**
   * 토픽 기반 검색 (L2 fallback)
   */
  async searchByTopic(topic, options = {}) {
    const agentId    = options.agentId || "default";
    const conditions = ["topic = $1"];
    const params     = [topic];
    let paramIdx     = 2;

    if (options.type) {
      conditions.push(`type = $${paramIdx}`);
      params.push(options.type);
      paramIdx++;
    }
    if (options.minImportance) {
      conditions.push(`importance >= $${paramIdx}`);
      params.push(options.minImportance);
      paramIdx++;
    }
    if (options.keyId) {
      conditions.push(`key_id = ANY($${paramIdx})`);
      params.push(options.keyId);
      paramIdx++;
    }
    if (!options.includeSuperseded) {
      conditions.push("valid_to IS NULL");
    }

    /** timeRange 필터 (created_at 기준) */
    if (options.timeRange) {
      if (options.timeRange.from) {
        conditions.push(`created_at >= $${paramIdx}`);
        params.push(options.timeRange.from);
        paramIdx++;
      }
      if (options.timeRange.to) {
        conditions.push(`created_at < $${paramIdx}`);
        params.push(options.timeRange.to);
        paramIdx++;
      }
    }

    const limit = options.limit || 20;
    params.push(limit);

    const result = await queryWithAgentVector(agentId,
      `SELECT f.id, f.content, f.topic, f.keywords, f.type, f.importance, f.utility_score,
              f.linked_to, f.access_count, f.created_at, f.verified_at, f.is_anchor, f.valid_to
         FROM ${SCHEMA}.fragments f
         WHERE ${conditions.join(" AND ")}
         ORDER BY f.importance DESC, f.created_at DESC
         LIMIT $${paramIdx}`,
      params
    );

    return result.rows;
  }

  /**
   * 벡터 유사도 검색
   *
   * @param {number[]}    queryEmbedding
   * @param {number}      limit
   * @param {number}      minSimilarity
   * @param {string}      agentId
   * @param {string|null} keyId - null: 마스터(전체), string: 해당 API 키 소유만
   * @param {boolean}     includeSuperseded
   */
  async searchBySemantic(queryEmbedding, limit = 10, minSimilarity = 0.3, agentId = "default", keyId = null, includeSuperseded = false, timeRange = null) {
    const vecStr     = vectorToSql(queryEmbedding);
    const conditions = [
      "f.embedding IS NOT NULL",
      `1 - (f.embedding <=> $1::vector) >= $2`
    ];
    const params     = [vecStr, minSimilarity, limit];
    let   paramIdx   = 4;

    /** API 키 격리 필터 */
    if (keyId) {
      conditions.push(`f.key_id = ANY($${paramIdx})`);
      params.push(keyId);
      paramIdx++;
    }

    /** superseded 파편 필터: includeSuperseded가 아니면 valid_to IS NULL만 조회 */
    if (!includeSuperseded) {
      conditions.push("f.valid_to IS NULL");
    }

    /** timeRange 필터 (created_at 기준) */
    if (timeRange) {
      if (timeRange.from) {
        conditions.push(`f.created_at >= $${paramIdx}`);
        params.push(timeRange.from);
        paramIdx++;
      }
      if (timeRange.to) {
        conditions.push(`f.created_at < $${paramIdx}`);
        params.push(timeRange.to);
        paramIdx++;
      }
    }

    const result = await queryWithAgentVector(agentId,
      `SELECT f.id, f.content, f.topic, f.keywords, f.type, f.importance, f.utility_score,
                    f.linked_to, f.access_count, f.created_at, f.verified_at, f.is_anchor, f.valid_to,
                    1 - (f.embedding <=> $1::vector) AS similarity
             FROM ${SCHEMA}.fragments f
             WHERE ${conditions.join(" AND ")}
             ORDER BY f.embedding <=> $1::vector ASC
             LIMIT $3`,
      params
    );

    return result.rows;
  }

  /**
   * source 필드 기반 파편 검색
   *
   * @param {string}      source  - 파편 source 값 (예: "learning_extraction")
   * @param {string}      agentId - 에이전트 ID (RLS 격리용)
   * @param {string|null} keyId   - null: 마스터(전체), string: 해당 API 키 소유만
   * @param {number}      limit   - 최대 반환 수 (기본 5)
   * @returns {Promise<Object[]>} 파편 배열
   */
  async searchBySource(source, agentId, keyId, limit = 5) {
    let query = `SELECT id, content, topic, type, keywords, importance, source,
                        agent_id, created_at, is_anchor, access_count, accessed_at
                 FROM ${SCHEMA}.fragments
                 WHERE source = $1 AND (valid_to IS NULL OR valid_to > NOW())`;
    const params = [source];
    if (keyId) {
      params.push(keyId);
      query += ` AND key_id = $${params.length}`;
    }
    query += ` ORDER BY importance DESC, created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);
    const result = await queryWithAgentVector(agentId, query, params);
    return result.rows || [];
  }

  /**
   * 특정 시점 기준 파편 조회 (Point-in-time Query)
   *
   * valid_from <= asOf AND (valid_to IS NULL OR valid_to > asOf) 조건으로
   * 해당 시점에 유효했던 파편 집합을 반환한다.
   *
   * @param {string} asOf     - ISO 8601 타임스탬프 (예: '2026-01-15T00:00:00Z')
   * @param {string} agentId  - 에이전트 ID (RLS 격리용)
   * @param {Object} opts     - 옵션
   *   - limit  {number} 최대 반환 수 (기본 50)
   *   - topic  {string} 주제 필터 (선택)
   *   - type   {string} 유형 필터 (선택)
   * @returns {Promise<Object[]>} 파편 배열
   */
  async searchAsOf(asOf, agentId = "default", opts = {}, keyId = null) {
    const tsDate = new Date(asOf);
    if (isNaN(tsDate.getTime())) {
      throw new Error(`searchAsOf: invalid asOf value "${asOf}"`);
    }
    const ts         = tsDate.toISOString();
    const conditions = [
      "agent_id   = $1",
      "valid_from <= $2::timestamptz",
      "(valid_to IS NULL OR valid_to > $2::timestamptz)"
    ];
    const params     = [agentId, ts];
    let paramIdx     = 3;

    if (opts.topic) {
      conditions.push(`topic = $${paramIdx}`);
      params.push(opts.topic);
      paramIdx++;
    }

    if (opts.type) {
      conditions.push(`type = $${paramIdx}`);
      params.push(opts.type);
      paramIdx++;
    }

    if (keyId) {
      conditions.push(`key_id = ANY($${paramIdx})`);
      params.push(keyId);
      paramIdx++;
    }

    params.push(opts.limit ?? 50);

    const { rows } = await queryWithAgentVector(agentId, `
      SELECT id, content, topic, type, importance, keywords,
             valid_from, valid_to, created_at, verified_at, is_anchor, estimated_tokens
      FROM   ${SCHEMA}.fragments
      WHERE  ${conditions.join("\n        AND  ")}
      ORDER  BY importance DESC
      LIMIT  $${paramIdx}
    `, params);

    return rows;
  }
}
