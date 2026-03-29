/**
 * FragmentSearch - 3단 검색 엔진 (L1 Redis -> L2 PostgreSQL -> L3 pgvector)
 *
 * 작성자: 최진호
 * 작성일: 2026-02-23
 * 수정일: 2026-03-03 (RRF l1WeightFactor 설정 연결, L1 전용 파편 필터, _rrfScore 응답 노출 제거)
 * 수정일: 2026-03-03 (API 키 격리 - keyId를 L2/L3 검색 필터로 전파)
 * 수정일: 2026-03-12 (API 키 격리 - keyId를 L1/HotCache까지 전파)
 * 수정일: 2026-03-28 (어시스턴트 발화 쿼리 확장 - L3 시맨틱 검색 정확도 향상)
 * 수정일: 2026-03-29 (search() 분해 - _buildSearchQuery / _executeSearch 추출)
 *
 * 토큰 예산 기반 검색 결과 절삭으로 컨텍스트 오염 방지
 * 복합 필터: INTERSECTION(교집합) 적용, 빈 인수 시 getRecent fallback
 * text 쿼리 시 L2+L3 병렬 실행 후 Reciprocal Rank Fusion 병합
 */

import { FragmentStore }             from "./FragmentStore.js";
import { getFragmentIndex }          from "./FragmentIndex.js";
import { generateEmbedding, prepareTextForEmbedding, EMBEDDING_ENABLED } from "../tools/embedding.js";
import { MEMORY_CONFIG }             from "../../config/memory.js";
import { computeEmaRankBoost }       from "./decay.js";
import { getSearchMetrics }          from "./SearchMetrics.js";
import { logWarn }                   from "../logger.js";
import { buildSearchEvent, recordSearchEvent } from "./SearchEventRecorder.js";
import { expandAssistantQuery, boostAssistantFragments } from "./assistant-query.js";
import { fetchGraphNeighbors }       from "./GraphNeighborSearch.js";
import { countTokens }               from "./FragmentFactory.js";

export class FragmentSearch {
  constructor() {
    this.store = new FragmentStore();
    this.index = getFragmentIndex();
  }

  /**
     * 통합 검색 - 3단 폴백
     *
     * @param {Object} query
     *   - keywords    {string[]}    키워드 목록
     *   - topic       {string}      토픽
     *   - type        {string}      파편 유형
     *   - text        {string}      자연어 쿼리 (시맨틱 검색용)
     *   - tokenBudget {number}      최대 토큰 (기본 1000)
     *   - keyId       {string|null} API 키 ID (null: 마스터, string: 격리 조회)
     *   - timeRange   {Object}      시간 범위 필터 { from?: string, to?: string } (ISO 8601)
     * @returns {Object} { fragments, totalTokens, searchPath }
     */
  async search(query) {
    const _t0       = Date.now();
    const _metricsP = getSearchMetrics();
    const sq        = this._buildSearchQuery(query);

    const { combined, searchPath, l1IsFallback } = await this._executeSearch(sq, _metricsP);

    /** 중복 제거 */
    const unique = this._deduplicate(combined, sq.fragmentCount, sq.anchorTime);

    /** 토큰 예산 절삭 */
    const trimmed     = this._trimToTokenBudget(unique, sq.tokenBudget);
    const totalTokens = this._estimateTokens(trimmed);

    /** I-1: _rrfScore 내부 필드를 MCP 응답에서 제거 */
    let clean = trimmed.map(({ _rrfScore, ...rest }) => rest);

    /** valid_to 필터: L1/HotCache/getByIds 경로를 포함한 모든 결과에 적용 */
    if (!sq.includeSuperseded) {
      clean = clean.filter(f => !f.valid_to);
    }

    /** 접근 횟수 증가 + Hot Cache 갱신 (비동기) */
    if (clean.length > 0) {
      const accessIds = clean.map(f => f.id);
      this.store.incrementAccess(accessIds, sq.agentId, { noEma: l1IsFallback });
      this.store.touchLinked(accessIds, sq.agentId).catch(() => {});
      this._cacheFragments(clean, sq.keyId);
    }

    _metricsP.then(m => m.record("total", Date.now() - _t0)).catch(() => {});

    /** 검색 이벤트 영속화 (await: _searchEventId를 동기 반환해야 tool_feedback FK 연결 가능) */
    const _totalMs    = Date.now() - _t0;
    const searchEvent = buildSearchEvent(
      query,
      clean,
      {
        searchPath  : searchPath.join(" → "),
        sessionId   : query.sessionId || null,
        keyId       : (Array.isArray(sq.keyId) ? sq.keyId[0] : sq.keyId) ?? null,
        latencyMs   : _totalMs,
        l1IsFallback: l1IsFallback
      }
    );
    const searchEventId = await recordSearchEvent(searchEvent).catch(() => null);

    return {
      fragments      : clean,
      totalTokens,
      searchPath     : searchPath.join(" → "),
      count          : clean.length,
      _searchEventId : searchEventId
    };
  }

