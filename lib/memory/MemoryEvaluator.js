/**
 * MemoryEvaluator - 비동기 지식 품질 평가 및 Rationale 생성
 *
 * 작성자: 최진호
 * 작성일: 2026-02-27
 */

import { popFromQueue } from "../redis.js";
import { MemoryManager } from "./MemoryManager.js";
import { geminiCLIJson, isGeminiCLIAvailable } from "../gemini.js";

export class MemoryEvaluator {
  constructor() {
    this.running = false;
    this.interval = 5000; // 5초
  }

  /**
   * 워커 시작
   */
  async start() {
    if (this.running) return;
    this.running = true;
    console.log("[MemoryEvaluator] Worker started");
    this._loop();
  }

  /**
   * 워커 중지
   */
  stop() {
    this.running = false;
    console.log("[MemoryEvaluator] Worker stopping...");
  }

  /**
   * 메인 루프
   */
  async _loop() {
    while (this.running) {
      try {
        const job = await popFromQueue("memory_evaluation");
        if (job) {
          await this.evaluate(job);
        } else {
          // 큐가 비어있으면 대기
          await new Promise(resolve => setTimeout(resolve, this.interval));
        }
      } catch (err) {
        console.error("[MemoryEvaluator] Error in loop:", err.message);
        await new Promise(resolve => setTimeout(resolve, this.interval * 2));
      }
    }
  }

  /**
   * 파편 품질 평가 및 Rationale 생성
   *
   * @param {Object} job - { fragmentId, agentId, type, content }
   */
  async evaluate(job) {
    const { fragmentId, agentId, type, content } = job;
    const mgr = MemoryManager.getInstance();

    const prompt = `다음 지식 파편의 미래 활용 가치를 평가하라.
유형: ${type}
내용: "${content}"

다음 항목을 평가하여 JSON으로 응답하라:
1. score: 0~1 사이의 가치 점수 (미래에 에이전트가 이 정보를 얼마나 필요로 할지)
2. rationale: 왜 이 정보를 저장해야 하는지 1문장 이유
3. action: "keep" (유지), "downgrade" (가치 낮음), "discard" (불필요) 중 하나

응답 형식: {"score": 0.8, "rationale": "...", "action": "keep"}`;

    try {
      if (!(await isGeminiCLIAvailable())) {
        console.debug(`[MemoryEvaluator] Gemini CLI unavailable, skipping evaluation for ${fragmentId}`);
        return;
      }

      const result = await geminiCLIJson(prompt, { timeoutMs: 30_000 });

      const updates = {
        importance: result.score
      };

      if (result.action === "downgrade") {
        updates.importance = Math.min(result.score, 0.3);
      } else if (result.action === "discard") {
        updates.importance = 0.1;
      }

      /**
       * Rationale은 keywords에 [Rationale] 접두사로 추가하여 보존
       */
      const existing = await mgr.store.getById(fragmentId, agentId);
      if (existing) {
        updates.keywords = [...(existing.keywords || []), `Rationale: ${result.rationale}`];
      }

      await mgr.store.update(fragmentId, updates, agentId);
      console.log(`[MemoryEvaluator] Evaluated ${fragmentId}: score=${result.score}, action=${result.action}`);

    } catch (err) {
      console.warn(`[MemoryEvaluator] Failed to evaluate ${fragmentId}: ${err.message}`);
    }
  }
}

/** 싱글톤 */
let evaluatorInstance = null;

export function getMemoryEvaluator() {
  if (!evaluatorInstance) {
    evaluatorInstance = new MemoryEvaluator();
  }
  return evaluatorInstance;
}
