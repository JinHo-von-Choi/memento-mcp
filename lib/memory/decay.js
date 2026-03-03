/**
 * Fragment 지수 감쇠 순수 함수
 *
 * 작성자: 최진호
 * 작성일: 2026-03-03
 *
 * type별 halfLife(일) 정의 및 지수 감쇠 계산.
 * PostgreSQL POWER() 배치 SQL의 JS 참조 구현 — 테스트 및 클라이언트 사이드 계산에 활용.
 */

/** type별 반감기 (일) */
export const HALF_LIFE_DAYS = {
    procedure : 30,
    fact      : 60,
    decision  : 90,
    error     : 45,
    preference: 120,
    relation  : 90,
    default   : 60
};

const MIN_IMPORTANCE = 0.05;

/**
 * 지수 감쇠 적용된 importance 계산
 *
 * 수식: importance_new = MAX(0.05, initial * 2^(-Δt / halfLifeMs))
 *
 * @param {number}  initial   - 원래 importance [0~1]
 * @param {number}  deltaMs   - 경과 밀리초
 * @param {string}  type      - 파편 유형 (procedure|fact|decision|error|preference|relation)
 * @param {boolean} isAnchor  - true 시 감쇠 면제 (영구 고정)
 * @returns {number} 감쇠 후 importance
 */
export function computeDecayedImportance(initial, deltaMs, type, isAnchor = false) {
    if (isAnchor) return initial;
    const halfLifeMs = (HALF_LIFE_DAYS[type] ?? HALF_LIFE_DAYS.default) * 86400_000;
    return Math.max(MIN_IMPORTANCE, initial * Math.pow(2, -(deltaMs / halfLifeMs)));
}