  /**
   * 검색 파라미터를 정규화된 쿼리 객체로 변환
   *
   * @param {Object} query - 원본 검색 쿼리
   * @returns {Object} 정규화된 쿼리 (tokenBudget, agentId, keyId, anchorTime, timeRange 등)
   */
  _buildSearchQuery(query) {
    return {
      ...query,
      tokenBudget       : query.tokenBudget || 1000,
      agentId           : query.agentId || "default",
      keyId             : query.keyId ?? null,
      anchorTime        : query.anchorTime || Date.now(),
      timeRange         : parseTimeRange(query.timeRange),
      fragmentCount     : query.fragmentCount || 0,
      includeSuperseded : query.includeSuperseded || false
    };
  }

  /**
   * L1/L2/L3 검색 실행 + RRF 병합
   *
   * @param {Object}  sq        - _buildSearchQuery()가 반환한 정규화된 쿼리
   * @param {Promise} _metricsP - getSearchMetrics() Promise (레이턴시 기록용)
   * @returns {Promise<{ combined: Object[], searchPath: string[], l1IsFallback: boolean }>}
   */
  async _executeSearch(sq, _metricsP) {
    const { agentId, keyId, timeRange } = sq;
    const searchPath = [];

    /** L1: Redis 역인덱스 (현재 agentId 미지원, 향후 확장 고려) */
    const _t1L1                              = Date.now();
    const { ids: l1Ids, isFallback: l1IsFallback } = await this._searchL1(sq, keyId);
    _metricsP.then(m => m.record("L1", Date.now() - _t1L1)).catch(() => {});
    let   cached = [];

    if (l1Ids.length > 0) {
      searchPath.push(`L1:${l1Ids.length}`);
      cached = await this._tryHotCache(l1Ids, keyId);
      if (cached.length > 0) {
        searchPath.push(`HotCache:${cached.length}`);
      }
    }

    /** HotCache hit ID 집합 — L2 DB 중복 조회 방지 */
    const cacheHitIds = new Set(cached.map(f => f.id));
    const l1MissIds   = l1Ids.filter(id => !cacheHitIds.has(id));

    let combined = [];

    /** text 쿼리 시: L2 + L3 병렬 실행 후 RRF 병합 */
    if (sq.text && EMBEDDING_ENABLED) {
      const _t1L2L3                = Date.now();
      const [l2Results, l3Results] = await Promise.all([
        this._searchL2(sq, l1MissIds, agentId, keyId, timeRange),
        this._searchL3(sq, agentId, keyId, timeRange)
      ]);
      const _elapsedL2L3 = Date.now() - _t1L2L3;
      _metricsP.then(m => Promise.all([
        m.record("L2", _elapsedL2L3),
        m.record("L3", _elapsedL2L3)
      ])).catch(() => {});

      searchPath.push(`L2:${l2Results.length}`);

      /** L2.5 Graph: L2 상위 5개 파편의 1-hop 이웃 수집 */
      const l2TopIds      = l2Results.slice(0, 5).map(f => f.id);
      const graphResults  = await fetchGraphNeighbors(l2TopIds, 10, agentId, keyId).catch(() => []);
      if (graphResults.length > 0) {
        searchPath.push(`L2.5Graph:${graphResults.length}`);
      }

      searchPath.push(`L3:${l3Results.length}`);
      searchPath.push("RRF");

      // HotCache 파편을 l2Results에 병합하여 RRF 입력으로 포함
      // C-1: content 없는 L1 전용 파편 제거 / C-2: l1WeightFactor 설정값 전달
      const graphWeightFactor = 1.5;
      combined = mergeRRFWithGraph(l1Ids, [...cached, ...l2Results], graphResults, l3Results, MEMORY_CONFIG.rrfSearch.k, MEMORY_CONFIG.rrfSearch.l1WeightFactor, graphWeightFactor)
        .filter(f => f.content !== undefined);
    } else {
      /** text 없는 경우: 기존 폴백 방식 유지 (keywords/topic/type만 있는 경우) */
      const _t1L2      = Date.now();
      const l2Results  = await this._searchL2(sq, l1MissIds, agentId, keyId, timeRange);
      _metricsP.then(m => m.record("L2", Date.now() - _t1L2)).catch(() => {});
      if (l2Results.length > 0) {
        searchPath.push(`L2:${l2Results.length}`);
        combined.push(...l2Results);
      }
      if (cached.length > 0) {
        combined.push(...cached);
      }
    }

    return { combined, searchPath, l1IsFallback };
  }

