/**
 * RememberPostProcessor — remember() 후처리 파이프라인
 *
 * 작성자: 최진호
 * 작성일: 2026-04-04
 *
 * MemoryManager.remember()에서 파편 INSERT 후 실행하던 비동기/fire-and-forget
 * 후처리 항목을 일괄 관리한다:
 *   - 임베딩 큐 적재
 *   - 형태소 사전 등록
 *   - linked_to 링크 생성
 *   - assertion 일관성 검사
 *   - 시간 기반 자동 링크
 *   - 품질 평가 큐 적재
 */

import { MEMORY_CONFIG }  from "../../config/memory.js";
import { pushToQueue }    from "../redis.js";
import { EmbeddingWorker } from "./EmbeddingWorker.js";
import { logWarn }        from "../logger.js";

const EVAL_EXCLUDE_TYPES = new Set(["fact", "procedure", "error", "episode"]);

export class RememberPostProcessor {
  /**
   * @param {{ store: FragmentStore, conflictResolver: ConflictResolver, temporalLinker: TemporalLinker, morphemeIndex: MorphemeIndex, search?: FragmentSearch }} deps
   */
  constructor({ store, conflictResolver, temporalLinker, morphemeIndex, search = null }) {
    this.store            = store;
    this.conflictResolver = conflictResolver;
    this.temporalLinker   = temporalLinker;
    this.morphemeIndex    = morphemeIndex;
    this.search           = search;

    /** 테스트 안정성을 위한 fire-and-forget Promise 추적 */
    this._proactiveRecallPromise = null;
  }

  /**
   * remember() 후처리 파이프라인 실행.
   *
   * @param {{ id: string, content: string, type: string, topic?: string, linked_to?: string[], created_at?: string }} fragment
   * @param {{ agentId: string, keyId: string|null }} context
   */
  async run(fragment, { agentId, keyId }) {
    const id = fragment.id;

    /** 임베딩 비동기 큐 적재 */
    try {
      await pushToQueue(MEMORY_CONFIG.embeddingWorker.queueKey, { fragmentId: id });
    } catch {
      /** Redis 미가용 시 동기 임베딩 생성 (1건) */
      new EmbeddingWorker().processOrphanFragments(1).catch(err => {
        logWarn(`[RememberPostProcessor] inline embedding failed: ${err.message}`);
      });
    }

    /** 형태소 사전 등록 (fire-and-forget) */
    this.morphemeIndex.getOrRegisterEmbeddings(
      await this.morphemeIndex.tokenize(fragment.content).catch(() => [])
    ).catch(err => {
      logWarn(`[RememberPostProcessor] morpheme registration failed: ${err.message}`);
    });

    /** linked_to 링크 생성 (소유권 검증 후 허용된 ID만 링크) */
    if (fragment.linked_to?.length > 0) {
      const linkIds       = fragment.linked_to;
      const allowedIds    = new Set();

      try {
        const owned = await this.store.getByIds(linkIds, agentId, keyId);
        for (const f of owned) allowedIds.add(f.id);
      } catch (err) {
        logWarn(`[RememberPostProcessor] linkedTo ownership check failed: ${err.message}`);
      }

      const dropped = linkIds.filter(lid => !allowedIds.has(lid));
      if (dropped.length > 0) {
        logWarn(`[RememberPostProcessor] linkedTo ownership denied — dropping ids: ${dropped.join(", ")}`);
      }

      await Promise.all([...allowedIds].map(linkId =>
        this.store.createLink(id, linkId, "related", agentId)
          .catch(err => {
            logWarn(`[RememberPostProcessor] link creation failed for ${linkId}: ${err.message}`);
          })
      ));
    }

    /** assertion 일관성 검사 (fire-and-forget — 레이턴시 무관) */
    this.conflictResolver
      .checkAssertionConsistency(
        { ...fragment, created_at: fragment.created_at ?? new Date().toISOString() },
        agentId,
        keyId
      )
      .then(({ assertionStatus }) => {
        if (assertionStatus !== "observed") {
          this.store.patchAssertion(id, assertionStatus, keyId)
            .catch(err => logWarn(`[RememberPostProcessor] patchAssertion failed: ${err.message}`));
        }
      })
      .catch(err => logWarn(`[RememberPostProcessor] checkAssertionConsistency failed: ${err.message}`));

    /** 시간 기반 자동 링크 (fire-and-forget) */
    this.temporalLinker.linkTemporalNeighbors(
      { ...fragment, created_at: fragment.created_at ?? new Date().toISOString() },
      { agentId, keyId }
    ).catch(err => {
      logWarn(`[RememberPostProcessor] temporalLinker failed: ${err.message}`);
    });

    /** 비동기 품질 평가 큐 적재 */
    if (!EVAL_EXCLUDE_TYPES.has(fragment.type)) {
      await pushToQueue("memory_evaluation", {
        fragmentId: id,
        agentId,
        type   : fragment.type,
        content: fragment.content
      });
    }

    /** ProactiveRecall: 유사 파편 발견 시 related_to 링크 자동 생성 (fire-and-forget) */
    this._proactiveRecallPromise = this._proactiveRecall(fragment, { agentId, keyId }).catch(err => {
      logWarn(`[RememberPostProcessor] proactiveRecall failed: ${err.message}`);
    });
  }

  /**
   * 저장된 파편과 키워드 오버랩이 있는 기존 파편을 검색하여 related_to 링크를 생성한다.
   * fire-and-forget -- 실패해도 remember() 응답에 영향 없음.
   */
  async _proactiveRecall(fragment, { agentId, keyId }) {
    if (!this.search) return;

    const keywords = Array.isArray(fragment.keywords) && fragment.keywords.length > 0
      ? fragment.keywords
      : fragment.content.split(/\s+/).filter(w => w.length > 1).slice(0, 8);

    if (keywords.length === 0) return;

    const { fragments: candidates } = await this.search.search({
      keywords,
      keyId,
      tokenBudget  : 400,
      fragmentCount: 5
    });

    const newKwSet = new Set(keywords.map(k => k.toLowerCase()));

    for (const candidate of candidates) {
      if (candidate.id === fragment.id) continue;

      const candKws = Array.isArray(candidate.keywords)
        ? candidate.keywords.map(k => k.toLowerCase())
        : [];
      const shared  = candKws.filter(k => newKwSet.has(k)).length;
      const overlap = shared / Math.max(newKwSet.size, candKws.length, 1);

      if (overlap >= 0.5) {
        await this.store.createLink(fragment.id, candidate.id, "related", agentId)
          .catch(err => logWarn(`[RememberPostProcessor] createLink failed: ${err.message}`));
      }
    }
  }
}
