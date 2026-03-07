/**
 * MemoryManager - 파편 기반 기억 시스템 통합 관리자
 *
 * 작성자: 최진호
 * 작성일: 2026-02-23
 * 수정일: 2026-02-25
 * 수정일: 2026-03-07 (컨텍스트 스마트 캡, recall 페이지네이션)
 *
 * MCP 도구 핸들러에서 호출되는 단일 진입점.
 * remember, recall, forget, link, reflect, context 연산을 관장한다.
 */

import { FragmentStore }       from "./FragmentStore.js";
import { FragmentIndex }       from "./FragmentIndex.js";
import { FragmentSearch }      from "./FragmentSearch.js";
import { FragmentFactory }     from "./FragmentFactory.js";
import { MemoryConsolidator }  from "./MemoryConsolidator.js";
import { getPrimaryPool }      from "../tools/db.js";
import { MEMORY_CONFIG }       from "../../config/memory.js";
import { pushToQueue }         from "../redis.js";
import { logWarn }             from "../logger.js";

let instance = null;

export class MemoryManager {
  constructor() {
    this.store        = new FragmentStore();
    this.index        = new FragmentIndex();
    this.search       = new FragmentSearch();
    this.factory      = new FragmentFactory();
    this.consolidator = new MemoryConsolidator();
  }

  static getInstance() {
    if (!instance) {
      instance = new MemoryManager();
    }
    return instance;
  }

  /**
     * remember - 파편 기억
     *
     * @param {Object} params
     *   - content   {string} 기억할 내용
     *   - topic     {string} 주제
     *   - type      {string} fact|decision|error|preference|procedure|relation
     *   - keywords  {string[]} 키워드 (선택)
     *   - importance {number} 중요도 0~1 (선택)
     *   - source    {string} 출처 (선택)
     *   - linkedTo  {string[]} 연결 파편 ID (선택)
     *   - agentId   {string} 에이전트 ID (선택)
     *   - sessionId {string} 세션 ID (선택)
     *   - scope     {string} permanent|session (기본 permanent)
     * @returns {Object} { id, keywords, ttl_tier, scope }
     */
  async remember(params) {
    const scope   = params.scope || "permanent";
    const agentId = params.agentId || "default";
    const keyId   = params._keyId ?? null;

    /**
     * scope=session: Working Memory에만 저장 (Redis, 세션 종료 시 소멸)
     * PostgreSQL에는 저장하지 않아 세션 간 오염을 방지한다.
     */
    if (scope === "session" && params.sessionId) {
      const fragment = this.factory.create(params);
      await this.index.addToWorkingMemory(params.sessionId, fragment);

      return {
        id       : fragment.id,
        keywords : fragment.keywords,
        ttl_tier : "session",
        scope    : "session",
        conflicts: []
      };
    }

    const fragment = this.factory.create({
      ...params,
      isAnchor: params.isAnchor || false
    });
    fragment.agent_id = agentId; // 명시적으로 에이전트 ID 설정
    fragment.key_id   = keyId;   // API 키 격리: 해당 키 소유 파편으로 마킹

    const id       = await this.store.insert(fragment);

    await this.index.index({ ...fragment, id }, params.sessionId);

    /** 임베딩 비동기 큐 적재 */
    try {
      await pushToQueue(MEMORY_CONFIG.embeddingWorker.queueKey, { fragmentId: id });
    } catch { /* Redis 미사용 환경 대응 */ }

    if (fragment.linked_to && fragment.linked_to.length > 0) {
      for (const linkId of fragment.linked_to) {
        await this.store.createLink(id, linkId, "related", agentId)
          .catch(() => {});
      }
    }

    /** 충돌 감지 (agentId, keyId 전달 — 동일 키 범위 내에서만 감지) */
    const conflicts = await this._detectConflicts(fragment.content, fragment.topic, id, agentId, keyId);

    /** 자동 링크 생성 (유사 파편 기반) */
    await this._autoLinkOnRemember({ ...fragment, id }, agentId).catch(err => {
      console.warn(`[MemoryManager] _autoLinkOnRemember failed: ${err.message}`);
    });

    /** 비동기 품질 평가 큐 추가 (Phase 2) */
    const EVAL_EXCLUDE_TYPES = new Set(["fact", "procedure", "error"]);
    if (!EVAL_EXCLUDE_TYPES.has(fragment.type)) {
      await pushToQueue("memory_evaluation", {
        fragmentId: id,
        agentId: agentId,
        type: fragment.type,
        content: fragment.content
      });
    }

    return {
      id,
      keywords : fragment.keywords,
      ttl_tier : fragment.ttl_tier,
      scope    : "permanent",
      conflicts
    };
  }