  /**
     * L1: Redis 역인덱스 검색
     *
     * 복합 필터 적용 시 INTERSECTION(교집합)으로 동작한다.
     * 단일 필터는 해당 조건의 결과를 그대로 반환한다.
     * 필터가 하나도 없으면 최근 접근 파편을 fallback으로 반환한다.
     */
  async _searchL1(query, keyId = null) {
    const sets = [];

    if (query.keywords && query.keywords.length > 0) {
      const kwIds = await this.index.searchByKeywords(query.keywords, 3, keyId);
      if (kwIds.length > 0) sets.push(new Set(kwIds));
    }

    if (query.topic) {
      const topicIds = await this.index.searchByTopic(query.topic, keyId);
      if (topicIds.length > 0) sets.push(new Set(topicIds));
    }

    if (query.type) {
      const typeIds = await this.index.searchByType(query.type, keyId);
      if (typeIds.length > 0) sets.push(new Set(typeIds));
    }

    if (sets.length === 0) {
      const ids = await this.index.getRecent(20, keyId);
      return { ids, isFallback: true };
    }

    if (sets.length === 1) {
      return { ids: [...sets[0]], isFallback: false };
    }

    return {
      ids       : [...sets[0]].filter(id => sets.slice(1).every(s => s.has(id))),
      isFallback: false
    };
  }

  /**
     * Hot Cache에서 파편 조회 시도
     */
  async _tryHotCache(ids, keyId = null) {
    const results = [];

    for (const id of ids.slice(0, 30)) {
      const cached = await this.index.getCachedFragment(id, keyId);
      if (cached && cached.content) results.push(cached);
    }

    return results;
  }

  /**
     * L2: PostgreSQL 메타데이터 검색
     *
     * @param {Object}      query
     * @param {string[]}    excludeIds
     * @param {string}      agentId
     * @param {string|null} keyId - API 키 격리 필터
     */
  async _searchL2(query, excludeIds = [], agentId = "default", keyId = null, timeRange = null) {
    const options = {
      type              : query.type || undefined,
      topic             : query.topic || undefined,
      minImportance     : query.minImportance || 0.1,
      limit             : 30,
      agentId           : agentId,
      keyId             : keyId,
      includeSuperseded : query.includeSuperseded || false,
      ...(query.isAnchor !== undefined ? { isAnchor: query.isAnchor } : {}),
      ...(timeRange ? { timeRange } : {})
    };

    let results = [];

    if (query.keywords && query.keywords.length > 0) {
      results = await this.store.searchByKeywords(query.keywords, options);
    }

    /** topic-only PostgreSQL fallback: 키워드 결과가 없을 때 topic으로 재시도 */
    if (results.length === 0 && query.topic) {
      results = await this.store.searchByTopic(query.topic, options);
    }

    /** 추가 ID 기반 조회 (L1에서 찾은 것 중 캐시 미스분) */
    if (excludeIds.length > 0) {
      const cachedResultIds = new Set(results.map(r => r.id));
      const missingIds      = excludeIds.filter(id => !cachedResultIds.has(id));

      if (missingIds.length > 0) {
        const fetched = await this.store.getByIds(missingIds, agentId, keyId);
        results.push(...fetched);
      }
    }

    return results;
  }

