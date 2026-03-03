/**
 * 기억 시스템 설정
 *
 * 작성자: 최진호
 * 작성일: 2026-02-25
 * 수정일: 2026-03-03 (halfLife 감쇠 설정 추가, RRF 검색 설정 추가)
 */

export const MEMORY_CONFIG = {
  /** 복합 랭킹 가중치 (합계 1.0) */
  ranking: {
    importanceWeight   : 0.6,
    recencyWeight      : 0.4,
    /** 파편 수 이 값 이상 시 복합 랭킹 활성화 */
    activationThreshold: 100
  },
  /** stale 검증 주기 (일) */
  staleThresholds: {
    procedure: 30,
    fact      : 60,
    decision  : 90,
    default   : 60
  },
  /** 연결 파편 조회 한도 (getLinkedFragments 1-hop 결과 최대 수) */
  linkedFragmentLimit: 10,
  /**
   * type별 지수 감쇠 반감기 (일)
   * lib/memory/decay.js 의 HALF_LIFE_DAYS 와 동기화 필요.
   * 실제 SQL 계산은 FragmentStore.decayImportance() 내 CASE WHEN 참조.
   */
  halfLifeDays: {
    procedure : 30,
    fact      : 60,
    decision  : 90,
    error     : 45,
    preference: 120,
    relation  : 90,
    default   : 60
  },
  /** Reciprocal Rank Fusion 검색 설정 */
  rrfSearch: {
    k             : 60,   // RRF 상수 (높을수록 상위 랭크 부스트 감소)
    l1WeightFactor: 2.0   // L1(Redis) 결과 가중치 배수
  }
};
