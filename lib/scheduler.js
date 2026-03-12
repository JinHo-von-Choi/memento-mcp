/**
 * 주기 작업 스케줄러 — 서버 시작 후 실행되는 모든 setInterval 작업 관리
 *
 * 작성자: 최진호
 * 작성일: 2026-03-12
 */

import { LOG_DIR } from "./config.js";
import { saveAccessStats } from "./tools/index.js";
import { cleanupExpiredSessions, getSessionCounts } from "./sessions.js";
import { cleanupExpiredOAuthData } from "./oauth.js";
import { updateSessionCounts } from "./metrics.js";
import { MemoryManager } from "./memory/MemoryManager.js";
import { getMemoryEvaluator } from "./memory/MemoryEvaluator.js";

/**
 * 모든 주기 작업을 시작한다.
 * @param {object} opts
 * @param {object|null} opts.globalEmbeddingWorkerRef - { current: EmbeddingWorker|null } 참조 객체
 */
export function startSchedulers({ globalEmbeddingWorkerRef }) {
  /** 세션 정리 (5분) */
  setInterval(cleanupExpiredSessions, 5 * 60 * 1000);
  setInterval(cleanupExpiredOAuthData, 5 * 60 * 1000);
  console.log("Session cleanup: Running every 5 minutes");

  /** 세션 수 메트릭 업데이트 (1분) */
  setInterval(() => {
    const { streamable: _ss, legacy: _ls } = getSessionCounts();
    updateSessionCounts(_ss, _ls);
  }, 60 * 1000);
  console.log("Metrics: Session counts updated every minute");

  /** 접근 통계 저장 (10분) */
  setInterval(() => saveAccessStats(LOG_DIR), 10 * 60 * 1000);
  console.log("Access stats: Saving every 10 minutes");

  /** 기억 시스템 컨솔리데이션 (기본 6시간) */
  const CONSOLIDATE_MS = parseInt(process.env.CONSOLIDATE_INTERVAL_MS || "21600000", 10);
  setInterval(async () => {
    try {
      const mm     = MemoryManager.getInstance();
      const result = await mm.consolidate();
      console.log(`[Consolidate] done: expired=${result.expiredDeleted}, decay=${result.importanceDecay}, merged=${result.duplicatesMerged}`);
    } catch (err) {
      console.error(`[Consolidate] failed: ${err.message}`);
    }
  }, CONSOLIDATE_MS).unref();
  console.log(`Consolidate: Running every ${CONSOLIDATE_MS / 3600000}h`);

  /** 임베딩 백필 (30분, 배치 20개) */
  setInterval(async () => {
    try {
      const mm    = MemoryManager.getInstance();
      const count = await mm.store.generateMissingEmbeddings(20);
      if (count > 0) console.log(`[EmbeddingBackfill] Generated ${count} embeddings`);
    } catch (err) {
      console.error(`[EmbeddingBackfill] failed: ${err.message}`);
    }
  }, 30 * 60_000).unref();
  console.log("EmbeddingBackfill: Running every 30min (batch 20)");

  /** Phase 2: 비동기 지식 품질 평가 워커 시작 */
  getMemoryEvaluator().start().catch(err => {
    console.error("[Startup] Failed to start MemoryEvaluator:", err.message);
  });

  /** 임베딩 비동기 워커 + GraphLinker 시작 */
  import("./memory/EmbeddingWorker.js")
    .then(({ EmbeddingWorker }) => {
      const worker = new EmbeddingWorker();
      if (globalEmbeddingWorkerRef) globalEmbeddingWorkerRef.current = worker;
      return worker.start().then(() => worker);
    })
    .then(async (worker) => {
      const { GraphLinker } = await import("./memory/GraphLinker.js");
      const graphLinker     = new GraphLinker();

      worker.on("embedding_ready", async ({ fragmentId }) => {
        try {
          const count = await graphLinker.linkFragment(fragmentId, "system");
          if (count > 0) console.debug(`[GraphLinker] Linked ${count} for ${fragmentId}`);
        } catch (err) {
          console.warn(`[GraphLinker] Error: ${err.message}`);
        }
      });
    })
    .catch(err => {
      console.error("[Startup] Failed to start EmbeddingWorker:", err.message);
    });

  /** NLI 모델 사전 로드 (cold start 방지, 비차단) */
  import("./memory/NLIClassifier.js")
    .then(m => m.preloadNLI())
    .catch(err => {
      console.warn("[Startup] NLI preload skipped:", err.message);
    });
}
