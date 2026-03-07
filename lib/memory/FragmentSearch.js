/**
 * FragmentSearch - 3단 검색 엔진 (L1 Redis -> L2 PostgreSQL -> L3 pgvector)
 *
 * 작성자: 최진호
 * 작성일: 2026-02-23
 * 수정일: 2026-03-03 (RRF l1WeightFactor 설정 연결, L1 전용 파편 필터, _rrfScore 응답 노출 제거)
 * 수정일: 2026-03-03 (API 키 격리 - keyId를 L2/L3 검색 필터로 전파)
 *
 * 토큰 예산 기반 검색 결과 절삭으로 컨텍스트 오염 방지
 * 복합 필터: INTERSECTION(교집합) 적용, 빈 인수 시 getRecent fallback
 * text 쿼리 시 L2+L3 병렬 실행 후 Reciprocal Rank Fusion 병합
 */

import { FragmentStore }             from "./FragmentStore.js";
import { FragmentIndex }             from "./FragmentIndex.js";
import { generateEmbedding, prepareTextForEmbedding, OPENAI_API_KEY } from "../tools/embedding.js";
import { MEMORY_CONFIG }             from "../../config/memory.js";

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

    /** L1: Redis 역인덱스 (현재 agentId 미지원, 향후 확장 고려) */
    const l1Ids = await this._searchL1(query);
    if (l1Ids.length > 0) {
      searchPath.push(`L1:${l1Ids.length}`);
      const cached = await this._tryHotCache(l1Ids);
      if (cached.length > 0) {
        searchPath.push(`HotCache:${cached.length}`);
      }
    }

    /** text 쿼리 시: L2 + L3 병렬 실행 후 RRF 병합 */
    if (query.text && OPENAI_API_KEY) {
      const [l2Results, l3Results] = await Promise.all([
        this._searchL2(query, l1Ids, agentId, keyId),
        this._searchL3(query.text, agentId, keyId)
      ]);

      searchPath.push(`L2:${l2Results.length}`);
      searchPath.push(`L3:${l3Results.length}`);
      searchPath.push("RRF");

      // C-1: content 없는 L1 전용 파편 제거 / C-2: l1WeightFactor 설정값 전달
      combined = mergeRRF(l1Ids, l2Results, l3Results, MEMORY_CONFIG.rrfSearch.k, MEMORY_CONFIG.rrfSearch.l1WeightFactor)
        .filter(f => f.content !== undefined);
    } else {
      /** text 없는 경우: 기존 폴백 방식 유지 (keywords/topic/type만 있는 경우) */
      const l2Results = await this._searchL2(query, l1Ids, agentId, keyId);
      if (l2Results.length > 0) {
        searchPath.push(`L2:${l2Results.length}`);
        combined.push(...l2Results);
      }
    }

    /** 중복 제거 */
    const unique = this._deduplicate(combined, query.fragmentCount || 0, anchorTime);

    /** 토큰 예산 절삭 */
    const trimmed     = this._trimToTokenBudget(unique, tokenBudget);
    const totalTokens = this._estimateTokens(trimmed);

    /** I-1: _rrfScore 내부 필드를 MCP 응답에서 제거 */
    // eslint-disable-next-line no-unused-vars
    const clean = trimmed.map(({ _rrfScore, ...rest }) => rest);

    /** 접근 횟수 증가 + Hot Cache 갱신 (비동기) */
    // I-3 TODO: _tryHotCache 결과를 combined에 병합하여 불필요한 DB 조회 제거
    if (clean.length > 0) {
      const accessIds = clean.map(f => f.id);
      this.store.incrementAccess(accessIds, agentId);
      this._cacheFragments(clean);
    }

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
  async _searchL1(query) {
    const sets = [];

    if (query.keywords && query.keywords.length > 0) {
      const kwIds = await this.index.searchByKeywords(query.keywords);
      sets.push(new Set(kwIds));
    }

    if (query.topic) {
      const topicIds = await this.index.searchByTopic(query.topic);
      sets.push(new Set(topicIds));
    }

    if (query.type) {
      const typeIds = await this.index.searchByType(query.type);
      sets.push(new Set(typeIds));
    }

    if (sets.length === 0) {
      return this.index.getRecent(20);
    }

    if (sets.length === 1) {
      return [...sets[0]];
    }

    return [...sets[0]].filter(id => sets.slice(1).every(s => s.has(id)));
  }

  /**
     * Hot Cache에서 파편 조회 시도
     */
  async _tryHotCache(ids) {
    const results = [];

    for (const id of ids.slice(0, 30)) {
      const cached = await this.index.getCachedFragment(id);
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
      type          : query.type || undefined,
      topic         : query.topic || undefined,
      minImportance : query.minImportance || 0.1,
      limit         : 30,
      agentId       : agentId,
      keyId         : keyId
    };

    let results = [];

    if (query.keywords && query.keywords.length > 0) {
      results = await this.store.searchByKeywords(query.keywords, options);
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
     * @param {string}      text
     * @param {string}      agentId
     * @param {string|null} keyId - API 키 격리 필터
     */
  async _searchL3(text, agentId = "default", keyId = null) {
    try {
      const prepared = prepareTextForEmbedding(text, 500);
      const vec      = await generateEmbedding(prepared);
      return this.store.searchBySemantic(vec, 10, 0.3, agentId, keyId);
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

    const importance = fragment.importance || 0;

    const parsed    = fragment.created_at ? new Date(fragment.created_at).getTime() : NaN;
    const createdAt = Number.isFinite(parsed) ? parsed : Date.now();
    const distDays  = Math.abs(anchorTime - createdAt) / 86400000;
    const proximity = Math.pow(2, -distDays / (recencyHalfLifeDays || 30));

    const similarity = fragment.similarity || fragment._rrfScore || 0;

    return importance * (importanceWeight || 0.4)
         + proximity  * (recencyWeight    || 0.3)
         + similarity * (semanticWeight   || 0.3);
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
  _deduplicate(fragments, fragmentCount = 0, anchorTime = Date.now()) {
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
  async _cacheFragments(fragments) {
    try {
      for (const f of fragments) {
        await this.index.cacheFragment(f.id, f);
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
