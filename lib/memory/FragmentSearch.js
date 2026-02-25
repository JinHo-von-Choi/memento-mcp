/**
 * FragmentSearch - 3단 검색 엔진 (L1 Redis -> L2 PostgreSQL -> L3 pgvector)
 *
 * 작성자: 최진호
 * 작성일: 2026-02-23
 * 수정일: 2026-02-25
 *
 * 토큰 예산 기반 검색 결과 절삭으로 컨텍스트 오염 방지
 * 복합 필터: INTERSECTION(교집합) 적용, 빈 인수 시 getRecent fallback
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
     *   - keywords   {string[]} 키워드 목록
     *   - topic      {string}   토픽
     *   - type       {string}   파편 유형
     *   - text       {string}   자연어 쿼리 (시맨틱 검색용)
     *   - tokenBudget {number}  최대 토큰 (기본 1000)
     * @returns {Object} { fragments, totalTokens, searchPath }
     */
  async search(query) {
    const tokenBudget = query.tokenBudget || 1000;
    const searchPath  = [];
    const candidates    = [];

    /** L1: Redis 역인덱스 */
    const l1Ids = await this._searchL1(query);
    if (l1Ids.length > 0) {
      searchPath.push(`L1:${l1Ids.length}`);
      const cached = await this._tryHotCache(l1Ids);
      if (cached.length > 0) {
        candidates.push(...cached);
        searchPath.push(`HotCache:${cached.length}`);
      }
    }

    /** L2: PostgreSQL 메타데이터 + 본문 */
    if (candidates.length < 3) {
      const l2Results = await this._searchL2(query, l1Ids);
      if (l2Results.length > 0) {
        searchPath.push(`L2:${l2Results.length}`);
        candidates.push(...l2Results);
      }
    }

    /** L3: pgvector 시맨틱 검색 */
    if (candidates.length < 3 && query.text && OPENAI_API_KEY) {
      const l3Results = await this._searchL3(query.text);
      if (l3Results.length > 0) {
        searchPath.push(`L3:${l3Results.length}`);
        candidates.push(...l3Results);
      }
    }

    /** 중복 제거 */
    const unique = this._deduplicate(candidates, query.fragmentCount || 0);

    /** 토큰 예산 절삭 */
    const trimmed     = this._trimToTokenBudget(unique, tokenBudget);
    const totalTokens = this._estimateTokens(trimmed);

    /** 접근 횟수 증가 + Hot Cache 갱신 (비동기) */
    if (trimmed.length > 0) {
      const accessIds = trimmed.map(f => f.id);
      this.store.incrementAccess(accessIds);
      this._cacheFragments(trimmed);
    }

    return {
      fragments : trimmed,
      totalTokens,
      searchPath: searchPath.join(" → "),
      count     : trimmed.length
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
     */
  async _searchL2(query, excludeIds = []) {
    const options = {
      type          : query.type || undefined,
      topic         : query.topic || undefined,
      minImportance : query.minImportance || 0.1,
      limit         : 30
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
        const fetched = await this.store.getByIds(missingIds);
        results.push(...fetched);
      }
    }

    return results;
  }

  /**
     * L3: pgvector 시맨틱 검색
     */
  async _searchL3(text) {
    try {
      const prepared = prepareTextForEmbedding(text, 500);
      const vec      = await generateEmbedding(prepared);
      return this.store.searchBySemantic(vec, 10, 0.3);
    } catch (err) {
      console.warn(`[FragmentSearch] L3 search failed: ${err.message}`);
      return [];
    }
  }

  /**
     * 복합 랭킹 점수 계산
     *
     * score = importance * importanceWeight + recency * recencyWeight
     * recency: 최근 = 1, 90일 이상 = 0 (선형 감쇠)
     *
     * @param {Object} fragment
     * @param {Object} config  MEMORY_CONFIG
     * @returns {number}
     */
  _computeRankScore(fragment, config) {
    const { importanceWeight, recencyWeight } = config.ranking;
    const importance = fragment.importance || 0;

    const parsed    = fragment.created_at ? new Date(fragment.created_at).getTime() : NaN;
    const createdAt = Number.isFinite(parsed) ? parsed : Date.now();
    const ageDays   = (Date.now() - createdAt) / 86400000;
    const recency   = Math.max(0, 1 - ageDays / 90); // 90일 기준 선형 감쇠

    return importance * importanceWeight + recency * recencyWeight;
  }

  /**
     * 중복 제거 (id 기반)
     *
     * fragmentCount >= MEMORY_CONFIG.ranking.activationThreshold 시
     * 복합 점수(importance * 0.6 + recency * 0.4)로 정렬,
     * 미만 시 importance 단순 정렬.
     *
     * @param {Array}  fragments
     * @param {number} fragmentCount  랭킹 활성화 기준값 (기본 0)
     * @returns {Array}
     */
  _deduplicate(fragments, fragmentCount = 0) {
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

    if (fragmentCount >= MEMORY_CONFIG.ranking.activationThreshold) {
      return allFragments.sort((a, b) =>
        this._computeRankScore(b, MEMORY_CONFIG) - this._computeRankScore(a, MEMORY_CONFIG)
      );
    }

    return allFragments.sort((a, b) => (b.importance || 0) - (a.importance || 0));
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
