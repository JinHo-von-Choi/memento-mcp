/**
 * ConflictResolver — remember 시점 충돌 감지, 자동 링크, supersede 처리
 *
 * 작성자: 최진호
 * 작성일: 2026-03-12
 */

import { getPrimaryPool } from "../tools/db.js";

export class ConflictResolver {
  /**
   * @param {import("./FragmentStore.js").FragmentStore}   store
   * @param {import("./FragmentSearch.js").FragmentSearch} search
   */
  constructor(store, search) {
    this.store  = store;
    this.search = search;
  }

  /**
   * 새 파편과 유사도가 높은 기존 파편을 탐색하여 충돌 목록을 반환한다.
   *
   * @param {string} content  새 파편 내용
   * @param {string} topic    새 파편 토픽
   * @param {string} newId    새 파편 ID (자기 자신 제외)
   * @param {string} agentId
   * @param {string|null} keyId
   * @returns {Promise<Array>}
   */
  async detectConflicts(content, topic, newId, agentId = "default", keyId = null) {
    try {
      const result = await this.search.search({
        text       : content,
        topic,
        tokenBudget: 500,
        agentId,
        keyId
      });

      const conflicts = [];

      for (const frag of result.fragments) {
        if (frag.id === newId) continue;
        const similarity = frag.similarity || 0;
        if (similarity > 0.8) {
          conflicts.push({
            existing_id     : frag.id,
            existing_content: (frag.content || "").substring(0, 100),
            similarity,
            recommendation : `기존 파편(${frag.id})을 amend 또는 forget 후 재저장 권장`
          });
        }
      }

      return conflicts;
    } catch (err) {
      console.warn(`[ConflictResolver] detectConflicts failed: ${err.message}`);
      return [];
    }
  }

  /**
   * remember() 시점 자동 링크 생성
   * (GraphLinker가 EmbeddingWorker의 embedding_ready 이벤트 시 처리)
   *
   * @param {Object} newFragment - 방금 생성된 파편 (id 포함)
   * @param {string} agentId
   */
  async autoLinkOnRemember(_newFragment, _agentId) {
    // GraphLinker가 EmbeddingWorker의 embedding_ready 이벤트 시 처리.
    // 인라인 임베딩이 제거되어 이 시점에 임베딩이 없으므로 동기 링킹 불가.
  }

  /**
   * 기존 파편을 새 파편으로 대체한다.
   * - superseded_by 링크 생성
   * - 구 파편의 valid_to를 현재 시각으로 설정
   * - 구 파편의 importance를 반감
   *
   * @param {string} oldId   - 대체될 파편 ID
   * @param {string} newId   - 대체하는 파편 ID
   * @param {string} agentId
   */
  async supersede(oldId, newId, agentId = "default") {
    await this.store.createLink(oldId, newId, "superseded_by", agentId);

    const pool = getPrimaryPool();
    if (!pool) return;

    await pool.query(
      `UPDATE agent_memory.fragments
       SET valid_to   = NOW(),
           importance = GREATEST(0.05, importance * 0.5)
       WHERE id = $1 AND valid_to IS NULL`,
      [oldId]
    );
  }
}
