/**
 * Symbolic 오류 클래스
 *
 * 작성자: 최진호
 * 작성일: 2026-04-16
 */

/**
 * PolicyRules hard gate violation.
 * MemoryManager.remember()에서 symbolic_hard_gate=true 키의 fragment가
 * PolicyRules.check() 위반 시 throw된다.
 */
export class SymbolicPolicyViolationError extends Error {
  /**
   * @param {Array<{ rule: string, severity: string, detail: string, ruleVersion: string }>} violations - 위반된 predicate 객체 배열
   * @param {object} [meta] - 부가 정보 (fragmentType, keyId 등)
   */
  constructor(violations, meta = {}) {
    const ruleNames = Array.isArray(violations) ? violations.map(v => v.rule ?? String(v)) : [];
    const msg       = `policy_violation: ${ruleNames.join(", ")}`;
    super(msg);
    this.name       = "SymbolicPolicyViolationError";
    this.code       = "SYMBOLIC_POLICY_VIOLATION";
    this.violations = ruleNames;
    this.meta       = meta;
  }
}
