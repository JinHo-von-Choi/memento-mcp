/**
 * GraphLinker - 임베딩 기반 자동 관계 생성 워커
 *
 * 작성자: 최진호
 * 작성일: 2026-03-07
 *
 * EmbeddingWorker의 embedding_ready 이벤트를 구독하여
 * 새로 임베딩이 생성된 파편의 유사 파편을 찾아 관계를 자동 생성한다.
 * consolidate 시 기존 파편 간 소급 링킹도 수행한다.
 */

import { FragmentStore }       from "./FragmentStore.js";
import { queryWithAgentVector } from "../tools/db.js";

const SCHEMA = "agent_memory";

export class GraphLinker {
  constructor() {
    this.store = new FragmentStore();
  }

  /**
   * 단일 파편에 대해 유사 파편을 찾아 관계를 자동 생성한다.
   *
   * 1. DB에서 해당 파편 조회 (embedding IS NOT NULL 확인)
   * 2. 같은 topic + similarity > 0.7인 상위 3개 후보를 pgvector cosine으로 검색
   * 3. 관계 유형 결정: related / resolved_by / superseded_by
   * 4. store.createLink() 호출 (중복 링크는 ON CONFLICT로 무시)
   *
   * @param {string} fragmentId
   * @param {string} agentId
   * @returns {number} 생성된 링크 수
   */
  async linkFragment(fragmentId, agentId = "default") {
    /** 임베딩 존재 여부 + 파편 메타데이터 조회 */
    const fragResult = await queryWithAgentVector(agentId,
      `SELECT id, content, topic, type, created_at
       FROM ${SCHEMA}.fragments
       WHERE id = $1 AND embedding IS NOT NULL`,
      [fragmentId]
    );

    if (!fragResult.rows || fragResult.rows.length === 0) return 0;

    const newFragment = fragResult.rows[0];

    /** 같은 topic + cosine similarity > 0.7 상위 3개 후보 */
    const candidates = await queryWithAgentVector(agentId,
      `SELECT id, content, type, created_at, is_anchor,
              1 - (embedding <=> (SELECT embedding FROM ${SCHEMA}.fragments WHERE id = $1)) AS similarity
       FROM ${SCHEMA}.fragments
       WHERE id != $1
         AND topic = $2
         AND embedding IS NOT NULL
         AND 1 - (embedding <=> (SELECT embedding FROM ${SCHEMA}.fragments WHERE id = $1)) > 0.7
       ORDER BY similarity DESC
       LIMIT 3`,
      [fragmentId, newFragment.topic]
    );

    if (!candidates.rows || candidates.rows.length === 0) return 0;

    let linkCount = 0;

    for (const existing of candidates.rows) {
      const similarity   = parseFloat(existing.similarity);
      let   relationType = "related";

      /** error -> error(resolved): resolved_by 링크 */
      if (newFragment.type === "error" && existing.type === "error") {
        if (newFragment.content.includes("[해결됨]") || newFragment.content.includes("resolved")) {
          relationType = "resolved_by";
        }
      }

      /** 같은 type + 높은 유사도: 최신 정보가 구 정보를 대체 */
      if (newFragment.type === existing.type && similarity > 0.85) {
        const newDate = new Date(newFragment.created_at || Date.now());
        const oldDate = new Date(existing.created_at || 0);
        if (newDate > oldDate) {
          relationType = "superseded_by";
        }
      }

      try {
        await this.store.createLink(existing.id, newFragment.id, relationType, agentId);
        linkCount++;

        if (relationType === "superseded_by") {
          await queryWithAgentVector(agentId,
            `UPDATE ${SCHEMA}.fragments SET valid_to = NOW()
             WHERE id = $1 AND valid_to IS NULL`,
            [existing.id], "write"
          );
        }
      } catch { /* 중복 링크 등 무시 */ }
    }

    return linkCount;
  }

  /**
   * 임베딩은 있지만 링크가 전혀 없는 고립 파편에 대해 소급 링킹 수행.
   *
   * linked_to 배열 길이 0 AND fragment_links에 from_id/to_id로 참여하지 않는 파편을
   * batchSize개 조회하여 각각 linkFragment()를 호출한다.
   *
   * @param {number} batchSize
   * @returns {{ processed: number, linksCreated: number }}
   */
  async retroLink(batchSize = 20) {
    const isolated = await queryWithAgentVector("system",
      `SELECT f.id
       FROM ${SCHEMA}.fragments f
       WHERE f.embedding IS NOT NULL
         AND (f.linked_to IS NULL OR array_length(f.linked_to, 1) IS NULL)
         AND NOT EXISTS (
           SELECT 1 FROM ${SCHEMA}.fragment_links l
           WHERE l.from_id = f.id OR l.to_id = f.id
         )
       ORDER BY f.created_at DESC
       LIMIT $1`,
      [batchSize]
    );

    let processed    = 0;
    let linksCreated = 0;

    for (const row of isolated.rows) {
      const count = await this.linkFragment(row.id, "system");
      processed++;
      linksCreated += count;
    }

    if (linksCreated > 0) {
      console.debug(`[GraphLinker] retroLink: processed=${processed}, linksCreated=${linksCreated}`);
    }

    return { processed, linksCreated };
  }
}
