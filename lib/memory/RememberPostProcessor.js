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
   * @param {{ store: FragmentStore, conflictResolver: ConflictResolver, temporalLinker: TemporalLinker, morphemeIndex: MorphemeIndex }} deps
   */
  constructor({ store, conflictResolver, temporalLinker, morphemeIndex }) {
    this.store            = store;
    this.conflictResolver = conflictResolver;
    this.temporalLinker   = temporalLinker;
    this.morphemeIndex    = morphemeIndex;
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

    /** linked_to 링크 생성 */
    if (fragment.linked_to?.length > 0) {
      await Promise.all(fragment.linked_to.map(linkId =>
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
  }
}