  /**
     * L3: pgvector 시맨틱 검색
     *
     * @param {Object}      query - 검색 쿼리 객체 (text, includeSuperseded 등)
     * @param {string}      agentId
     * @param {string|null} keyId - API 키 격리 필터
     */
  async _searchL3(query, agentId = "default", keyId = null, timeRange = null) {
    try {
      /** 어시스턴트 발화 쿼리 확장: "Assistant:" 접두어로 시맨틱 갭 축소 */
      const { text: expandedText, isAssistantQuery: isAsstQ } = expandAssistantQuery(query.text);
      const prepared = prepareTextForEmbedding(expandedText, 500);
      const vec      = await generateEmbedding(prepared);
      const { minSimilarity, limit } = MEMORY_CONFIG.semanticSearch || {};
      const results = await this.store.searchBySemantic(vec, limit || 10, minSimilarity || 0.2, agentId, keyId, query.includeSuperseded || false, timeRange);

      /** 어시스턴트 쿼리일 때 "Assistant:" 포함 파편에 importance 부스트 */
      if (isAsstQ) {
        boostAssistantFragments(results);
      }

      return results;
    } catch (err) {
      logWarn(`[FragmentSearch] L3 search failed: ${err.message}`);
      return [];
    }
  }

  /**
   * 복합 랭킹 점수 계산
   *
   * score = importance * iw + temporalProximity * rw + similarity * sw
   *
   * temporalProximity: anchorTime 기준 시간 근접도 (지수 감쇠)
   *   - anchorTime이 현재면 최근 파편이 높은 점수
   *   - anchorTime이 과거면 그 시점에 가까운 파편이 높은 점수
   */
  _computeRankScore(fragment, config, anchorTime = Date.now()) {
    const { importanceWeight, recencyWeight, semanticWeight, recencyHalfLifeDays } = config.ranking;

    const importance   = fragment.importance || 0;
    const emaBoost     = computeEmaRankBoost(fragment.ema_activation);
    const effectiveImp = Math.min(1.0, importance + emaBoost * 0.5);

    const parsed    = fragment.created_at ? new Date(fragment.created_at).getTime() : NaN;
    const createdAt = Number.isFinite(parsed) ? parsed : Date.now();
    const distDays  = Math.abs(anchorTime - createdAt) / 86400000;
    const proximity = Math.pow(2, -distDays / (recencyHalfLifeDays || 30));

    const similarity = fragment.similarity || fragment._rrfScore || 0;

    return effectiveImp * (importanceWeight || 0.4)
         + proximity    * (recencyWeight    || 0.3)
         + similarity   * (semanticWeight   || 0.3);
  }

  /**
   * 중복 제거 (id 기반) + 복합 랭킹 정렬
   *
   * activationThreshold=0 이므로 항상 복합 랭킹 적용.
   *
   * @param {Array}  fragments
   * @param {number} fragmentCount  (미사용, 하위 호환 유지)
   * @returns {Array}
   */
  _deduplicate(fragments, _fragmentCount = 0, anchorTime = Date.now()) {
    const seen = new Map();

    for (const f of fragments) {
      if (!seen.has(f.id)) {
        seen.set(f.id, f);
      } else {
        const existing = seen.get(f.id);
        if (f.similarity && (!existing.similarity || f.similarity > existing.similarity)) {
          seen.set(f.id, f);
        }
      }
    }

    const allFragments = Array.from(seen.values());

    return allFragments.sort((a, b) =>
      this._computeRankScore(b, MEMORY_CONFIG, anchorTime)
      - this._computeRankScore(a, MEMORY_CONFIG, anchorTime)
    );
  }

  /**
     * 토큰 예산에 맞춰 절삭
     */
  _trimToTokenBudget(fragments, tokenBudget) {
    const result   = [];
    let usedTokens = 0;

    for (const f of fragments) {
      const cost = f.estimated_tokens || countTokens(f.content || "");
      if (usedTokens + cost > tokenBudget) break;
      usedTokens += cost;
      result.push(f);
    }

    return result;
  }

  /**
     * 토큰 수 추정
     */
  _estimateTokens(fragments) {
    return fragments.reduce((sum, f) => sum + (f.estimated_tokens || countTokens(f.content || "")), 0);
  }

  /**
     * Hot Cache에 파편 전체 데이터 저장
     */
  async _cacheFragments(fragments, keyId = null) {
    try {
      for (const f of fragments) {
        await this.index.cacheFragment(f.id, f, keyId);
      }
    } catch { /* 무시 */ }
  }
}