  /**
   * 저장된 파편과 유사한 기존 파편을 검색하여 충돌 경고 생성
   *
   * 충돌 기준: similarity > 0.8. L3 pgvector 경로(OPENAI_API_KEY 설정 시)에서만
   * similarity 값이 주입되므로 임베딩 환경에서 의미 있는 감지가 이루어진다.
   * L1/L2 경로 결과에는 similarity 필드가 없어 0으로 처리되며, 임계값을 통과하지 않는다.
   *
   * @param {string} content - 저장된 내용
   * @param {string} topic   - 주제
   * @param {string} newId   - 방금 저장된 파편 ID (자기 자신 제외용)
   * @returns {Promise<Array>} conflicts 배열
   */
  async _detectConflicts(content, topic, newId, agentId = "default", keyId = null) {
    try {
      const result = await this.search.search({
        text        : content,
        topic,
        tokenBudget : 500,
        agentId,
        keyId
      });

      const conflicts = [];

      for (const frag of result.fragments) {
        if (frag.id === newId) continue;
        const similarity = frag.similarity || 0;
        if (similarity > 0.8) {
          conflicts.push({
            existing_id     : frag.id,
            existing_content: (frag.content || "").substring(0, 100),
            similarity,
            recommendation : `기존 파편(${frag.id})을 amend 또는 forget 후 재저장 권장`
          });
        }
      }

      return conflicts;
    } catch (err) {
      console.warn(`[MemoryManager] _detectConflicts failed: ${err.message}`);
      return [];
    }
  }

  /**
     * remember() 시점 자동 링크 생성
     *
     * 새 파편의 embedding을 DB에서 직접 cosine similarity로 비교하여
     * 유형 기반 규칙으로 related, resolved_by, superseded_by 링크를 자동 생성.
     *
     * 3계층 캐스케이드(search.search)를 사용하지 않는 이유:
     * L1/L2 결과에는 similarity 값이 없어(항상 0) 임계값 판정이 불가능하다.
     * insert() 시점에 embedding이 동기 생성되므로 pgvector 직접 쿼리가 가능.
     *
     * @param {Object} newFragment - 방금 생성된 파편 (id 포함)
     * @param {string} agentId
     */
  async _autoLinkOnRemember(newFragment, agentId) {
    // GraphLinker가 EmbeddingWorker의 embedding_ready 이벤트 시 처리.
    // 인라인 임베딩이 제거되어 이 시점에 임베딩이 없으므로 동기 링킹 불가.
  }

