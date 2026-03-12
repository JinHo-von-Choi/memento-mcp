/**
 * LinkStore — 파편 링크 관리 (fragment_links 테이블 CRUD + RCA 체인)
 *
 * 작성자: 최진호
 * 작성일: 2026-03-12
 */

import { queryWithAgentVector } from "../tools/db.js";
import { MEMORY_CONFIG }        from "../../config/memory.js";

const SCHEMA = "agent_memory";

export class LinkStore {
  /**
   * fragment_links에 링크를 생성하고 양방향 linked_to 배열을 갱신한다.
   *
   * @param {string} fromId
   * @param {string} toId
   * @param {string} relationType
   * @param {string} agentId
   */
  async createLink(fromId, toId, relationType = "related", agentId = "default") {
    await queryWithAgentVector(agentId,
      `INSERT INTO ${SCHEMA}.fragment_links (from_id, to_id, relation_type, weight)
             VALUES ($1, $2, $3, 1)
             ON CONFLICT (from_id, to_id) DO UPDATE
               SET relation_type = EXCLUDED.relation_type,
                   weight        = ${SCHEMA}.fragment_links.weight + 1`,
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
   *
   * @param {string[]}    fromIds
   * @param {string|null} relationType
   * @param {string}      agentId
   * @param {number|null} keyId  - API 키 격리 필터 (null=master, 전체 조회)
   * @returns {Promise<object[]>}
   */
  async getLinkedFragments(fromIds, relationType = null, agentId = "default", keyId = null) {
    if (fromIds.length === 0) return [];

    const ALLOWED_RELATION_TYPES = new Set([
      "related", "caused_by", "resolved_by", "part_of", "contradicts", "superseded_by"
    ]);
    const safeRelationType = relationType && ALLOWED_RELATION_TYPES.has(relationType)
      ? relationType
      : null;

    let result;
    if (safeRelationType) {
      const params    = [fromIds, safeRelationType];
      let keyFilter   = "";
      if (keyId != null) {
        params.push(keyId);
        keyFilter = `AND f.key_id = $${params.length}`;
      }
      result = await queryWithAgentVector(agentId,
        `SELECT DISTINCT ON (f.id)
                         f.id, f.content, f.topic, f.keywords, f.type,
                         f.importance, f.linked_to, f.access_count,
                         f.created_at, f.verified_at, l.relation_type,
                         COALESCE(l.weight, 1) AS link_weight,
                         CASE l.relation_type
                           WHEN 'resolved_by' THEN 1
                           WHEN 'caused_by'   THEN 2
                           ELSE 3
                         END AS relation_order
         FROM ${SCHEMA}.fragment_links l
         JOIN ${SCHEMA}.fragments f ON l.to_id = f.id
         WHERE l.from_id = ANY($1)
           AND l.relation_type = $2
           ${keyFilter}
         ORDER BY f.id, link_weight DESC, relation_order, f.importance DESC
         LIMIT ${MEMORY_CONFIG.linkedFragmentLimit}`,
        params
      );
    } else {
      const params    = [fromIds];
      let keyFilter   = "";
      if (keyId != null) {
        params.push(keyId);
        keyFilter = `AND f.key_id = $${params.length}`;
      }
      result = await queryWithAgentVector(agentId,
        `SELECT DISTINCT ON (f.id)
                         f.id, f.content, f.topic, f.keywords, f.type,
                         f.importance, f.linked_to, f.access_count,
                         f.created_at, f.verified_at, l.relation_type,
                         COALESCE(l.weight, 1) AS link_weight,
                         CASE l.relation_type
                           WHEN 'resolved_by' THEN 1
                           WHEN 'caused_by'   THEN 2
                           ELSE 3
                         END AS relation_order
         FROM ${SCHEMA}.fragment_links l
         JOIN ${SCHEMA}.fragments f ON l.to_id = f.id
         WHERE l.from_id = ANY($1)
           AND l.relation_type IN ('caused_by', 'resolved_by', 'related')
           ${keyFilter}
         ORDER BY f.id, link_weight DESC, relation_order, f.importance DESC
         LIMIT ${MEMORY_CONFIG.linkedFragmentLimit}`,
        params
      );
    }

    return result.rows;
  }

  /**
   * 연결된 파편 ID 조회 (1-hop)
   *
   * @param {string} fragmentId
   * @param {string} agentId
   * @returns {Promise<string[]>}
   */
  async getLinkedIds(fragmentId, agentId = "default") {
    const result = await queryWithAgentVector(agentId,
      `SELECT linked_to FROM ${SCHEMA}.fragments WHERE id = $1`,
      [fragmentId]
    );

    return result.rows[0]?.linked_to || [];
  }

  /**
   * 재귀 CTE로 startId에서 targetId까지 도달 가능 여부를 판정한다.
   * linked_to 배열(정방향)만 추적하며 최대 20홉 제한.
   *
   * @param {string} startId  - 탐색 시작 파편
   * @param {string} targetId - 도달 목표 파편
   * @param {string} agentId
   * @returns {Promise<boolean>}
   */
  async isReachable(startId, targetId, agentId = "default") {
    const result = await queryWithAgentVector(agentId,
      `WITH RECURSIVE reachable AS (
         SELECT unnest(linked_to) AS id, 1 AS depth
         FROM ${SCHEMA}.fragments
         WHERE id = $1
       UNION
         SELECT unnest(f.linked_to), r.depth + 1
         FROM reachable r
         JOIN ${SCHEMA}.fragments f ON f.id = r.id
         WHERE r.depth < 20
           AND r.id != $2
       )
       SELECT EXISTS (SELECT 1 FROM reachable WHERE id = $2) AS found`,
      [startId, targetId]
    );
    return result.rows[0]?.found === true;
  }

  /**
   * RCA 체인 조회 (caused_by, resolved_by 1-hop)
   *
   * @param {string} startId
   * @param {string} agentId
   * @returns {Promise<object[]>}
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
}
