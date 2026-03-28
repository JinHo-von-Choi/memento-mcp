/**
 * GraphNeighborSearch - L2.5 그래프 증강 검색용 1-hop 이웃 조회
 *
 * 작성자: 최진호
 * 작성일: 2026-03-28
 *
 * L2 키워드 검색 상위 파편의 1-hop 이웃을 조회하여
 * RRF 파이프라인에 L2.5 레이어로 투입한다.
 */

import { getPrimaryPool } from "../tools/db.js";

const SCHEMA = "agent_memory";

/**
 * L2 상위 파편 ID에서 1-hop 이웃 파편을 조회한다.
 *
 * @param {string[]}    seedIds  - L2 상위 파편 ID 배열 (최대 5개)
 * @param {number}      maxTotal - 최대 반환 수 (기본 10)
 * @param {string}      agentId  - 에이전트 ID (미사용, 향후 RLS 확장 대비)
 * @param {string|null} keyId    - API 키 격리 필터
 * @returns {Promise<Object[]>} 이웃 파편 배열 (id, content, topic, type, importance 등)
 */
export async function fetchGraphNeighbors(seedIds, maxTotal = 10, agentId = "default", keyId = null) {
  if (!seedIds || seedIds.length === 0) return [];

  const pool = getPrimaryPool();

  let keyFilter = "";
  const params  = [seedIds, seedIds, maxTotal];

  if (keyId) {
    keyFilter = "AND f.key_id = ANY($4)";
    params.push(keyId);
  }

  /**
   * seedIds를 제외한 이웃 파편만 조회한다.
   * weight DESC로 가장 강한 관계부터 반환.
   * valid_to IS NULL 필터로 유효한 파편만 대상으로 한다.
   */
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (f.id)
            f.id, f.content, f.topic, f.keywords, f.type, f.importance,
            f.utility_score, f.access_count, f.created_at, f.is_anchor, f.valid_to,
            fl.weight AS _link_weight
       FROM ${SCHEMA}.fragment_links fl
       JOIN ${SCHEMA}.fragments f ON f.id = fl.to_id
      WHERE fl.from_id = ANY($1)
        AND fl.to_id != ALL($2)
        AND f.valid_to IS NULL
        ${keyFilter}
      ORDER BY f.id, fl.weight DESC
      LIMIT $3`,
    params
  );

  /** weight 기준 재정렬 후 반환 */
  return rows.sort((a, b) => (b._link_weight || 0) - (a._link_weight || 0));
}
