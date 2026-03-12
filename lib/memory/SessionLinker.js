/**
 * SessionLinker — 세션 파편 통합, 자동 링크, 사이클 감지
 *
 * 작성자: 최진호
 * 작성일: 2026-03-12
 */

import { logWarn } from "../logger.js";

export class SessionLinker {
  /**
   * @param {import("./FragmentStore.js").FragmentStore}  store
   * @param {import("./FragmentIndex.js").FragmentIndex}  index
   */
  constructor(store, index) {
    this.store = store;
    this.index = index;
  }

  /**
   * 세션의 파편들을 수집하여 요약 구조를 반환한다.
   *
   * @param {string}      sessionId
   * @param {string}      agentId
   * @param {string|null} keyId
   * @returns {Promise<object|null>}
   */
  async consolidateSessionFragments(sessionId, agentId = "default", keyId = null) {
    const ids     = await this.index.getSessionFragments(sessionId);
    const wmItems = await this.index.getWorkingMemory(sessionId);

    const rows    = ids?.length > 0 ? await this.store.getByIds(ids, agentId, keyId) : [];
    const allRows = [
      ...(rows || []),
      ...(wmItems || []).map(w => ({
        content: w.content,
        type   : w.type || "fact"
      }))
    ];
    if (!allRows.length) return null;

    const decisions      = [];
    const errorsResolved = [];
    const procedures     = [];
    const openQuestions  = [];
    const summaryParts   = [];

    for (const r of allRows) {
      const content = (r.content || "").trim();
      if (!content) continue;

      switch (r.type) {
        case "decision":
          decisions.push(content.replace(/^\[해결됨\]\s*/i, "").trim());
          break;
        case "error":
          errorsResolved.push(content.replace(/^\[해결됨\]\s*/i, "").trim());
          break;
        case "procedure":
          procedures.push(content);
          break;
        case "fact":
          if (content.includes("[미해결]")) {
            openQuestions.push(content.replace(/^\[미해결\]\s*/i, "").trim());
          } else {
            summaryParts.push(content);
          }
          break;
        default:
          summaryParts.push(content);
      }
    }

    const summary = summaryParts.length > 0
      ? `세션 ${sessionId.substring(0, 8)}... 종합: ${summaryParts.join(" ")}`
      : (decisions.length || errorsResolved.length || procedures.length
        ? `세션 ${sessionId.substring(0, 8)}... 종합: 결정 ${decisions.length}건, 에러 해결 ${errorsResolved.length}건, 절차 ${procedures.length}건`
        : null);

    if (!summary && !decisions.length && !errorsResolved.length && !procedures.length && !openQuestions.length) {
      return null;
    }

    return {
      summary,
      decisions      : [...new Set(decisions)],
      errors_resolved: [...new Set(errorsResolved)],
      new_procedures : [...new Set(procedures)],
      open_questions : [...new Set(openQuestions)]
    };
  }

  /**
   * 세션 파편 간 규칙 기반 자동 link 생성
   *
   * @param {Array}  fragments - reflect에서 저장된 파편 목록 [{id, type, ...}]
   * @param {string} agentId
   */
  async autoLinkSessionFragments(fragments, agentId = "default") {
    const errors     = fragments.filter(f => f.type === "error");
    const decisions  = fragments.filter(f => f.type === "decision");
    const procedures = fragments.filter(f => f.type === "procedure");

    /** 규칙 1: error + decision → caused_by */
    for (const err of errors) {
      for (const dec of decisions) {
        if (await this.wouldCreateCycle(err.id, dec.id, agentId)) continue;
        await this.store.createLink(err.id, dec.id, "caused_by", agentId).catch((e) => {
          logWarn(`[SessionLinker] auto-link creation failed: ${e.message}`);
        });
      }
    }

    /** 규칙 2: procedure + error → resolved_by */
    for (const proc of procedures) {
      for (const err of errors) {
        if (await this.wouldCreateCycle(proc.id, err.id, agentId)) continue;
        await this.store.createLink(proc.id, err.id, "resolved_by", agentId).catch((e) => {
          logWarn(`[SessionLinker] auto-link creation failed: ${e.message}`);
        });
      }
    }
  }

  /**
   * A → B 링크 생성 시 순환 참조 발생 여부 확인 (B → A 경로 존재 시 true)
   * 재귀 CTE 단일 쿼리로 판정 (최대 20홉)
   *
   * @param {string} fromId
   * @param {string} toId
   * @param {string} agentId
   * @returns {Promise<boolean>}
   */
  async wouldCreateCycle(fromId, toId, agentId = "default") {
    try {
      return await this.store.isReachable(toId, fromId, agentId);
    } catch (err) {
      logWarn(`[SessionLinker] Cycle detection failed: ${err.message}`);
      return false;
    }
  }
}
