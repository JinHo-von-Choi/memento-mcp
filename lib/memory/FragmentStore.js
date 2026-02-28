/**
 * FragmentStore - PostgreSQL 파편 CRUD
 *
 * 작성자: 최진호
 * 작성일: 2026-02-23
 * 수정일: 2026-02-25
 */

import { getPrimaryPool, queryWithAgentVector }   from "../tools/db.js";
import { MEMORY_CONFIG }     from "../../config/memory.js";
import {
  computeContentHash,
  prepareTextForEmbedding,
  generateEmbedding,
  vectorToSql,
  OPENAI_API_KEY
} from "../tools/embedding.js";

const SCHEMA = "agent_memory";

export class FragmentStore {
  constructor() {
    this.schemaInitialized = false;
  }

  /**
     * 스키마 초기화 확인 (최초 1회)
     */
  async ensureSchema() {
    if (this.schemaInitialized) return;

    const pool = getPrimaryPool();
    if (!pool) return;

    try {
      // 스키마 생성은 'default' 컨텍스트에서 수행
      await queryWithAgentVector("default", `CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`, [], "write");
      this.schemaInitialized = true;
    } catch (err) {
      console.warn(`[FragmentStore] Schema check failed: ${err.message}`);
    }
  }

  /**
     * 파편 저장
     * @returns {string|null} fragment id
     */
  async insert(fragment) {
    const pool = getPrimaryPool();
    if (!pool) return null;

    await this.ensureSchema();

    const agentId = fragment.agent_id || "default";
    const contentHash = computeContentHash(fragment.content);

    /** 중복 검사 (RLS 적용) */
    const dup = await queryWithAgentVector(agentId,
      `SELECT id FROM ${SCHEMA}.fragments WHERE content_hash = $1`,
      [contentHash]
    );
    if (dup.rows.length > 0) {
      return dup.rows[0].id;
    }

    let embeddingStr = null;
    if (fragment.importance > 0.5 && OPENAI_API_KEY) {
      try {
        const text = prepareTextForEmbedding(fragment.content, 500);
        const vec  = await generateEmbedding(text);
        embeddingStr = vectorToSql(vec);
      } catch (err) {
        console.warn(`[FragmentStore] Embedding failed: ${err.message}`);
      }
    }

    const estimatedTokens = fragment.estimated_tokens || Math.ceil((fragment.content || "").length / 4);

    const insertSql = `INSERT INTO ${SCHEMA}.fragments
                (id, content, topic, keywords, type, importance, content_hash,
                 source, linked_to, agent_id, ttl_tier, estimated_tokens, embedding)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                     ${embeddingStr ? "$13::vector" : "NULL"})
             ON CONFLICT (content_hash) DO UPDATE SET
                importance  = GREATEST(${SCHEMA}.fragments.importance, EXCLUDED.importance),
                accessed_at = NOW()
             RETURNING id`;

    const insertParams = [
      fragment.id,
      fragment.content,
      fragment.topic,
      fragment.keywords || [],
      fragment.type,
      fragment.importance || 0.5,
      contentHash,
      fragment.source || null,
      fragment.linked_to || [],
      agentId,
      fragment.ttl_tier || "warm",
      estimatedTokens,
      ...(embeddingStr ? [embeddingStr] : [])
    ];

    const result = await queryWithAgentVector(agentId, insertSql, insertParams, "write");

    return result.rows[0]?.id || fragment.id;
  }

