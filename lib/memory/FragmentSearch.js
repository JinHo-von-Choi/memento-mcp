/**
 * FragmentSearch - 3단 검색 엔진 (L1 Redis -> L2 PostgreSQL -> L3 pgvector)
 *
 * 작성자: 최진호
 * 작성일: 2026-02-23
 * 수정일: 2026-03-03 (RRF l1WeightFactor 설정 연결, L1 전용 파편 필터, _rrfScore 응답 노출 제거)
 * 수정일: 2026-03-03 (API 키 격리 - keyId를 L2/L3 검색 필터로 전파)
 * 수정일: 2026-03-12 (API 키 격리 - keyId를 L1/HotCache까지 전파)
 *
 * 토큰 예산 기반 검색 결과 절삭으로 컨텍스트 오염 방지
 * 복합 필터: INTERSECTION(교집합) 적용, 빈 인수 시 getRecent fallback
 * text 쿼리 시 L2+L3 병렬 실행 후 Reciprocal Rank Fusion 병합
 */

import { FragmentStore }             from "./FragmentStore.js";
import { FragmentIndex }             from "./FragmentIndex.js";
import { generateEmbedding, prepareTextForEmbedding, EMBEDDING_ENABLED } from "../tools/embedding.js";
import { MEMORY_CONFIG }             from "../../config/memory.js";
import { computeEmaRankBoost }       from "./decay.js";
import { getSearchMetrics }          from "./SearchMetrics.js";

const CHARS_PER_TOKEN = 4;

export class FragmentSearch {
  constructor() {
    this.store = new FragmentStore();
    this.index = new FragmentIndex();
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
     * @returns {Object} { fragments, totalTokens, searchPath }
     */
  async search(query) {
    const tokenBudget  = query.tokenBudget || 1000;
    const agentId      = query.agentId || "default";
    const keyId        = query.keyId ?? null;
    const searchPath   = [];
    const anchorTime   = query.anchorTime || Date.now();
    let   combined    = [];

    const _t0       = Date.now();
    const _metricsP = getSearchMetrics(); // Promise, 아직 await 안 함

    /** L1: Redis 역인덱스 (현재 agentId 미지원, 향후 확장 고려) */
    const _t1L1                              = Date.now();
    const { ids: l1Ids, isFallback: l1IsFallback } = await this._searchL1(query, keyId);
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

    /** text 쿼리 시: L2 + L3 병렬 실행 후 RRF 병합 */
    if (query.text && EMBEDDING_ENABLED) {
      const _t1L2L3                = Date.now();
      const [l2Results, l3Results] = await Promise.all([
        this._searchL2(query, l1MissIds, agentId, keyId),
        this._searchL3(query, agentId, keyId)
      ]);
      const _elapsedL2L3 = Date.now() - _t1L2L3;
      _metricsP.then(m => Promise.all([
        m.record("L2", _elapsedL2L3),
        m.record("L3", _elapsedL2L3)
      ])).catch(() => {});

      searchPath.push(`L2:${l2Results.length}`);
      searchPath.push(`L3:${l3Results.length}`);
      searchPath.push("RRF");

      // HotCache 파편을 l2Results에 병합하여 RRF 입력으로 포함
      // C-1: content 없는 L1 전용 파편 제거 / C-2: l1WeightFactor 설정값 전달
      combined = mergeRRF(l1Ids, [...cached, ...l2Results], l3Results, MEMORY_CONFIG.rrfSearch.k, MEMORY_CONFIG.rrfSearch.l1WeightFactor)
        .filter(f => f.content !== undefined);
    } else {
      /** text 없는 경우: 기존 폴백 방식 유지 (keywords/topic/type만 있는 경우) */
      const _t1L2      = Date.now();
      const l2Results  = await this._searchL2(query, l1MissIds, agentId, keyId);
      _metricsP.then(m => m.record("L2", Date.now() - _t1L2)).catch(() => {});
      if (l2Results.length > 0) {
        searchPath.push(`L2:${l2Results.length}`);
        combined.push(...l2Results);
      }
      if (cached.length > 0) {
        combined.push(...cached);
      }
    }

    /** 중복 제거 */
    const unique = this._deduplicate(combined, query.fragmentCount || 0, anchorTime);

    /** 토큰 예산 절삭 */
    const trimmed     = this._trimToTokenBudget(unique, tokenBudget);
    const totalTokens = this._estimateTokens(trimmed);

    /** I-1: _rrfScore 내부 필드를 MCP 응답에서 제거 */
    let clean = trimmed.map(({ _rrfScore, ...rest }) => rest);

    /** valid_to 필터: L1/HotCache/getByIds 경로를 포함한 모든 결과에 적용 */
    if (!query.includeSuperseded) {
      clean = clean.filter(f => !f.valid_to);
    }

    /** 접근 횟수 증가 + Hot Cache 갱신 (비동기) */
    if (clean.length > 0) {
      const accessIds = clean.map(f => f.id);
      this.store.incrementAccess(accessIds, agentId, { noEma: l1IsFallback });
      this.store.touchLinked(accessIds, agentId).catch(() => {});
      this._cacheFragments(clean, keyId);
    }

    _metricsP.then(m => m.record("total", Date.now() - _t0)).catch(() => {});

    return {
      fragments : clean,
      totalTokens,
      searchPath: searchPath.join(" → "),
      count     : clean.length
    };
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
  async _searchL2(query, excludeIds = [], agentId = "default", keyId = null) {
    const options = {
      type              : query.type || undefined,
      topic             : query.topic || undefined,
      minImportance     : query.minImportance || 0.1,
      limit             : 30,
      agentId           : agentId,
      keyId             : keyId,
      includeSuperseded : query.includeSuperseded || false,
      ...(query.isAnchor !== undefined ? { isAnchor: query.isAnchor } : {})
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
  async _searchL3(query, agentId = "default", keyId = null) {
    try {
      const prepared = prepareTextForEmbedding(query.text, 500);
      const vec      = await generateEmbedding(prepared);
      const { minSimilarity, limit } = MEMORY_CONFIG.semanticSearch || {};
      return this.store.searchBySemantic(vec, limit || 10, minSimilarity || 0.2, agentId, keyId, query.includeSuperseded || false);
    } catch (err) {
      console.warn(`[FragmentSearch] L3 search failed: ${err.message}`);
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
    const charBudget = tokenBudget * CHARS_PER_TOKEN;
    const result     = [];
    let usedChars    = 0;

    for (const f of fragments) {
      const cost = (f.content || "").length;
      if (usedChars + cost > charBudget) break;
      usedChars += cost;
      result.push(f);
    }

    return result;
  }

  /**
     * 토큰 수 추정
     */
  _estimateTokens(fragments) {
    const totalChars = fragments.reduce((sum, f) => sum + (f.content || "").length, 0);
    return Math.ceil(totalChars / CHARS_PER_TOKEN);
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
