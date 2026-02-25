/**
 * FragmentIndex - Redis 역인덱스 관리
 *
 * 작성자: 최진호
 * 작성일: 2026-02-23
 *
 * 키 네임스페이스: frag:* (기존 cache:*, session:*, oauth:*와 분리)
 */

import { redisClient } from "../redis.js";

const KW_PREFIX      = "frag:kw:";
const TOPIC_PREFIX   = "frag:tp:";
const TYPE_PREFIX    = "frag:ty:";
const RECENT_KEY     = "frag:recent";
const HOT_PREFIX     = "frag:hot:";
const SESSION_PREFIX = "frag:sess:";
const WM_PREFIX      = "frag:wm:";
const MAX_SET_SIZE   = 1000;
const HOT_CACHE_TTL  = 7200;
const WM_TTL         = 86400;
const WM_MAX_TOKENS  = 500;

export class FragmentIndex {

  /**
     * 파편을 역인덱스에 등록
     */
  async index(fragment, sessionId) {
    if (!redisClient || redisClient.status !== "ready") return;

    const pipeline = redisClient.pipeline();
    const now      = Date.now();

    for (const kw of (fragment.keywords || [])) {
      pipeline.sadd(`${KW_PREFIX}${kw.toLowerCase()}`, fragment.id);
    }

    pipeline.sadd(`${TOPIC_PREFIX}${fragment.topic}`, fragment.id);
    pipeline.sadd(`${TYPE_PREFIX}${fragment.type}`, fragment.id);
    pipeline.zadd(RECENT_KEY, now, fragment.id);

    if (sessionId) {
      pipeline.sadd(`${SESSION_PREFIX}${sessionId}`, fragment.id);
      pipeline.expire(`${SESSION_PREFIX}${sessionId}`, 86400);
    }

    await pipeline.exec().catch(err =>
      console.warn(`[FragmentIndex] index failed: ${err.message}`)
    );
  }

  /**
     * 파편을 역인덱스에서 제거
     */
  async deindex(fragmentId, keywords, topic, type) {
    if (!redisClient || redisClient.status !== "ready") return;

    const pipeline = redisClient.pipeline();

    for (const kw of (keywords || [])) {
      pipeline.srem(`${KW_PREFIX}${kw.toLowerCase()}`, fragmentId);
    }

    if (topic) pipeline.srem(`${TOPIC_PREFIX}${topic}`, fragmentId);
    if (type)  pipeline.srem(`${TYPE_PREFIX}${type}`, fragmentId);
    pipeline.zrem(RECENT_KEY, fragmentId);
    pipeline.del(`${HOT_PREFIX}${fragmentId}`);

    await pipeline.exec().catch(err =>
      console.warn(`[FragmentIndex] deindex failed: ${err.message}`)
    );
  }

  /**
     * 키워드 기반 검색 (교집합 우선, 부족하면 합집합)
     */
  async searchByKeywords(keywords, minResults = 3) {
    if (!redisClient || redisClient.status !== "ready" || keywords.length === 0) {
      return [];
    }

    const keys = keywords.map(kw => `${KW_PREFIX}${kw.toLowerCase()}`);

    /** 교집합 시도 */
    let ids = await redisClient.sinter(...keys).catch(() => []);

    /** 부족하면 합집합으로 확장 */
    if (ids.length < minResults && keys.length > 1) {
      ids = await redisClient.sunion(...keys).catch(() => []);
    }

    return ids;
  }

  /**
     * 토픽 기반 검색
     */
  async searchByTopic(topic) {
    if (!redisClient || redisClient.status !== "ready") return [];
    return redisClient.smembers(`${TOPIC_PREFIX}${topic}`).catch(() => []);
  }

  /**
     * 타입 기반 검색
     */
  async searchByType(type) {
    if (!redisClient || redisClient.status !== "ready") return [];
    return redisClient.smembers(`${TYPE_PREFIX}${type}`).catch(() => []);
  }

  /**
     * 최근 접근 파편 조회
     */
  async getRecent(count = 20) {
    if (!redisClient || redisClient.status !== "ready") return [];
    return redisClient.zrevrange(RECENT_KEY, 0, count - 1).catch(() => []);
  }

  /**
     * Hot Cache에 파편 본문 저장
     */
  async cacheFragment(fragmentId, data) {
    if (!redisClient || redisClient.status !== "ready") return;
    await redisClient.setex(
      `${HOT_PREFIX}${fragmentId}`,
      HOT_CACHE_TTL,
      JSON.stringify(data)
    ).catch(() => {});
  }

  /**
     * Hot Cache에서 파편 조회
     */
  async getCachedFragment(fragmentId) {
    if (!redisClient || redisClient.status !== "ready") return null;

    const val = await redisClient.get(`${HOT_PREFIX}${fragmentId}`).catch(() => null);
    return val ? JSON.parse(val) : null;
  }