  /**
   * 파편의 현재 상태를 이력 테이블에 저장
   */
  async archiveVersion(fragment, agentId = "default") {
    await queryWithAgentVector(agentId,
      `INSERT INTO ${SCHEMA}.fragment_versions
                (fragment_id, content, topic, keywords, type, importance, amended_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        fragment.id,
        fragment.content,
        fragment.topic,
        fragment.keywords,
        fragment.type,
        fragment.importance,
        agentId
      ],
      "write"
    ).catch(err => console.warn(`[FragmentStore] archiveVersion failed: ${err.message}`));
  }

  /**
     * ID로 파편 조회
     */
  async getById(id, agentId = "default") {
    const result = await queryWithAgentVector(agentId,
      `SELECT id, content, topic, keywords, type, importance,
                    source, linked_to, agent_id, access_count,
                    accessed_at, created_at, ttl_tier, verified_at, is_anchor
             FROM ${SCHEMA}.fragments WHERE id = $1`,
      [id]
    );

    return result.rows[0] || null;
  }

  /**
     * 복수 ID로 파편 조회
     */
  async getByIds(ids, agentId = "default") {
    if (ids.length === 0) return [];

    const result = await queryWithAgentVector(agentId,
      `SELECT id, content, topic, keywords, type, importance,
                    source, linked_to, agent_id, access_count,
                    accessed_at, created_at, ttl_tier, verified_at, is_anchor
             FROM ${SCHEMA}.fragments
             WHERE id = ANY($1)
             ORDER BY importance DESC, accessed_at DESC NULLS LAST`,
      [ids]
    );

    return result.rows;
  }

  /**
     * 키워드 기반 검색 (GIN 인덱스)
     */
  async searchByKeywords(keywords, options = {}) {
    const agentId = options.agentId || "default";
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

    const limit = options.limit || 20;
    params.push(limit);

    const result = await queryWithAgentVector(agentId,
      `SELECT f.id, f.content, f.topic, f.keywords, f.type, f.importance,
                    f.linked_to, f.access_count, f.created_at, f.verified_at, f.is_anchor
             FROM ${SCHEMA}.fragments f
             WHERE ${conditions.join(" AND ")}
               AND NOT EXISTS (
                 SELECT 1 FROM ${SCHEMA}.fragment_links l
                 WHERE l.from_id = f.id AND l.relation_type = 'superseded_by'
               )
             ORDER BY f.importance DESC, f.created_at DESC
             LIMIT $${paramIdx}`,
      params
    );

    return result.rows;
  }

  /**
     * 벡터 유사도 검색
     */
  async searchBySemantic(queryEmbedding, limit = 10, minSimilarity = 0.3, agentId = "default") {
    const vecStr = vectorToSql(queryEmbedding);

    const result = await queryWithAgentVector(agentId,
      `SELECT f.id, f.content, f.topic, f.keywords, f.type, f.importance,
                    f.linked_to, f.access_count, f.created_at, f.verified_at, f.is_anchor,
                    1 - (f.embedding <=> $1::vector) AS similarity
             FROM ${SCHEMA}.fragments f
             WHERE f.embedding IS NOT NULL
               AND 1 - (f.embedding <=> $1::vector) >= $2
               AND NOT EXISTS (
                 SELECT 1 FROM ${SCHEMA}.fragment_links l
                 WHERE l.from_id = f.id AND l.relation_type = 'superseded_by'
               )
             ORDER BY f.embedding <=> $1::vector ASC
             LIMIT $3`,
      [vecStr, minSimilarity, limit]
    );

    return result.rows;
  }

  /**
     * 접근 횟수 증가
     */
  async incrementAccess(ids, agentId = "default") {
    if (ids.length === 0) return;

    await queryWithAgentVector(agentId,
      `UPDATE ${SCHEMA}.fragments
             SET access_count = access_count + 1,
                 accessed_at  = NOW()
             WHERE id = ANY($1)`,
      [ids],
      "write"
    ).catch(err => console.warn(`[FragmentStore] incrementAccess failed: ${err.message}`));
  }

  /**
     * 파편 수정 (amend)
     *
     * @param {string} id - 갱신 대상 파편 ID
     * @param {Object} updates - 갱신할 필드 { content, topic, keywords, type, importance, is_anchor }
     * @param {string} agentId - 에이전트 ID
     * @returns {Object|null} 갱신된 파편
     */
  async update(id, updates, agentId = "default") {
    const existing = await this.getById(id, agentId);
    if (!existing) return null;

    /** 수정 전 상태 아카이빙 (버전 관리) */
    await this.archiveVersion(existing, agentId);

    const setClauses = [];
    const params     = [id];
    let paramIdx     = 2;

    if (updates.content !== undefined) {
      const newHash = computeContentHash(updates.content);

      const dup = await queryWithAgentVector(agentId,
        `SELECT id FROM ${SCHEMA}.fragments
                 WHERE content_hash = $1 AND id != $2`,
        [newHash, id]
      );
      if (dup.rows.length > 0) {
        return { merged: true, existingId: dup.rows[0].id };
      }

      setClauses.push(`content = $${paramIdx}`);
      params.push(updates.content);
      paramIdx++;

      setClauses.push(`content_hash = $${paramIdx}`);
      params.push(newHash);
      paramIdx++;

      setClauses.push("embedding = NULL");
    }

    if (updates.topic !== undefined) {
      setClauses.push(`topic = $${paramIdx}`);
      params.push(updates.topic);
      paramIdx++;
    }

    if (updates.keywords !== undefined) {
      setClauses.push(`keywords = $${paramIdx}`);
      params.push(updates.keywords);
      paramIdx++;
    }

    if (updates.type !== undefined) {
      setClauses.push(`type = $${paramIdx}`);
      params.push(updates.type);
      paramIdx++;
    }

    if (updates.importance !== undefined) {
      setClauses.push(`importance = $${paramIdx}`);
      params.push(updates.importance);
      paramIdx++;
    }

    if (updates.is_anchor !== undefined) {
      setClauses.push(`is_anchor = $${paramIdx}`);
      params.push(updates.is_anchor);
      paramIdx++;
    }

    if (setClauses.length === 0) return existing;

    setClauses.push("verified_at = NOW()");
    setClauses.push("accessed_at = NOW()");

    const result = await queryWithAgentVector(agentId,
      `UPDATE ${SCHEMA}.fragments
             SET ${setClauses.join(", ")}
             WHERE id = $1
             RETURNING id, content, topic, keywords, type, importance,
                       source, linked_to, agent_id, access_count,
                       accessed_at, created_at, ttl_tier, verified_at, is_anchor`,
      params,
      "write"
    );

    return result.rows[0] || null;
  }

  /**
     * 파편 삭제
     */
  async delete(id, agentId = "default") {
    /** fragment_links 테이블에서 관련 링크 제거 (CASCADE 보충) */
    await queryWithAgentVector(agentId,
      `DELETE FROM ${SCHEMA}.fragment_links
             WHERE from_id = $1 OR to_id = $1`,
      [id],
      "write"
    ).catch(() => {});

    /** linked_to 배열에서 제거 */
    await queryWithAgentVector(agentId,
      `UPDATE ${SCHEMA}.fragments
             SET linked_to = array_remove(linked_to, $1)
             WHERE $1 = ANY(linked_to)`,
      [id],
      "write"
    );

    const result = await queryWithAgentVector(agentId,
      `DELETE FROM ${SCHEMA}.fragments WHERE id = $1`,
      [id],
      "write"
    );

    return result.rowCount > 0;
  }

  /**
     * 파편 간 링크 생성
     */
  async createLink(fromId, toId, relationType = "related", agentId = "default") {
    await queryWithAgentVector(agentId,
      `INSERT INTO ${SCHEMA}.fragment_links (from_id, to_id, relation_type)
             VALUES ($1, $2, $3)
             ON CONFLICT (from_id, to_id) DO UPDATE SET relation_type = $3`,
      [fromId, toId, relationType],
      "write"
    );

    /** 양방향 linked_to 갱신 */
    await queryWithAgentVector(agentId,
      `UPDATE ${SCHEMA}.fragments
             SET linked_to = array_append(
                 CASE WHEN NOT ($2 = ANY(linked_to)) THEN linked_to ELSE linked_to END, $2
             )
             WHERE id = $1 AND NOT ($2 = ANY(linked_to))`,
      [fromId, toId],
      "write"
    );
    await queryWithAgentVector(agentId,
      `UPDATE ${SCHEMA}.fragments
             SET linked_to = array_append(
                 CASE WHEN NOT ($1 = ANY(linked_to)) THEN linked_to ELSE linked_to END, $1
             )
             WHERE id = $2 AND NOT ($1 = ANY(linked_to))`,
      [fromId, toId],
      "write"
    );
  }

  /**
     * fragment_links 테이블에서 1-hop 연결 파편 조회
     */
  async getLinkedFragments(fromIds, relationType = null, agentId = "default") {
    if (fromIds.length === 0) return [];

    const ALLOWED_RELATION_TYPES = new Set([
      "related", "caused_by", "resolved_by", "part_of", "contradicts", "superseded_by"
    ]);
    const safeRelationType = relationType && ALLOWED_RELATION_TYPES.has(relationType)
      ? relationType
      : null;

    let result;
    if (safeRelationType) {
      result = await queryWithAgentVector(agentId,
        `SELECT DISTINCT f.id, f.content, f.topic, f.keywords, f.type,
                         f.importance, f.linked_to, f.access_count,
                         f.created_at, f.verified_at, l.relation_type
         FROM ${SCHEMA}.fragment_links l
         JOIN ${SCHEMA}.fragments f ON l.to_id = f.id
         WHERE l.from_id = ANY($1)
           AND l.relation_type = $2
         ORDER BY
           CASE l.relation_type
             WHEN 'resolved_by' THEN 1
             WHEN 'caused_by'   THEN 2
             ELSE 3
           END,
           f.importance DESC
         LIMIT ${MEMORY_CONFIG.linkedFragmentLimit}`,
        [fromIds, safeRelationType]
      );
    } else {
      result = await queryWithAgentVector(agentId,
        `SELECT DISTINCT f.id, f.content, f.topic, f.keywords, f.type,
                         f.importance, f.linked_to, f.access_count,
                         f.created_at, f.verified_at, l.relation_type
         FROM ${SCHEMA}.fragment_links l
         JOIN ${SCHEMA}.fragments f ON l.to_id = f.id
         WHERE l.from_id = ANY($1)
           AND l.relation_type IN ('caused_by', 'resolved_by', 'related')
         ORDER BY
           CASE l.relation_type
             WHEN 'resolved_by' THEN 1
             WHEN 'caused_by'   THEN 2
             ELSE 3
           END,
           f.importance DESC
         LIMIT ${MEMORY_CONFIG.linkedFragmentLimit}`,
        [fromIds]
      );
    }

    return result.rows;
  }

  /**
     * 연결된 파편 ID 조회 (1-hop)
     */
  async getLinkedIds(fragmentId, agentId = "default") {
    const result = await queryWithAgentVector(agentId,
      `SELECT linked_to FROM ${SCHEMA}.fragments WHERE id = $1`,
      [fragmentId]
    );

    return result.rows[0]?.linked_to || [];
  }

  /**
     * 만료된 파편 정리 (유지보수용 - 'system' 컨텍스트 사용)
     */
  async deleteExpired() {
    const result = await queryWithAgentVector("system",
      `DELETE FROM ${SCHEMA}.fragments
             WHERE importance < 0.1
               AND ttl_tier NOT IN ('permanent')
               AND is_anchor = FALSE
               AND (accessed_at IS NULL OR accessed_at < NOW() - INTERVAL '90 days')
               AND created_at < NOW() - INTERVAL '90 days'
               AND array_length(linked_to, 1) IS DISTINCT FROM NULL
               AND coalesce(array_length(linked_to, 1), 0) < 2`,
      [],
      "write"
    );

    return result.rowCount;
  }

  /**
     * 중요도 감쇠 (유지보수용 - 'default' 컨텍스트 사용)
     */
  async decayImportance() {
    await queryWithAgentVector("system",
      `UPDATE ${SCHEMA}.fragments
             SET importance = importance * 0.995
             WHERE ttl_tier != 'permanent'
               AND type != 'preference'
               AND is_anchor = FALSE
               AND (accessed_at IS NULL OR accessed_at < NOW() - INTERVAL '1 day')`,
      [],
      "write"
    );
  }

  /**
     * TTL 계층 전환 (유지보수용 - 'system' 컨텍스트 사용)
     */
  async transitionTTL() {
    /** preference → permanent 고정 */
    await queryWithAgentVector("system",
      `UPDATE ${SCHEMA}.fragments SET ttl_tier = 'permanent'
             WHERE type = 'preference' AND ttl_tier != 'permanent'`,
      [],
      "write"
    );

    /** 허브 → permanent 승격 */
    await queryWithAgentVector("system",
      `UPDATE ${SCHEMA}.fragments SET ttl_tier = 'permanent'
             WHERE coalesce(array_length(linked_to, 1), 0) >= 5
               AND ttl_tier != 'permanent'`,
      [],
      "write"
    );

    /** importance >= 0.8 → permanent */
    await queryWithAgentVector("system",
      `UPDATE ${SCHEMA}.fragments SET ttl_tier = 'permanent'
             WHERE importance >= 0.8 AND ttl_tier != 'permanent'`,
      [],
      "write"
    );

    /** warm → cold */
    await queryWithAgentVector("system",
      `UPDATE ${SCHEMA}.fragments SET ttl_tier = 'cold'
             WHERE ttl_tier = 'warm'
               AND (importance < 0.3
                    OR (accessed_at IS NULL AND created_at < NOW() - INTERVAL '30 days')
                    OR accessed_at < NOW() - INTERVAL '30 days')`,
      [],
      "write"
    );
  }

  /**
     * RCA 체인 조회
     */
  async getRCAChain(startId, agentId = "default") {
    const result = await queryWithAgentVector(agentId,
      `WITH rca AS (
         SELECT f.id, f.content, f.type, f.importance, f.topic,
                NULL::text AS relation_type, 0 AS depth
         FROM ${SCHEMA}.fragments f
         WHERE f.id = $1

         UNION ALL

         SELECT f2.id, f2.content, f2.type, f2.importance, f2.topic,
                l.relation_type, 1 AS depth
         FROM ${SCHEMA}.fragment_links l
         JOIN ${SCHEMA}.fragments f2 ON l.to_id = f2.id
         WHERE l.from_id = $1
           AND l.relation_type IN ('caused_by', 'resolved_by')
       )
       SELECT * FROM rca ORDER BY depth ASC, importance DESC`,
      [startId]
    );

    return result.rows;
  }

  /**
     * 누락된 임베딩 보충 (유지보수용 - 'system' 컨텍스트 사용)
     */
  async generateMissingEmbeddings(batchSize = 10) {
    if (!OPENAI_API_KEY) return 0;

    const result = await queryWithAgentVector("system",
      `SELECT id, content FROM ${SCHEMA}.fragments
             WHERE embedding IS NULL AND importance > 0.5
             ORDER BY importance DESC
             LIMIT $1`,
      [batchSize]
    );

    let count = 0;
    for (const row of result.rows) {
      try {
        const text = prepareTextForEmbedding(row.content, 500);
        const vec  = await generateEmbedding(text);
        await queryWithAgentVector("system",
          `UPDATE ${SCHEMA}.fragments SET embedding = $2::vector WHERE id = $1`,
          [row.id, vectorToSql(vec)],
          "write"
        );
        count++;
      } catch (err) {
        console.warn(`[FragmentStore] Embedding gen failed for ${row.id}: ${err.message}`);
      }
    }

    return count;
  }

  /**
   * 삭제 (id 기반, RLS 적용)
   */
  async delete(id, agentId = "default") {
    const result = await queryWithAgentVector(agentId,
      `DELETE FROM ${SCHEMA}.fragments WHERE id = $1`,
      [id],
      "write"
    );
    return result.rowCount > 0;
  }

  /**
   * 에이전트의 모든 데이터 삭제 (GDPR 준수)
   */
  async deleteByAgent(agentId) {
    if (!agentId || agentId === "default") {
      throw new Error("Cannot delete 'default' agent data via this method");
    }

    const result = await queryWithAgentVector(agentId,
      `DELETE FROM ${SCHEMA}.fragments WHERE agent_id = $1`,
      [agentId],
      "write"
    );

    return result.rowCount;
  }
}
