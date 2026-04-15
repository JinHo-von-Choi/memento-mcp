/**
 * Link Integrity Rules v1 — Phase 3 Advisory
 *
 * 작성자: 최진호
 * 작성일: 2026-04-15
 *
 * LinkIntegrityChecker를 얇게 감싸 rule function 형태의 진입점을 제공한다.
 * SymbolicOrchestrator가 rule-based 파이프라인을 구성할 때 import 대상이다.
 *
 * - checkCycle              : 방향성 링크(caused_by/resolved_by/superseded_by/preceded_by) 싸이클 사전 경고
 * - checkQuarantineViolation: Phase 4 soft gating 이후 확장 자리표시자
 * - checkCaseEventCycle     : case_event_edges preceded_by 순환 검증 (Phase 3 범위 외, Phase 4+ 자리표시자)
 */

import { LinkIntegrityChecker } from "../../LinkIntegrityChecker.js";

/**
 * checkCycle — 사이클 advisory 경고.
 *
 * @param {Object} input
 *   - fromId       {string|number}
 *   - toId         {string|number}
 *   - relationType {string}
 * @param {Object} ctx
 *   - agentId      {string}
 *   - keyId        {string|null}
 *   - sessionLinker{SessionLinker}
 * @returns {Promise<{ hasCycle: boolean, reason: string, ruleVersion: string }>}
 */
export async function checkCycle(input, ctx = {}) {
  const { fromId, toId, relationType } = input || {};
  const checker = new LinkIntegrityChecker({ sessionLinker: ctx.sessionLinker });
  return checker.checkCycle(fromId, toId, relationType, ctx.agentId ?? "default", ctx.keyId ?? null);
}

/**
 * checkQuarantineViolation — Phase 3 범위 외. 현재는 no-op.
 *
 * @returns {Promise<{ violated: boolean, reason: string, ruleVersion: string }>}
 */
export async function checkQuarantineViolation(_input, ctx = {}) {
  const checker = new LinkIntegrityChecker({ sessionLinker: ctx.sessionLinker });
  return checker.checkQuarantineViolation();
}

/**
 * checkCaseEventCycle — Phase 3 범위 외. 현재는 no-op.
 *
 * @returns {Promise<{ hasCycle: boolean, reason: string, ruleVersion: string }>}
 */
export async function checkCaseEventCycle(_input, ctx = {}) {
  const checker = new LinkIntegrityChecker({ sessionLinker: ctx.sessionLinker });
  return checker.checkCaseEventCycle();
}