/**
 * Reciprocal Rank Fusion (RRF) 병합
 *
 * 스케일이 다른 L1/L2/L3 결과를 순위 기반으로 공정하게 병합한다.
 * 스케일 불변 특성으로 점수 편향 없이 세 계층 결과를 통합한다.
 *
 * @param {string[]} l1Ids          - Redis 결과 ID 배열 (최우선)
 * @param {Object[]} l2Results      - PostgreSQL 키워드 검색 결과
 * @param {Object[]} l3Results      - pgvector 시맨틱 검색 결과
 * @param {number}   k              - RRF 상수 (기본 60, 상위 랭크 과도한 부스트 방지)
 * @param {number}   l1WeightFactor - L1 가중치 배수 (config/memory.js 기본값 2)
 * @returns {Object[]} 재랭킹된 파편 배열 (_rrfScore 포함)
 */
export function mergeRRF(l1Ids, l2Results, l3Results, k = 60, l1WeightFactor = 2) {
  const scoreMap = new Map();

  /** L1: Redis 컨텍스트 — l1WeightFactor 배수 적용 (최신 세션 컨텍스트 우선) */
  l1Ids.forEach((id, rank) => {
    scoreMap.set(id, { id, _rrfScore: l1WeightFactor / (k + rank + 1) });
  });

  /** L2: PostgreSQL 키워드 검색 */
  l2Results.forEach((f, rank) => {
    const score = 1 / (k + rank + 1);
    if (scoreMap.has(f.id)) scoreMap.get(f.id)._rrfScore += score;
    else                    scoreMap.set(f.id, { ...f, _rrfScore: score });
  });

  /** L3: pgvector 시맨틱 검색 */
  l3Results.forEach((f, rank) => {
    const score = 1 / (k + rank + 1);
    if (scoreMap.has(f.id)) scoreMap.get(f.id)._rrfScore += score;
    else                    scoreMap.set(f.id, { ...f, _rrfScore: score });
  });

  return [...scoreMap.values()].sort((a, b) => b._rrfScore - a._rrfScore);
}

/**
 * 4계층 RRF 병합 (L1 + L2 + L2.5 Graph + L3)
 *
 * L2.5 Graph 이웃은 키워드 직접 매치(L2)보다 낮고
 * 시맨틱(L3)보다 높은 가중치 1.5x를 적용한다.
 *
 * @param {string[]} l1Ids             - Redis 결과 ID 배열
 * @param {Object[]} l2Results         - PostgreSQL 키워드 검색 결과
 * @param {Object[]} graphResults      - L2.5 그래프 이웃 파편
 * @param {Object[]} l3Results         - pgvector 시맨틱 검색 결과
 * @param {number}   k                 - RRF 상수 (기본 60)
 * @param {number}   l1WeightFactor    - L1 가중치 배수 (기본 2)
 * @param {number}   graphWeightFactor - 그래프 이웃 가중치 배수 (기본 1.5)
 * @returns {Object[]} 재랭킹된 파편 배열 (_rrfScore 포함)
 */
export function mergeRRFWithGraph(l1Ids, l2Results, graphResults, l3Results, k = 60, l1WeightFactor = 2, graphWeightFactor = 1.5) {
  const scoreMap = new Map();

  /** L1: Redis 컨텍스트 */
  l1Ids.forEach((id, rank) => {
    scoreMap.set(id, { id, _rrfScore: l1WeightFactor / (k + rank + 1) });
  });

  /** L2: PostgreSQL 키워드 검색 */
  l2Results.forEach((f, rank) => {
    const score = 1 / (k + rank + 1);
    if (scoreMap.has(f.id)) scoreMap.get(f.id)._rrfScore += score;
    else                    scoreMap.set(f.id, { ...f, _rrfScore: score });
  });

  /** L2.5: 그래프 이웃 (graphWeightFactor 배수) */
  graphResults.forEach((f, rank) => {
    const score = graphWeightFactor / (k + rank + 1);
    if (scoreMap.has(f.id)) scoreMap.get(f.id)._rrfScore += score;
    else                    scoreMap.set(f.id, { ...f, _rrfScore: score });
  });

  /** L3: pgvector 시맨틱 검색 */
  l3Results.forEach((f, rank) => {
    const score = 1 / (k + rank + 1);
    if (scoreMap.has(f.id)) scoreMap.get(f.id)._rrfScore += score;
    else                    scoreMap.set(f.id, { ...f, _rrfScore: score });
  });

  return [...scoreMap.values()].sort((a, b) => b._rrfScore - a._rrfScore);
}