  /**
     * 세션의 파편 ID 목록 조회
     */
  async getSessionFragments(sessionId) {
    if (!redisClient || redisClient.status !== "ready") return [];
    return redisClient.smembers(`${SESSION_PREFIX}${sessionId}`).catch(() => []);
  }

  /**
     * Working Memory에 파편 추가 (세션 단위, FIFO + importance 보호)
     *
     * @param {string} sessionId - 세션 ID
     * @param {Object} fragment  - { id, content, type, importance, estimated_tokens }
     */
  async addToWorkingMemory(sessionId, fragment) {
    if (!redisClient || redisClient.status !== "ready" || !sessionId) return;

    const key = `${WM_PREFIX}${sessionId}`;

    try {
      const entry = JSON.stringify({
        id              : fragment.id,
        content         : fragment.content,
        type            : fragment.type,
        topic           : fragment.topic,
        importance      : fragment.importance || 0.5,
        estimated_tokens: fragment.estimated_tokens || Math.ceil((fragment.content || "").length / 4),
        added_at        : Date.now()
      });

      await redisClient.rpush(key, entry);
      await redisClient.expire(key, WM_TTL);

      await this._enforceWmBudget(key);
    } catch (err) {
      console.warn(`[FragmentIndex] addToWorkingMemory failed: ${err.message}`);
    }
  }

  /**
     * Working Memory 전체 조회
     *
     * @param {string} sessionId
     * @returns {Object[]} WM 파편 목록
     */
  async getWorkingMemory(sessionId) {
    if (!redisClient || redisClient.status !== "ready" || !sessionId) return [];

    const key = `${WM_PREFIX}${sessionId}`;

    try {
      const items = await redisClient.lrange(key, 0, -1);
      return items.map(item => JSON.parse(item));
    } catch (err) {
      console.warn(`[FragmentIndex] getWorkingMemory failed: ${err.message}`);
      return [];
    }
  }

  /**
     * Working Memory 토큰 예산 초과 시 FIFO 제거
     * importance > 0.8인 항목은 보호
     */
  async _enforceWmBudget(key) {
    const items   = await redisClient.lrange(key, 0, -1);
    const parsed  = items.map(item => JSON.parse(item));
    let totalToks = parsed.reduce((sum, p) => sum + (p.estimated_tokens || 0), 0);

    if (totalToks <= WM_MAX_TOKENS) return;

    let removed = 0;
    for (let i = 0; i < parsed.length && totalToks > WM_MAX_TOKENS; i++) {
      if ((parsed[i].importance || 0) > 0.8) continue;
      totalToks -= (parsed[i].estimated_tokens || 0);
      removed++;
    }

    if (removed > 0) {
      const remaining = parsed.filter((p, i) => {
        if (i < removed && (p.importance || 0) <= 0.8) return false;
        return true;
      });

      const pipeline = redisClient.pipeline();
      pipeline.del(key);
      for (const r of remaining) {
        pipeline.rpush(key, JSON.stringify(r));
      }
      pipeline.expire(key, WM_TTL);
      await pipeline.exec();
    }
  }

  /**
     * Working Memory 삭제 (세션 종료 시)
     */
  async clearWorkingMemory(sessionId) {
    if (!redisClient || redisClient.status !== "ready" || !sessionId) return;
    await redisClient.del(`${WM_PREFIX}${sessionId}`).catch(() => {});
  }

  /**
     * 키워드 인덱스 크기 제한 (overflow 방지)
     */
  async pruneKeywordIndexes() {
    if (!redisClient || redisClient.status !== "ready") return;

    const cursor = "0";
    const pattern = `${KW_PREFIX}*`;
    let pruned    = 0;

    try {
      const [, keys] = await redisClient.scan(cursor, "MATCH", pattern, "COUNT", 500);

      /** 모든 키의 scard를 pipeline으로 일괄 조회 */
      const scardPipeline = redisClient.pipeline();
      for (const key of keys) {
        scardPipeline.scard(key);
      }
      const scardResults = await scardPipeline.exec();

      for (let ki = 0; ki < keys.length; ki++) {
        const [scErr, size] = scardResults[ki];
        if (scErr || size <= MAX_SET_SIZE) continue;

        const members = await redisClient.srandmember(keys[ki], size - MAX_SET_SIZE);
        if (members && members.length > 0) {
          await redisClient.srem(keys[ki], ...members);
          pruned += members.length;
        }
      }
    } catch (err) {
      console.warn(`[FragmentIndex] pruneKeywordIndexes failed: ${err.message}`);
    }

    if (pruned > 0) {
      console.log(`[FragmentIndex] Pruned ${pruned} entries from keyword indexes`);
    }
  }
}
