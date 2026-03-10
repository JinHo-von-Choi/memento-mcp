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

/** EMA 학습률 */
export const EMA_ALPHA = 0.3;

/**
 * ACT-R 기저 활성화 EMA 근사
 * B_new = α * (Δt_sec)^{-0.5} + (1 - α) * B_old
 */
export function updateEmaActivation(prevEma, prevUpdatedAt, now) {
    const prev      = prevEma ?? 0;
    const ref       = prevUpdatedAt instanceof Date ? prevUpdatedAt : new Date(now.getTime() - 86400_000);
    const deltaSec  = Math.max((now.getTime() - ref.getTime()) / 1000, 1);
    const newSample = Math.pow(deltaSec, -0.5);
    return EMA_ALPHA * newSample + (1 - EMA_ALPHA) * prev;
}

/**
 * EMA 활성화를 랭킹 부스트 [0, 0.3]으로 변환
 */
export function computeEmaRankBoost(ema) {
    const clamped = Math.max(0, ema ?? 0);
    return 0.3 * (1 - Math.exp(-clamped));
}

/**
 * EMA 활성화 기반 동적 반감기 계산
 *
 * 자주 회상되는 파편(ema_activation 높음)은 반감기가 최대 2배 연장된다.
 * 공식: base × clamp(1.0 + ema × 0.5, 1.0, 2.0)
 *
 * @param {string}      type           - 파편 유형
 * @param {number|null} ema_activation - EMA 활성화 값 (null이면 0)
 * @returns {number} 동적 반감기 (일)
 */
export function computeDynamicHalfLife(type, ema_activation) {
    const base       = HALF_LIFE_DAYS[type] ?? HALF_LIFE_DAYS.default;
    const ema        = ema_activation ?? 0;
    const multiplier = Math.min(2.0, Math.max(1.0, 1.0 + ema * 0.5));
    return base * multiplier;
}