/**
 * timeRange 파라미터 파싱 및 검증
 *
 * @param {Object|undefined} raw - { from?: string, to?: string }
 * @returns {{ from: Date|null, to: Date|null }|null}
 */
export function parseTimeRange(raw) {
  if (!raw || typeof raw !== "object") return null;

  const result = { from: null, to: null };

  if (raw.from) {
    const d = parseTemporalExpression(raw.from);
    if (!d) {
      logWarn(`[FragmentSearch] invalid timeRange.from: ${raw.from}`);
      return null;
    }
    result.from = d;
  }

  if (raw.to) {
    const d = parseTemporalExpression(raw.to);
    if (!d) {
      logWarn(`[FragmentSearch] invalid timeRange.to: ${raw.to}`);
      return null;
    }
    result.to = d;
  }

  if (!result.from && !result.to) return null;

  return result;
}

/**
 * 자연어 시간 표현을 Date로 파싱하는 순수 함수
 *
 * 지원 패턴 (한국어):
 *   - "N일 전", "N주 전", "N개월 전", "N년 전"
 *   - "오늘", "어제", "그제"/"그저께"
 *   - "이번 주", "지난 주", "이번 달", "지난 달"
 *   - "지난 월요일"~"지난 일요일"
 * ISO 8601 폴백: 위 패턴 미매칭 시 Date 생성자로 파싱
 *
 * @param {string} expr - 자연어 또는 ISO 8601 문자열
 * @param {Date}   [now] - 기준 시각 (테스트용, 기본 현재)
 * @returns {Date|null}
 */
export function parseTemporalExpression(expr, now = new Date()) {
  if (!expr || typeof expr !== "string") return null;
  const s = expr.trim();

  /** N일/주/개월/년 전 */
  const relMatch = s.match(/^(\d+)\s*(일|주|개월|달|년)\s*전$/);
  if (relMatch) {
    const n    = parseInt(relMatch[1], 10);
    const unit = relMatch[2];
    const d    = new Date(now);
    switch (unit) {
      case "일":               d.setDate(d.getDate() - n);           break;
      case "주":               d.setDate(d.getDate() - n * 7);       break;
      case "개월": case "달":  d.setMonth(d.getMonth() - n);         break;
      case "년":               d.setFullYear(d.getFullYear() - n);   break;
    }
    return _startOfDay(d);
  }

  /** 고정 키워드 */
  const keyword = s.replace(/\s+/g, "");
  switch (keyword) {
    case "오늘":     return _startOfDay(new Date(now));
    case "어제":     { const d = new Date(now); d.setDate(d.getDate() - 1); return _startOfDay(d); }
    case "그제":
    case "그저께":   { const d = new Date(now); d.setDate(d.getDate() - 2); return _startOfDay(d); }
    case "이번주":   return _startOfWeek(now, 0);
    case "지난주":   return _startOfWeek(now, -1);
    case "이번달":   return _startOfMonth(now, 0);
    case "지난달":   return _startOfMonth(now, -1);
  }

  /** 지난 X요일 */
  const dayNames = { "월요일": 1, "화요일": 2, "수요일": 3, "목요일": 4, "금요일": 5, "토요일": 6, "일요일": 0 };
  const dayMatch = s.match(/^지난\s*(월요일|화요일|수요일|목요일|금요일|토요일|일요일)$/);
  if (dayMatch) {
    const targetDay = dayNames[dayMatch[1]];
    const d         = new Date(now);
    const currentDay = d.getDay();
    let   diff       = currentDay - targetDay;
    if (diff <= 0) diff += 7;
    d.setDate(d.getDate() - diff);
    return _startOfDay(d);
  }

  /** ISO 8601 폴백 */
  const parsed = new Date(s);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function _startOfDay(d) {
  d.setHours(0, 0, 0, 0);
  return d;
}

function _startOfWeek(now, offset) {
  const d          = new Date(now);
  const currentDay = d.getDay();
  const mondayDiff = (currentDay === 0 ? -6 : 1 - currentDay) + offset * 7;
  d.setDate(d.getDate() + mondayDiff);
  return _startOfDay(d);
}

function _startOfMonth(now, offset) {
  const d = new Date(now);
  d.setMonth(d.getMonth() + offset, 1);
  return _startOfDay(d);
}
