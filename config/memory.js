/**
 * 기억 시스템 설정
 *
 * 작성자: 최진호
 * 작성일: 2026-02-25
 * 수정일: 2026-03-07 (GC 정책, contextInjection 스마트 캡, pagination 설정 추가)
 */

export const MEMORY_CONFIG = {
  /** 복합 랭킹 가중치 (합계 1.0) */
  ranking: {
    importanceWeight    : 0.4,
    recencyWeight       : 0.3,
    semanticWeight      : 0.3,
    activationThreshold : 0,
    recencyHalfLifeDays : 30,
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
  },
  /** 임베딩 비동기 워커 설정 */
  embeddingWorker: {
    batchSize   : 10,
    intervalMs  : 5000,
    retryLimit  : 3,
    retryDelayMs: 2000,
    queueKey    : "memento:embedding_queue"
  },
  /** 컨텍스트 주입 설정 */
  contextInjection: {
    maxCoreFragments   : 15,
    maxWmFragments     : 10,
    typeSlots          : {
      preference : 5,
      error      : 5,
      procedure  : 5,
      decision   : 3,
      fact       : 3
    },
    defaultTokenBudget : 2000
  },
  /** recall 페이지네이션 설정 */
  pagination: {
    defaultPageSize : 20,
    maxPageSize     : 50
  },
  /** 파편 GC 정책 */
  gc: {
    utilityThreshold       : 0.15,
    gracePeriodDays        : 7,
    inactiveDays           : 60,
    maxDeletePerCycle      : 50,
    factDecisionPolicy     : {
      importanceThreshold  : 0.2,
      orphanAgeDays        : 30
    }
  }
};