  /**
     * recall - 파편 회상
     *
     * @param {Object} params
     *   - keywords        {string[]} 검색 키워드
     *   - topic           {string}   주제 필터
     *   - type            {string}   유형 필터
     *   - text            {string}   자연어 검색 (시맨틱)
     *   - tokenBudget     {number}   최대 토큰 수 (기본 1000)
     *   - includeLinks    {boolean}  연결 파편 포함 여부 (기본 true, 1-hop 제한, resolved_by/caused_by 우선)
     *   - linkRelationType {string}  연결 파편 관계 유형 필터 (미지정 시 caused_by, resolved_by, related 포함)
     *   - fragmentCount   {number}   전체 파편 수 — 100 이상 시 복합 랭킹 활성화 (기본 0)
     *   - threshold       {number}   similarity 임계값 (0~1). 미만 파편 제거. similarity 없는 파편은 보존
     * @returns {Object} { fragments, totalTokens, searchPath, count }
     */
  async recall(params) {
    const agentId       = params.agentId || "default";
    const fragmentCount = params.fragmentCount || 0;
    const keyId         = params._keyId ?? null;

    const anchorTime = params.anchorTime || Date.now();

    const result = await this.search.search({
      keywords     : params.keywords || [],
      topic        : params.topic,
      type         : params.type,
      text         : params.text,
      tokenBudget  : params.tokenBudget || 1000,
      minImportance: params.minImportance,
      fragmentCount,                          // 하위 호환 유지
      anchorTime,                             // 시간-의미 복합 랭킹 기준
      agentId,                                // RLS 컨텍스트
      keyId                                   // API 키 격리 필터
    });

    /** 연결 파편 포함 (기본 true, 1-hop 제한, fragment_links 테이블 활용) */
    const shouldIncludeLinks = params.includeLinks !== false;
    if (shouldIncludeLinks && result.fragments.length > 0) {
      const existingIds = new Set(result.fragments.map(f => f.id));
      const fromIds     = result.fragments.map(f => f.id);

      const linkedFrags = await this.store.getLinkedFragments(
        fromIds,
        params.linkRelationType || null,
        agentId
      );

      for (const lf of linkedFrags) {
        if (!existingIds.has(lf.id)) {
          result.fragments.push(lf);
          existingIds.add(lf.id);
        }
      }
      result.count = result.fragments.length;
    }

    /**
     * 복합 랭킹 재정렬 — includeLinks로 추가된 파편까지 포함하여 정렬 보장.
     * anchorTime 기반 시간 근접도 + importance + similarity 복합 점수.
     */
    const { importanceWeight, recencyWeight, semanticWeight, recencyHalfLifeDays } = MEMORY_CONFIG.ranking;
    result.fragments.sort((a, b) => {
      const scoreOf = (f) => {
        const importance = f.importance || 0;
        const parsed     = f.created_at ? new Date(f.created_at).getTime() : NaN;
        const createdAt  = Number.isFinite(parsed) ? parsed : Date.now();
        const distDays   = Math.abs(anchorTime - createdAt) / 86400000;
        const proximity  = Math.pow(2, -distDays / (recencyHalfLifeDays || 30));
        const similarity = f.similarity || 0;
        return importance * (importanceWeight || 0.4)
             + proximity  * (recencyWeight    || 0.3)
             + similarity * (semanticWeight   || 0.3);
      };
      return scoreOf(b) - scoreOf(a);
    });

    /** stale 감지 및 메타데이터 주입 */
    const staleThresholds = MEMORY_CONFIG.staleThresholds;
    const now = Date.now();

    for (const frag of result.fragments) {
      const staleDays  = staleThresholds[frag.type] ?? staleThresholds.default;
      const verifiedAt = frag.verified_at ? new Date(frag.verified_at).getTime() : null;
      const daysSince  = verifiedAt
        ? Math.floor((now - verifiedAt) / 86400000)
        : staleDays + 1;

      if (daysSince >= staleDays) {
        frag.metadata = {
          ...(frag.metadata || {}),
          stale  : true,
          warning: `[STALE_WARNING] 이 ${frag.type} 정보는 ${staleDays}일 이상 검증되지 않았습니다. (${daysSince}일 경과)`,
          days_since_verification: daysSince
        };
      }
    }

    /** threshold 필터: similarity가 있는 파편만 필터링, L1/L2 결과(similarity 없음)는 보존 */
    if (params.threshold !== undefined) {
      result.fragments = result.fragments.filter(
        f => f.similarity === undefined || f.similarity >= params.threshold
      );
      result.count = result.fragments.length;
    }

    /** 페이지네이션 */
    const pageSize = Math.min(
      params.pageSize || MEMORY_CONFIG.pagination?.defaultPageSize || 20,
      MEMORY_CONFIG.pagination?.maxPageSize || 50
    );

    let   offset     = 0;
    let   anchorSnap = params.anchorTime || Date.now();
    if (params.cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(params.cursor, "base64url").toString());
        offset     = decoded.offset     || 0;
        anchorSnap = decoded.anchorTime  || anchorSnap;
      } catch { /* 잘못된 cursor 무시 */ }
    }

    const totalCount = result.fragments.length;
    const paged      = result.fragments.slice(offset, offset + pageSize);
    const hasMore    = offset + pageSize < totalCount;
    const nextCursor = hasMore
      ? Buffer.from(JSON.stringify({ offset: offset + pageSize, anchorTime: anchorSnap })).toString("base64url")
      : null;

    result.fragments  = paged;
    result.count      = paged.length;
    result.totalCount = totalCount;
    result.nextCursor = nextCursor;
    result.hasMore    = hasMore;

    return result;
  }

  /**
     * forget - 파편 망각
     *
     * @param {Object} params
     *   - id          {string} 특정 파편 ID
     *   - topic       {string} 주제 전체 삭제
     *   - beforeDays  {number} N일 전 이전 파편 삭제
     *   - force       {boolean} permanent 파편도 삭제 여부
     * @returns {Object} { deleted, protected }
     */
  async forget(params) {
    const agentId  = params.agentId || "default";
    const keyId    = params._keyId ?? null;
    let deleted    = 0;
    let protected_ = 0;

    if (params.id) {
      const frag = await this.store.getById(params.id, agentId);
      if (!frag) return { deleted: 0, protected: 0, error: "Fragment not found" };

      /** API 키 소유권 검사: 마스터가 아니면 자신의 파편만 삭제 가능 */
      if (keyId && frag.key_id !== keyId) {
        return { deleted: 0, protected: 1, reason: "이 파편에 대한 삭제 권한이 없습니다." };
      }

      if (frag.ttl_tier === "permanent" && !params.force) {
        return { deleted: 0, protected: 1, reason: "permanent 파편은 force 옵션 필요" };
      }

      await this.index.deindex(frag.id, frag.keywords, frag.topic, frag.type);
      const ok = await this.store.delete(frag.id, agentId, keyId);
      deleted  = ok ? 1 : 0;
    }

    if (params.topic) {
      const topicIds = await this.index.searchByTopic(params.topic);

      for (const tid of topicIds) {
        const frag = await this.store.getById(tid, agentId);
        if (!frag) continue;

        /** API 키 소유권 검사 */
        if (keyId && frag.key_id !== keyId) {
          protected_++;
          continue;
        }

        if (frag.ttl_tier === "permanent" && !params.force) {
          protected_++;
          continue;
        }

        await this.index.deindex(frag.id, frag.keywords, frag.topic, frag.type);
        const ok = await this.store.delete(frag.id, agentId, keyId);
        if (ok) deleted++;
      }
    }

    return { deleted, protected: protected_ };
  }

  /**
   * 에이전트의 모든 기억 삭제
   */
  async deleteByAgent(agentId) {
    if (!agentId || agentId === "default") {
      throw new Error("Invalid agentId for full deletion");
    }

    // 1. Redis 인덱스 삭제 (현재 topic/keyword 전체 스캔이 필요할 수 있으나 생략 가능 - PostgreSQL이 소스임)
    // 2. PostgreSQL 삭제 (Cascade로 버전/링크 자동 삭제)
    const count = await this.store.deleteByAgent(agentId);

    // 3. Working Memory 삭제
    await this.index.clearWorkingMemory(agentId); // sessionId로 쓰이기도 함

    return { deleted: count };
  }

  /**
     * link - 파편 간 관계 설정
     *
     * @param {Object} params
     *   - fromId       {string}
     *   - toId         {string}
     *   - relationType {string} related|caused_by|resolved_by|part_of|contradicts
     * @returns {Object} { linked }
     */
  async link(params) {
    const agentId = params.agentId || "default";
    const fromFrag = await this.store.getById(params.fromId, agentId);
    const toFrag   = await this.store.getById(params.toId, agentId);

    if (!fromFrag || !toFrag) {
      return { linked: false, error: "One or both fragments not found" };
    }

    const relationType = params.relationType || "related";
    await this.store.createLink(params.fromId, params.toId, relationType, agentId);

    /**
     * resolved_by 링크: 대상(toId)이 error 파편이면
     * importance를 0.5로 하향하여 warm 계층으로 전환.
     * 해결된 에러는 참조 가치가 감소하되 즉시 삭제는 방지.
     */
    if (relationType === "resolved_by" && toFrag.type === "error" && toFrag.importance > 0.5) {
      await this.store.update(params.toId, {
        importance: 0.5
      }, agentId);
    }

    return { linked: true, relationType };
  }

  /**
     * amend - 기존 파편의 content/metadata를 갱신
     * ID와 linked_to(링크)를 보존하면서 내용만 교체한다.
     *
     * @param {Object} params
     *   - id         {string} 갱신 대상 파편 ID (필수)
     *   - content    {string} 새 내용 (선택)
     *   - topic      {string} 새 주제 (선택)
     *   - keywords   {string[]} 새 키워드 (선택)
     *   - type       {string} 새 유형 (선택)
     *   - importance {number} 새 중요도 (선택)
     *   - agentId    {string} 에이전트 ID (선택)
     * @returns {Object} { updated, fragment }
     */
  async amend(params) {
    if (!params.id) {
      return { updated: false, error: "id is required" };
    }

    const agentId = params.agentId || "default";
    const keyId   = params._keyId ?? null;
    const existing = await this.store.getById(params.id, agentId);
    if (!existing) {
      return { updated: false, error: "Fragment not found" };
    }

    /** API 키 소유권 검사: 마스터가 아니면 자신의 파편만 수정 가능 */
    if (keyId && existing.key_id !== keyId) {
      return { updated: false, error: "이 파편에 대한 수정 권한이 없습니다." };
    }

    const updates = {};
    if (params.content !== undefined) {
      updates.content = params.content;
    }
    if (params.topic !== undefined)      updates.topic      = params.topic;
    if (params.keywords !== undefined && Array.isArray(params.keywords)) {
      updates.keywords = params.keywords.map(k => k.toLowerCase());
    }
    if (params.type !== undefined)       updates.type       = params.type;
    if (params.importance !== undefined) updates.importance  = params.importance;
    if (params.isAnchor !== undefined)   updates.is_anchor   = params.isAnchor;

    const result = await this.store.update(params.id, updates, agentId, keyId, existing);

    if (!result) {
      return { updated: false, error: "Update failed" };
    }

    if (result.merged) {
      return { updated: false, merged: true, existingId: result.existingId };
    }

    if (params.supersedes) {
      /**
       * in-place update 구조에서 superseded_by 자기참조 링크는 무의미.
       * archive(fragment_versions INSERT)로 이력이 보존되며,
       * verified_at은 update() 내부에서 NOW()로 갱신된다.
       */
    }

    /** Redis 인덱스 갱신: 기존 제거 후 재등록 */
    await this.index.deindex(existing.id, existing.keywords, existing.topic, existing.type);
    await this.index.index(result);

    return { updated: true, fragment: result };
  }

  /**
     * reflect - 세션 요약 및 구조화 파편 생성
     *
     * 구조화된 항목별 매핑:
     *   summary          → type: fact (session_reflect 토픽)
     *   decisions[]      → type: decision (각각 별도 파편)
     *   errors_resolved[] → type: error + resolved_by 링크 후보
     *   new_procedures[] → type: procedure
     *   open_questions[] → type: fact (importance 0.4, 후속 처리용)
     *
     * @param {Object} params
     *   - sessionId       {string}
     *   - summary         {string} 세션 요약 (필수)
     *   - decisions       {string[]} 결정 사항 (선택)
     *   - errors_resolved {string[]} 해결된 에러 (선택)
     *   - new_procedures  {string[]} 새 절차 (선택)
     *   - open_questions  {string[]} 미해결 질문 (선택)
     *   - agentId         {string}
     * @returns {Object} { fragments, count, breakdown }
     */
  async reflect(params) {
    const fragments = [];
    const sessionSrc = `session:${params.sessionId || "unknown"}`;
    const agentId    = params.agentId || "default";
    const keyId      = params._keyId ?? null;
    const breakdown  = { summary: 0, decisions: 0, errors: 0, procedures: 0, questions: 0 };

    /** 0. sessionId가 있으면 세션 파편에서 미입력 항목 종합 */
    if (params.sessionId) {
      const consolidated = await this._consolidateSessionFragments(params.sessionId, agentId, keyId);
      if (consolidated) {
        if (!params.summary && consolidated.summary) params.summary = consolidated.summary;
        if (!params.decisions?.length && consolidated.decisions?.length) params.decisions = consolidated.decisions;
        if (!params.errors_resolved?.length && consolidated.errors_resolved?.length) params.errors_resolved = consolidated.errors_resolved;
        if (!params.new_procedures?.length && consolidated.new_procedures?.length) params.new_procedures = consolidated.new_procedures;
        if (!params.open_questions?.length && consolidated.open_questions?.length) params.open_questions = consolidated.open_questions;
      }
    }

    /** 1. summary → fact 파편 */
    if (params.summary) {
      const created = this.factory.splitAndCreate(params.summary, {
        topic   : "session_reflect",
        type    : "fact",
        source  : sessionSrc,
        agentId
      });

      for (const f of created) {
        f.agent_id = agentId;
        const id = await this.store.insert(f);
        await this.index.index({ ...f, id }, params.sessionId);
        fragments.push({ id, content: f.content, type: "fact", keywords: f.keywords });
        breakdown.summary++;
      }
    }

    /** 2. decisions → decision 파편 */
    if (params.decisions && params.decisions.length > 0) {
      for (const dec of params.decisions) {
        if (!dec || dec.trim().length === 0) continue;
        const f = this.factory.create({
          content    : dec.trim(),
          topic      : "session_reflect",
          type       : "decision",
          importance : 0.8,
          source     : sessionSrc,
          agentId
        });
        f.agent_id = agentId;
        const id = await this.store.insert(f);
        await this.index.index({ ...f, id }, params.sessionId);
        fragments.push({ id, content: f.content, type: "decision", keywords: f.keywords });
        breakdown.decisions++;
      }
    }

    /** 3. errors_resolved → error 파편 (해결됨 표시) */
    if (params.errors_resolved && params.errors_resolved.length > 0) {
      for (const err of params.errors_resolved) {
        if (!err || err.trim().length === 0) continue;
        const f = this.factory.create({
          content    : `[해결됨] ${err.trim()}`,
          topic      : "session_reflect",
          type       : "error",
          importance : 0.5,
          source     : sessionSrc,
          agentId
        });
        f.agent_id = agentId;
        const id = await this.store.insert(f);
        await this.index.index({ ...f, id }, params.sessionId);
        fragments.push({ id, content: f.content, type: "error", keywords: f.keywords });
        breakdown.errors++;
      }
    }

    /** 4. new_procedures → procedure 파편 */
    if (params.new_procedures && params.new_procedures.length > 0) {
      for (const proc of params.new_procedures) {
        if (!proc || proc.trim().length === 0) continue;
        const f = this.factory.create({
          content    : proc.trim(),
          topic      : "session_reflect",
          type       : "procedure",
          importance : 0.7,
          source     : sessionSrc,
          agentId
        });
        f.agent_id = agentId;
        const id = await this.store.insert(f);
        await this.index.index({ ...f, id }, params.sessionId);
        fragments.push({ id, content: f.content, type: "procedure", keywords: f.keywords });
        breakdown.procedures++;
      }
    }

    /** 5. open_questions → fact 파편 (낮은 importance, 후속 처리용) */
    if (params.open_questions && params.open_questions.length > 0) {
      for (const q of params.open_questions) {
        if (!q || q.trim().length === 0) continue;
        const f = this.factory.create({
          content    : `[미해결] ${q.trim()}`,
          topic      : "session_reflect",
          type       : "fact",
          importance : 0.4,
          source     : sessionSrc,
          agentId
        });
        f.agent_id = agentId;
        const id = await this.store.insert(f);
        await this.index.index({ ...f, id }, params.sessionId);
        fragments.push({ id, content: f.content, type: "fact", keywords: f.keywords });
        breakdown.questions++;
      }
    }

    /** 6. task_effectiveness → task_feedback 저장 */
    if (params.task_effectiveness) {
      try {
        await this._saveTaskFeedback(
          params.sessionId || "unknown",
          params.task_effectiveness
        );
        breakdown.task_feedback = true;
      } catch (err) {
        console.warn(`[MemoryManager] task_feedback save failed: ${err.message}`);
        breakdown.task_feedback = false;
      }
    }

    /** 6.5. 세션 파편 간 자동 link 생성 */
    await this._autoLinkSessionFragments(fragments, agentId);

    /** 7. Working Memory 정리 (세션 종료) */
    if (params.sessionId) {
      await this.index.clearWorkingMemory(params.sessionId);
    }

    return { fragments, count: fragments.length, breakdown };
  }

  /**
     * context - Core Memory + Working Memory 분리 로드
     *
     * Core Memory (~1000토큰, 고정 prefix):
     *   preference 파편 전체 + 핵심 procedure (importance > 0.8)
     *   세션 간 변하지 않음 → prompt caching prefix 역할
     *
     * Working Memory (~500토큰, append-only 꼬리):
     *   세션 내 remember(scope=session)로 저장된 파편
     *   Redis frag:wm:{sessionId}에서 로드
     *
     * @param {Object} params
     *   - agentId     {string}
     *   - sessionId   {string} 세션 ID (WM 로드용)
     *   - tokenBudget {number} 기본 2000
     *   - types       {string[]} 로드할 유형 목록 (기본: preference, error, procedure)
     * @returns {Object} { fragments, totalTokens, injectionText, coreTokens, wmTokens, wmCount }
     */
  async context(params) {
    const tokenBudget     = params.tokenBudget || 2000;
    const types           = params.types || ["preference", "error", "procedure"];
    const coreBudget      = Math.min(1000, Math.floor(tokenBudget * 0.65));
    const wmBudget        = Math.min(500, tokenBudget - coreBudget);
    const coreCharBudget  = coreBudget * 4;

    /** ── Core Memory 로드 ── */
    const typeFragMap = new Map();
    const agentId     = params.agentId || "default";

    for (const type of types) {
      const result = await this.recall({
        type,
        tokenBudget: Math.max(250, Math.floor(coreBudget / types.length)),
        minImportance: 0.3,
        agentId
      });
      typeFragMap.set(type, result.fragments);
    }

    const guaranteed = new Map();
    const seen       = new Set();
    let usedChars    = 0;

    for (const type of types) {
      const frags = typeFragMap.get(type) || [];
      if (frags.length > 0) {
        const top     = frags[0];
        const content = top.content || "";
        guaranteed.set(type, [top]);
        seen.add(top.id);
        usedChars += content.length;
      }
    }

    const extras = [];
    for (const type of types) {
      const frags = typeFragMap.get(type) || [];
      for (let i = 1; i < frags.length; i++) {
        if (!seen.has(frags[i].id)) {
          extras.push(frags[i]);
          seen.add(frags[i].id);
        }
      }
    }
    extras.sort((a, b) => (b.importance || 0) - (a.importance || 0));

    /** 스마트 캡: 파편 수 상한 + 유형별 슬롯 제한 */
    const maxCore      = MEMORY_CONFIG.contextInjection?.maxCoreFragments || 15;
    const typeSlots    = MEMORY_CONFIG.contextInjection?.typeSlots || {};
    let   totalAdded   = 0;
    for (const [, frags] of guaranteed) {
      totalAdded += frags.length;
    }

    const typeCounters = {};
    for (const [type, frags] of guaranteed) {
      typeCounters[type] = frags.length;
    }

    for (const f of extras) {
      if (totalAdded >= maxCore) break;

      const typeKey  = f.type || "general";
      const typeMax  = typeSlots[typeKey] || 5;
      const current  = typeCounters[typeKey] || 0;
      if (current >= typeMax) continue;

      const cost = (f.content || "").length;
      if (usedChars + cost > coreCharBudget) {
        const remaining = coreCharBudget - usedChars;
        if (remaining > 80) {
          const truncated = { ...f, content: f.content.substring(0, remaining - 3) + "..." };
          const typeArr   = guaranteed.get(typeKey) || [];
          typeArr.push(truncated);
          guaranteed.set(typeKey, typeArr);
          usedChars += remaining;
          typeCounters[typeKey] = (typeCounters[typeKey] || 0) + 1;
          totalAdded++;
        }
        break;
      }

      const typeArr = guaranteed.get(typeKey) || [];
      typeArr.push(f);
      guaranteed.set(typeKey, typeArr);
      usedChars += cost;
      typeCounters[typeKey] = (typeCounters[typeKey] || 0) + 1;
      totalAdded++;
    }

    const coreFragments = [];
    for (const type of types) {
      const frags = guaranteed.get(type) || [];
      coreFragments.push(...frags);
    }

    /** ── Working Memory 로드 (Redis) ── */
    let wmFragments = [];
    let wmChars     = 0;

    if (params.sessionId) {
      const wmItems      = await this.index.getWorkingMemory(params.sessionId);
      const wmCharBudget = wmBudget * 4;
      const maxWm        = MEMORY_CONFIG.contextInjection?.maxWmFragments || 10;

      for (const item of wmItems) {
        if (wmFragments.length >= maxWm) break;
        const cost = (item.content || "").length;
        if (wmChars + cost > wmCharBudget) break;
        wmFragments.push(item);
        wmChars += cost;
      }
    }

    /** ── 주입용 텍스트 생성 (Core + WM 분리) ── */
    const coreSections = {};
    for (const f of coreFragments) {
      const key = f.type || "general";
      if (!coreSections[key]) coreSections[key] = [];
      coreSections[key].push(f.content);
    }

    const lines = ["[CORE MEMORY]"];
    for (const [type, contents] of Object.entries(coreSections)) {
      lines.push(`[${type.toUpperCase()}]`);
      for (const c of contents) {
        lines.push(`- ${c}`);
      }
    }

    if (wmFragments.length > 0) {
      lines.push("");
      lines.push("[WORKING MEMORY]");
      for (const wm of wmFragments) {
        const label = wm.type ? `[${wm.type.toUpperCase()}]` : "";
        lines.push(`- ${label} ${wm.content}`);
      }
    }

    /** 미반영(unreflected) 세션 감지 힌트 */
    try {
      const { SessionActivityTracker } = await import("./SessionActivityTracker.js");
      const unreflected = await SessionActivityTracker.getUnreflectedSessions(3);
      if (unreflected.length > 0) {
        lines.push("");
        lines.push("[SYSTEM HINT]");
        lines.push(`- 미반영 세션 ${unreflected.length}개 감지. 세션 종료 전 reflect()를 호출하면 학습 내용이 보존됩니다.`);
      }
    } catch { /* 무시 */ }

    const coreTokens = Math.ceil(usedChars / 4);
    const wmTokens   = Math.ceil(wmChars / 4);

    return {
      fragments    : [...coreFragments, ...wmFragments],
      totalTokens  : coreTokens + wmTokens,
      count        : coreFragments.length + wmFragments.length,
      coreTokens,
      wmTokens,
      wmCount      : wmFragments.length,
      injectionText: lines.join("\n")
    };
  }

  /**
     * toolFeedback - 도구 유용성 피드백 저장
     *
     * @param {Object} params
     *   - tool_name    {string} 평가 대상 도구명 (필수)
     *   - relevant     {boolean} 관련성 (필수)
     *   - sufficient   {boolean} 충분성 (필수)
     *   - suggestion   {string} 개선 제안 (선택, 100자 절삭)
     *   - context      {string} 사용 맥락 (선택, 50자 절삭)
     *   - session_id   {string} 세션 ID (선택)
     *   - trigger_type {string} sampled|voluntary (기본 voluntary)
     * @returns {Object} { id, tool_name, relevant, sufficient }
     */
  async toolFeedback(params) {
    const pool = getPrimaryPool();
    if (!pool) throw new Error("DB pool not available");

    const suggestion  = params.suggestion
      ? params.suggestion.substring(0, 100)
      : null;
    const context     = params.context
      ? params.context.substring(0, 50)
      : null;
    const triggerType = params.trigger_type || "voluntary";

    const result = await pool.query(
      `INSERT INTO agent_memory.tool_feedback
             (tool_name, relevant, sufficient, suggestion, context, session_id, trigger_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        params.tool_name,
        params.relevant,
        params.sufficient,
        suggestion,
        context,
        params.session_id || null,
        triggerType
      ]
    );

    return {
      id         : result.rows[0].id,
      tool_name  : params.tool_name,
      relevant   : params.relevant,
      sufficient : params.sufficient
    };
  }

  /**
     * task_feedback 저장 (reflect에서 호출)
     * @private
     */
  async _saveTaskFeedback(sessionId, effectiveness) {
    const pool = getPrimaryPool();
    if (!pool) return;

    await pool.query(
      `INSERT INTO agent_memory.task_feedback
             (session_id, overall_success, tool_highlights, tool_pain_points)
       VALUES ($1, $2, $3, $4)`,
      [
        sessionId,
        effectiveness.overall_success || false,
        effectiveness.tool_highlights || [],
        effectiveness.tool_pain_points || []
      ]
    );
  }

  /**
   * sessionId와 같은 세션에 속한 파편들을 조회하여 summary, decisions, errors_resolved,
   * new_procedures, open_questions로 종합한다.
   *
   * @param {string}      sessionId - 세션 ID
   * @param {string}      agentId   - 에이전트 ID
   * @param {string|null} keyId     - API 키 격리 (null: 마스터)
   * @returns {Promise<Object|null>} { summary, decisions, errors_resolved, new_procedures, open_questions } 또는 null
   */
  async _consolidateSessionFragments(sessionId, agentId = "default", keyId = null) {
    const ids     = await this.index.getSessionFragments(sessionId);
    const wmItems = await this.index.getWorkingMemory(sessionId);

    const rows = ids?.length > 0 ? await this.store.getByIds(ids, agentId, keyId) : [];
    const allRows = [
      ...(rows || []),
      ...(wmItems || []).map(w => ({
        content: w.content,
        type   : w.type || "fact"
      }))
    ];
    if (!allRows.length) return null;

    const decisions      = [];
    const errorsResolved = [];
    const procedures     = [];
    const openQuestions  = [];
    const summaryParts   = [];

    for (const r of allRows) {
      const content = (r.content || "").trim();
      if (!content) continue;

      switch (r.type) {
        case "decision":
          decisions.push(content.replace(/^\[해결됨\]\s*/i, "").trim());
          break;
        case "error":
          errorsResolved.push(content.replace(/^\[해결됨\]\s*/i, "").trim());
          break;
        case "procedure":
          procedures.push(content);
          break;
        case "fact":
          if (content.includes("[미해결]")) {
            openQuestions.push(content.replace(/^\[미해결\]\s*/i, "").trim());
          } else {
            summaryParts.push(content);
          }
          break;
        default:
          summaryParts.push(content);
      }
    }

    const summary = summaryParts.length > 0
      ? `세션 ${sessionId.substring(0, 8)}... 종합: ${summaryParts.join(" ")}`
      : (decisions.length || errorsResolved.length || procedures.length
        ? `세션 ${sessionId.substring(0, 8)}... 종합: 결정 ${decisions.length}건, 에러 해결 ${errorsResolved.length}건, 절차 ${procedures.length}건`
        : null);

    if (!summary && !decisions.length && !errorsResolved.length && !procedures.length && !openQuestions.length) {
      return null;
    }

    return {
      summary,
      decisions: [...new Set(decisions)],
      errors_resolved: [...new Set(errorsResolved)],
      new_procedures: [...new Set(procedures)],
      open_questions: [...new Set(openQuestions)]
    };
  }

  /**
   * 세션 파편 간 규칙 기반 자동 link 생성
   *
   * @param {Array} fragments - reflect에서 저장된 파편 목록 [{id, type, ...}]
   * @param {string} agentId - 에이전트 ID
   */
  async _autoLinkSessionFragments(fragments, agentId = "default") {
    const errors     = fragments.filter(f => f.type === "error");
    const decisions  = fragments.filter(f => f.type === "decision");
    const procedures = fragments.filter(f => f.type === "procedure");

    /** 규칙 1: error + decision → caused_by */
    for (const err of errors) {
      for (const dec of decisions) {
        if (await this._wouldCreateCycle(err.id, dec.id, agentId)) continue;
        await this.store.createLink(err.id, dec.id, "caused_by", agentId).catch(() => {});
      }
    }

    /** 규칙 2: procedure + error → resolved_by */
    for (const proc of procedures) {
      for (const err of errors) {
        if (await this._wouldCreateCycle(proc.id, err.id, agentId)) continue;
        await this.store.createLink(proc.id, err.id, "resolved_by", agentId).catch(() => {});
      }
    }
  }

  /**
   * A → B 링크 생성 시 순환 참조 발생 여부 확인 (B → A 경로 존재 시 true)
   * BFS 기반 다중 홉 탐지
   *
   * @param {string} fromId
   * @param {string} toId
   * @param {string} agentId
   * @returns {Promise<boolean>}
   */
  async _wouldCreateCycle(fromId, toId, agentId = "default") {
    try {
      const visited = new Set();
      const queue   = [toId];

      while (queue.length > 0) {
        const current = queue.shift();
        if (current === fromId) return true;
        if (visited.has(current)) continue;
        visited.add(current);

        // 1-hop 연결 ID 목록 조회 (RLS 적용)
        const linked = await this.store.getLinkedIds(current, agentId);
        for (const nextId of linked) {
          if (!visited.has(nextId)) {
            queue.push(nextId);
          }
        }

        /** 성능 보호: 최대 20개 파편까지만 추적 (과도한 쿼리 방지) */
        if (visited.size > 20) break;
      }
      return false;
    } catch (err) {
      logWarn(`[MemoryManager] Cycle detection failed: ${err.message}`);
      return false;
    }
  }

  /**
     * graph_explore — RCA 체인 추적
     *
     * error 파편 기점으로 caused_by, resolved_by 체인을 1-hop 추적한다.
     *
     * @param {Object} params
     *   - startId {string} 시작 파편 ID (필수)
     * @returns {Object} { startId, nodes, edges, count }
     */
  async graphExplore(params) {
    if (!params.startId) {
      return { error: "startId is required" };
    }

    const agentId = params.agentId || "default";
    const nodes = await this.store.getRCAChain(params.startId, agentId);

    const edges = nodes
      .filter(n => n.relation_type)
      .map(n => ({
        from         : params.startId,
        to           : n.id,
        relation_type: n.relation_type
      }));

    return {
      startId: params.startId,
      nodes,
      edges,
      count  : nodes.length
    };
  }

  /**
     * consolidate - 유지보수 (주기적 호출용)
     */
  async consolidate() {
    return this.consolidator.consolidate();
  }

  /**
     * stats - 전체 통계
     */
  async stats() {
    return this.consolidator.getStats();
  }
}
