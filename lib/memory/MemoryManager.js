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

import crypto                    from "crypto";
import { FragmentStore }         from "./FragmentStore.js";
import { getFragmentIndex }      from "./FragmentIndex.js";
import { FragmentSearch }        from "./FragmentSearch.js";
import { FragmentFactory }       from "./FragmentFactory.js";
import { MemoryConsolidator }    from "./MemoryConsolidator.js";
import { EmbeddingWorker }       from "./EmbeddingWorker.js";
import { getPrimaryPool }        from "../tools/db.js";
import { MEMORY_CONFIG }         from "../../config/memory.js";
import { MorphemeIndex }         from "./MorphemeIndex.js";
import { GraphLinker }           from "./GraphLinker.js";
import { logWarn }               from "../logger.js";
import { ConflictResolver }      from "./ConflictResolver.js";
import { SessionLinker }         from "./SessionLinker.js";
import { TemporalLinker }        from "./TemporalLinker.js";
import { HistoryReconstructor }  from "./HistoryReconstructor.js";
import { CaseEventStore }        from "./CaseEventStore.js";
import { activateByContext }     from "./SpreadingActivation.js";
import { QuotaChecker }          from "./QuotaChecker.js";
import { RememberPostProcessor } from "./RememberPostProcessor.js";
import { CaseRecall }            from "./CaseRecall.js";
import { ContextBuilder }            from "./ContextBuilder.js";
import { ReflectProcessor }          from "./ReflectProcessor.js";
import { BatchRememberProcessor }    from "./BatchRememberProcessor.js";
import { SYMBOLIC_CONFIG }               from "../../config/symbolic.js";
import { LinkIntegrityChecker }          from "../symbolic/LinkIntegrityChecker.js";
import { PolicyRules }                   from "../symbolic/PolicyRules.js";
import { symbolicMetrics }               from "../symbolic/SymbolicMetrics.js";
import { SymbolicPolicyViolationError }  from "../symbolic/errors.js";
import { getSymbolicHardGate }           from "../admin/ApiKeyStore.js";

const morphemeIndex = new MorphemeIndex();

let instance = null;

export class MemoryManager {
  constructor() {
    this.store             = new FragmentStore();
    this.index             = getFragmentIndex();
    this.search            = new FragmentSearch();
    this.factory           = new FragmentFactory();
    this.consolidator      = new MemoryConsolidator();
    this.sessionLinker     = new SessionLinker(this.store, this.index);

    /** Phase 3/4 symbolic components — advisory only, 기본값 off */
    this.linkChecker       = new LinkIntegrityChecker({ sessionLinker: this.sessionLinker });
    this.policyRules       = new PolicyRules();

    this.conflictResolver  = new ConflictResolver(this.store, this.search, {
      linkChecker: this.linkChecker
    });
    this.temporalLinker    = new TemporalLinker(this.store.links);
    this.caseEventStore    = new CaseEventStore();
    this.quotaChecker      = new QuotaChecker();
    this.postProcessor     = new RememberPostProcessor({
      store           : this.store,
      conflictResolver: this.conflictResolver,
      temporalLinker  : this.temporalLinker,
      morphemeIndex,
      search          : this.search,
      linkChecker     : this.linkChecker,
    });
    this.contextBuilder    = new ContextBuilder({
      recall: this.recall.bind(this),
      store : this.store,
      index : this.index,
    });
    this.reflectProcessor  = new ReflectProcessor({
      store        : this.store,
      index        : this.index,
      factory      : this.factory,
      sessionLinker: this.sessionLinker,
      remember     : this.remember.bind(this),
    });
    this.batchRememberProcessor = new BatchRememberProcessor({
      store  : this.store,
      index  : this.index,
      factory: this.factory,
    });

    /**
     * hard gate 조회 함수. 기본값은 ApiKeyStore.getSymbolicHardGate.
     * 단위 테스트에서 인스턴스 프로퍼티 교체로 mock 주입 가능.
     * @type {(keyId: string) => Promise<boolean>}
     */
    this._getHardGate = getSymbolicHardGate;

    /**
     * Phase 4 Soft/Hard Gating 활성화 여부.
     * SYMBOLIC_CONFIG.enabled && SYMBOLIC_CONFIG.policyRules를 기본값으로 하지만
     * 단위 테스트에서 인스턴스 레벨로 true 설정 가능.
     * null이면 SYMBOLIC_CONFIG 값을 사용.
     * @type {boolean|null}
     */
    this._policyGatingEnabled = null;
  }

  static getInstance() {
    if (!instance) {
      instance = new MemoryManager();
    }
    return instance;
  }

  static create(deps = {}) {
    const mm = new MemoryManager();
    if (deps.store)            mm.store            = deps.store;
    if (deps.search)           mm.search           = deps.search;
    if (deps.factory)          mm.factory          = deps.factory;
    if (deps.consolidator)     mm.consolidator     = deps.consolidator;
    if (deps.conflictResolver) mm.conflictResolver = deps.conflictResolver;
    if (deps.sessionLinker)    mm.sessionLinker     = deps.sessionLinker;
    return mm;
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
    const scope       = params.scope || "permanent";
    const agentId     = params.agentId || "default";
    const keyId       = params._keyId ?? null;
    const groupKeyIds = params._groupKeyIds ?? (keyId != null ? [keyId] : null);
    const sessionId   = params.sessionId || params._sessionId || null;
    const workspace   = params.workspace ?? params._defaultWorkspace ?? null;
    const source      = params.source ?? (sessionId ? `session:${sessionId.slice(0, 8)}` : null);

    /**
     * scope=session: Working Memory에만 저장 (Redis, 세션 종료 시 소멸)
     * PostgreSQL에는 저장하지 않아 세션 간 오염을 방지한다.
     */
    if (scope === "session" && sessionId) {
      const fragment = this.factory.create({
        ...params,
        contextSummary: params.contextSummary || null,
        sessionId
      });
      await this.index.addToWorkingMemory(sessionId, fragment);

      return {
        id       : fragment.id,
        keywords : fragment.keywords,
        ttl_tier : "session",
        scope    : "session",
        conflicts: []
      };
    }

    /**
     * 할당량 초과 검사: API 키 소유 파편이 fragment_limit에 도달했으면 거부.
     *
     * TODO(TOCTOU): 이 할당량 검사(FOR UPDATE + COMMIT)와 아래 store.insert() 호출이
     * 별도 트랜잭션으로 분리되어 있어 동시 요청 시 limit 초과가 이론적으로 가능하다.
     * 완전한 해결을 위해서는 FragmentWriter.insert()에 client를 주입받는 인터페이스를
     * 추가하여 단일 트랜잭션 내에서 quota check + INSERT를 처리해야 한다.
     * 단일 remember() 요청의 경쟁 조건 위험도는 낮으므로 현재는 선제 검사로 운용한다.
     * batchRemember()는 Phase B 내에서 재검증을 추가로 수행한다.
     */
    await this.quotaChecker.check(keyId);

    /** case_id 자동 할당: 동일 session+topic의 error 흐름 감지 */
    const AUTO_CASE_TYPES = new Set(["error", "procedure", "decision"]);
    if (!params.caseId && sessionId && params.topic && AUTO_CASE_TYPES.has(params.type)) {
      const existingCaseId = await this.store.findCaseIdBySessionTopic(sessionId, params.topic, keyId);
      if (existingCaseId) {
        params = { ...params, caseId: existingCaseId };
      } else if (params.type === "error") {
        params = { ...params, caseId: crypto.randomUUID() };
      } else {
        const errorIds = await this.store.findErrorFragmentsBySessionTopic(sessionId, params.topic, keyId);
        if (errorIds.length > 0) {
          const newCaseId = crypto.randomUUID();
          params = { ...params, caseId: newCaseId };
          Promise.all(errorIds.map(id => this.store.updateCaseId(id, newCaseId, keyId)))
            .catch(err => logWarn(`[MemoryManager] auto-case-id backfill failed: ${err.message}`));
        }
      }
    }

    const fragment = this.factory.create({
      ...params,
      source         : source,
      contextSummary : params.contextSummary || null,
      sessionId,
      isAnchor       : params.isAnchor || false,
      affect         : params.affect   || undefined
    });
    fragment.agent_id  = agentId;    // 명시적으로 에이전트 ID 설정
    fragment.key_id    = keyId;      // API 키 격리: 해당 키 소유 파편으로 마킹
    fragment.workspace = workspace;  // 워크스페이스 격리

    /**
     * Phase 4 Soft Gating: PolicyRules 구조적 제약 검사 (advisory).
     * 위반 시 fragment.validation_warnings에 누적하고 warning 메트릭 증가.
     * store.insert는 계속 진행 (block 금지) — soft gate 기본 동작.
     * 기본값 SYMBOLIC_CONFIG.policyRules=false에서는 no-op.
     *
     * Hard gate: api_keys.symbolic_hard_gate=true인 키에서 violations 발생 시
     * SymbolicPolicyViolationError를 throw하여 store.insert를 차단한다.
     * 마스터 키(keyId=null)는 항상 soft gate만 적용된다.
     */
    const _policyActive = this._policyGatingEnabled !== null
      ? this._policyGatingEnabled
      : (SYMBOLIC_CONFIG.enabled && SYMBOLIC_CONFIG.policyRules);
    if (_policyActive) {
      try {
        const violations = this.policyRules.check(fragment);
        if (violations.length > 0) {
          /** Soft accumulation — 기존 동작 유지 */
          fragment.validation_warnings = Array.isArray(fragment.validation_warnings)
            ? [...fragment.validation_warnings, ...violations]
            : violations;
          for (const v of violations) {
            symbolicMetrics.recordWarning(`policy.${v.rule}`, v.severity || "low");
          }

          /** Hard gate — 키별 opt-in. master(keyId=null)는 제외 */
          if (keyId != null) {
            const hardGate = await this._getHardGate(keyId);
            if (hardGate) {
              symbolicMetrics.recordGateBlock("policy", violations[0]?.rule ?? "unknown");
              throw new SymbolicPolicyViolationError(violations, {
                fragmentType: fragment.type,
                keyId
              });
            }
          }
        }
      } catch (err) {
        /** SymbolicPolicyViolationError는 상위로 전파. 그 외는 swallow */
        if (err instanceof SymbolicPolicyViolationError) throw err;
        logWarn(`[MemoryManager] policy rules check failed: ${err.message}`);
      }
    }

    const id       = await this.store.insert(fragment);

    await this.index.index({ ...fragment, id }, params.sessionId, fragment.key_id ?? null);

    /** 후처리 파이프라인 (임베딩, 형태소, 링크, assertion, 시간링크, 평가큐) */
    await this.postProcessor.run({ ...fragment, id }, { agentId, keyId, groupKeyIds });

    /** 충돌 감지 (agentId, keyId 전달 — 동일 키 범위 내에서만 감지) */
    const conflicts = await this.conflictResolver.detectConflicts(fragment.content, fragment.topic, id, agentId, keyId);

    /** 자동 링크 생성 (유사 파편 기반) */
    await this.conflictResolver.autoLinkOnRemember({ ...fragment, id }, agentId).catch(err => {
      logWarn(`[MemoryManager] autoLinkOnRemember failed: ${err.message}`);
    });

    /** 명시적 대체 처리: supersedes에 지정된 파편을 만료시킨다 */
    if (params.supersedes && Array.isArray(params.supersedes)) {
      for (const oldId of params.supersedes) {
        if (oldId === id) continue;
        try {
          await this._supersede(oldId, id, agentId, keyId);
        } catch (err) {
          logWarn(`[MemoryManager] supersede ${oldId} failed: ${err.message}`);
        }
      }
    }

    /** 낮은 importance 경고 및 TTL 자동 하향 */
    const effectiveImportance = fragment.importance ?? 0.5;
    let lowImportanceWarning  = undefined;
    let effectiveTtlTier      = fragment.ttl_tier;

    if (effectiveImportance < 0.3) {
      lowImportanceWarning = "이 내용은 낮은 중요도로 저장됩니다. 장기 보존이 필요하면 importance를 명시하세요.";
      if (!params.ttl_tier) {
        effectiveTtlTier = "short";
        await this.store.updateTtlTier(id, "short", keyId).catch(err => {
          logWarn(`[MemoryManager] ttl_tier update failed: ${err.message}`);
        });
      }
    }

    const result = {
      id,
      keywords : fragment.keywords,
      ttl_tier : effectiveTtlTier,
      scope    : "permanent",
      conflicts
    };

    /** Phase 4 Soft Gating 결과 노출 (violations 있을 때만, rule 이름만 추출) */
    if (Array.isArray(fragment.validation_warnings) && fragment.validation_warnings.length > 0) {
      result.validation_warnings = fragment.validation_warnings.map(v =>
        typeof v === "object" && v !== null && v.rule ? String(v.rule) : String(v)
      );
    }

    if (lowImportanceWarning) {
      result.low_importance_warning = lowImportanceWarning;
    }

    /** case_events 자동 기록 (fire-and-forget — case_id 있는 파편만) */
    if (fragment.case_id && this.caseEventStore) {
      this._recordCaseEvent({ ...fragment, id }, keyId).catch(err =>
        logWarn(`[MemoryManager] case event recording failed: ${err.message}`)
      );
    }

    return result;
  }

  /** fragment type → case event type 매핑 */
  static FRAG_TO_EVENT = {
    error    : "error_observed",
    decision : "decision_committed",
    procedure: "fix_attempted"
  };

  /**
   * case_id가 있는 파편에 대해 case_events에 이벤트를 기록한다.
   * fragment_evidence(produced_by), preceded_by 엣지, resolved_by 엣지를 자동 생성한다.
   *
   * @param {Object}      fragment - id가 포함된 파편 객체
   * @param {number|null} keyId
   */
  async _recordCaseEvent(fragment, keyId) {
    const eventType = MemoryManager.FRAG_TO_EVENT[fragment.type];
    if (!eventType) return;

    const { event_id } = await this.caseEventStore.append({
      case_id           : fragment.case_id,
      session_id        : fragment.session_id ?? null,
      event_type        : eventType,
      summary           : (fragment.content || "").slice(0, 200),
      entity_keys       : fragment.keywords || [],
      source_fragment_id: fragment.id,
      key_id            : keyId
    });

    /** fragment_evidence: 이 파편이 이벤트의 근거 */
    await this.caseEventStore.addEvidence(fragment.id, event_id, "produced_by").catch(() => {});

    /** preceded_by: 동일 case_id의 직전 이벤트와 연결 */
    const prevEvents = await this.caseEventStore.getByCase(fragment.case_id, { limit: 2, keyId });
    const prevEvent  = prevEvents.find(e => e.event_id !== event_id);
    if (prevEvent) {
      await this.caseEventStore.addEdge(event_id, prevEvent.event_id, "preceded_by").catch(() => {});
    }

    /** resolved_by: procedure가 동일 case의 error를 해결 */
    if (eventType === "fix_attempted") {
      const errorEvents = await this.caseEventStore.getByCase(
        fragment.case_id,
        { eventType: "error_observed", keyId }
      );
      for (const errEvt of errorEvents) {
        await this.caseEventStore.addEdge(event_id, errEvt.event_id, "resolved_by").catch(() => {});
      }
    }
  }

  /**
   * batchRemember - 복수 파편 일괄 저장
   *
   * BatchRememberProcessor에 위임한다.
   *
   * @param {Object} params
   *   - fragments {Array<Object>} 파편 배열
   *   - agentId   {string}       에이전트 ID (선택)
   *   - _keyId    {string|null}  API 키 ID (선택)
   * @returns {{ results: Array<{id, success, error?}>, inserted: number, skipped: number }}
   */
  async batchRemember(params) {
    return this.batchRememberProcessor.process(params);
  }

  /**
   * 기존 파편을 새 파편으로 대체한다 (ConflictResolver.supersede 위임 래퍼).
   * tests/unit/supersedes-param.test.js 가 존재/위임 패턴을 명시적으로 검증하므로 유지.
   *
   * - superseded_by 링크 생성
   * - 구 파편의 valid_to 를 현재 시각으로 설정
   * - 구 파편의 importance 를 반감
   *
   * @param {string}      oldId   - 대체될 파편 ID
   * @param {string}      newId   - 대체하는 파편 ID
   * @param {string}      agentId
   * @param {string|null} keyId
   */
  async _supersede(oldId, newId, agentId = "default", keyId = null) {
    return this.conflictResolver.supersede(oldId, newId, agentId, keyId);
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
    const groupKeyIds   = params._groupKeyIds ?? (keyId ? [keyId] : null);
    const workspace     = params.workspace ?? params._defaultWorkspace ?? null;

    const anchorTime = params.anchorTime || Date.now();

    /** Spreading Activation: 대화 맥락 기반 선제적 파편 활성화 (fire-and-forget) */
    if (params.contextText && process.env.ENABLE_SPREADING_ACTIVATION === "true") {
      activateByContext(params.contextText, agentId, keyId, params.sessionId).catch(() => {});
    }

    const result = await this.search.search({
      keywords          : params.keywords || [],
      topic             : params.topic,
      type              : params.type,
      text              : params.text,
      tokenBudget       : params.tokenBudget || 1000,
      minImportance     : params.minImportance,
      includeSuperseded : params.includeSuperseded || false,
      timeRange         : params.timeRange || undefined,
      fragmentCount,                          // 하위 호환 유지
      anchorTime,                             // 시간-의미 복합 랭킹 기준
      agentId,                                // RLS 컨텍스트
      keyId: groupKeyIds,                     // API 키 격리 필터 (그룹 배열)
      workspace,                              // 워크스페이스 필터
      sessionId: params.sessionId || null,    // search_events.session_id 전파
      ...(params.isAnchor !== undefined ? { isAnchor: params.isAnchor } : {}),
      ...(params.caseId            ? { caseId: params.caseId } : {}),
      ...(params.resolutionStatus  ? { resolutionStatus: params.resolutionStatus } : {}),
      ...(params.phase             ? { phase: params.phase } : {}),
      // TODO: tool-registry 스키마에 affect 파라미터 노출 필요 (후속 작업)
      ...(params.affect            ? { affect: params.affect } : {})
    });

    /** 연결 파편 포함 (기본 true, 1-hop 제한, fragment_links 테이블 활용) */
    const shouldIncludeLinks = params.includeLinks !== false;
    if (shouldIncludeLinks && result.fragments.length > 0) {
      const existingIds = new Set(result.fragments.map(f => f.id));
      const fromIds     = result.fragments.map(f => f.id);

      const linkedFrags = await this.store.getLinkedFragments(
        fromIds,
        params.linkRelationType || null,
        agentId,
        groupKeyIds
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

    /** depth 필터: Planner/Executor 역할별 파편 유형 제한 (type 미지정 시에만 적용) */
    const DEPTH_TYPE_MAP = {
      "high-level": ["decision", "episode"],
      "tool-level": ["procedure", "error", "fact"],
    };
    if (params.depth && DEPTH_TYPE_MAP[params.depth] && !params.type) {
      const allowedTypes     = new Set(DEPTH_TYPE_MAP[params.depth]);
      result.fragments = result.fragments.filter(f => allowedTypes.has(f.type));
      result.count     = result.fragments.length;
    }

    /** Seen IDs 필터링: context()에서 이미 주입된 파편 제외 */
    const excludeSeen = params.excludeSeen !== false;
    if (excludeSeen && params.sessionId) {
      const seenIds = await this.index.getSeenIds(params.sessionId);
      if (seenIds.size > 0) {
        result.fragments = result.fragments.filter(f => !seenIds.has(f.id));
        result.count     = result.fragments.length;
      }
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

    /** CBR caseMode: 검색 결과 파편을 case 트리플로 변환하여 반환 */
    if (params.caseMode) {
      const caseRecall = new CaseRecall();
      const cases      = await caseRecall.buildCaseTriples(result.fragments, {
        keyId,
        maxCases: params.maxCases || 5
      });

      return {
        fragments      : result.fragments,
        count          : result.count,
        totalTokens    : result.totalTokens,
        searchPath     : result.searchPath,
        _searchEventId : result._searchEventId ?? null,
        caseMode       : true,
        cases,
        caseCount      : cases.length
      };
    }

    /** 공동 회상 파편 간 Hebbian 링크 강화 (비동기, 결과 무시) */
    if (params.sessionId && result.fragments && result.fragments.length >= 2) {
      const fragIds = result.fragments.map(f => f.id).filter(Boolean);
      new GraphLinker()
        .buildCoRetrievalLinks(fragIds, params.sessionId, agentId)
        .catch((err) => { logWarn(`[MemoryManager] co-retrieval link creation failed: ${err.message}`); });
    }

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
    const agentId      = params.agentId || "default";
    const keyId        = params._keyId ?? null;
    const groupKeyIds  = params._groupKeyIds ?? (keyId ? [keyId] : null);
    let deleted    = 0;
    let protected_ = 0;

    if (params.id) {
      const frag = await this.store.getById(params.id, agentId, keyId, groupKeyIds);
      if (!frag) return { deleted: 0, protected: 0, error: "Fragment not found or no permission" };

      if (frag.ttl_tier === "permanent" && !params.force) {
        return { deleted: 0, protected: 1, reason: "permanent 파편은 force 옵션 필요" };
      }

      await this.index.deindex(frag.id, frag.keywords, frag.topic, frag.type, frag.key_id ?? null);
      const ok = await this.store.delete(frag.id, agentId, keyId);
      deleted  = ok ? 1 : 0;
    }

    if (params.topic) {
      const topicFrags = await this.store.searchByTopic(params.topic, {
        agentId,
        keyId: groupKeyIds ?? (keyId ? [keyId] : undefined),
        includeSuperseded: true,
        limit: 200,
      });

      const toDelete = [];
      for (const frag of topicFrags) {
        /** API 키 소유권 검사 (그룹 인식) */
        if (keyId && frag.key_id !== keyId && (!groupKeyIds || !groupKeyIds.includes(frag.key_id))) {
          protected_++;
          continue;
        }

        if (frag.ttl_tier === "permanent" && !params.force) {
          protected_++;
          continue;
        }

        toDelete.push(frag);
      }

      if (toDelete.length > 0) {
        /** Redis deindex 병렬 처리 */
        await Promise.all(
          toDelete.map(frag =>
            this.index.deindex(frag.id, frag.keywords, frag.topic, frag.type, frag.key_id ?? null)
              .catch(err => logWarn(`[MemoryManager] deindex failed: ${err.message}`))
          )
        );

        /** 단일 DELETE ... WHERE id = ANY($1) */
        const deleteCount = await this.store.deleteMany(
          toDelete.map(f => f.id),
          agentId,
          keyId
        );
        deleted += deleteCount;
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
    const agentId  = params.agentId || "default";
    const keyId       = params._keyId ?? null;
    const groupKeyIds = params._groupKeyIds ?? (keyId ? [keyId] : []);
    const fromFrag    = await this.store.getById(params.fromId, agentId, keyId, groupKeyIds);
    const toFrag      = await this.store.getById(params.toId,   agentId, keyId, groupKeyIds);

    if (!fromFrag || !toFrag) {
      return { linked: false, error: "One or both fragments not found or no permission" };
    }

    const relationType = params.relationType || "related";
    await this.store.createLink(params.fromId, params.toId, relationType, agentId, params.weight ?? 1);

    /**
     * resolved_by 링크: 대상(toId)이 error 파편이면
     * importance를 0.5로 하향하여 warm 계층으로 전환.
     * 해결된 에러는 참조 가치가 감소하되 즉시 삭제는 방지.
     */
    if (relationType === "resolved_by" && toFrag.type === "error" && toFrag.importance > 0.5) {
      await this.store.update(params.toId, {
        importance: 0.5
      }, agentId, keyId);
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

    const agentId     = params.agentId || "default";
    const keyId       = params._keyId ?? null;
    const groupKeyIds = params._groupKeyIds ?? params.groupKeyIds ?? [];
    const existing    = await this.store.getById(params.id, agentId, keyId, groupKeyIds);
    if (!existing) {
      return { updated: false, error: "Fragment not found or no permission" };
    }

    const updates = {};
    if (params.content !== undefined) {
      updates.content = params.content;
    }
    if (params.topic !== undefined)           updates.topic            = params.topic;
    if (params.keywords !== undefined && Array.isArray(params.keywords)) {
      updates.keywords = params.keywords.map(k => k.toLowerCase());
    }
    if (params.type !== undefined)            updates.type             = params.type;
    if (params.importance !== undefined)      updates.importance       = params.importance;
    if (params.isAnchor !== undefined)        updates.is_anchor        = params.isAnchor;
    if (params.assertionStatus !== undefined) updates.assertion_status = params.assertionStatus;

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
    await this.index.deindex(existing.id, existing.keywords, existing.topic, existing.type, existing.key_id ?? null);
    await this.index.index(result, null, existing.key_id ?? null);

    /** assertion_status 변경 시 case_events 기록 (fire-and-forget) */
    if (
      params.assertionStatus &&
      existing.assertion_status !== params.assertionStatus &&
      existing.case_id &&
      this.caseEventStore
    ) {
      const amendEventType = params.assertionStatus === "verified" ? "verification_passed"
                           : params.assertionStatus === "rejected" ? "verification_failed"
                           : null;
      if (amendEventType) {
        this.caseEventStore.append({
          case_id           : existing.case_id,
          session_id        : existing.session_id ?? null,
          event_type        : amendEventType,
          summary           : (existing.content || "").slice(0, 200),
          source_fragment_id: existing.id,
          entity_keys       : existing.keywords || [],
          key_id            : keyId
        }).then(({ event_id }) =>
          this.caseEventStore.addEvidence(existing.id, event_id, "produced_by").catch(() => {})
        ).catch(err => logWarn(`[MemoryManager] amend event recording failed: ${err.message}`));
      }
    }

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
    return this.reflectProcessor.process(params);
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
    return this.contextBuilder.build(params);
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
    const keyId       = params._keyId ?? null;

    const result = await pool.query(
      `INSERT INTO agent_memory.tool_feedback
             (tool_name, relevant, sufficient, suggestion, context, session_id, trigger_type, search_event_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        params.tool_name,
        params.relevant,
        params.sufficient,
        suggestion,
        context,
        params.session_id || null,
        triggerType,
        params.search_event_id ?? null
      ]
    );

    const fragmentIds = params.fragment_ids;
    if (fragmentIds && fragmentIds.length > 0) {
      try {
        const delta = params.relevant ? 0.1 : -0.15;
        /**
         * keyId 소유권 검사: API 키 사용자는 자신의 파편(key_id = $N)만 EMA 업데이트 가능.
         * 마스터 키(keyId = null)는 조건 없이 전체 접근.
         * 타 키 소유 파편에 대한 EMA 조작을 방지한다.
         */
        let   keyFilter = "";
        const emaParams = [delta, fragmentIds];
        if (keyId != null) {
          emaParams.push(keyId);
          keyFilter = `AND key_id = $${emaParams.length}`;
        }
        await pool.query(
          `UPDATE agent_memory.fragments
           SET ema_activation = LEAST(1.0, GREATEST(0, COALESCE(ema_activation, 0.5) + $1)),
               ema_last_updated = NOW()
           WHERE id = ANY($2) ${keyFilter}`,
          emaParams
        );
      } catch (err) {
        logWarn(`[toolFeedback] ema adjustment failed: ${err.message}`);
      }
    }

    return {
      id         : result.rows[0].id,
      tool_name  : params.tool_name,
      relevant   : params.relevant,
      sufficient : params.sufficient
    };
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
    return this.sessionLinker.consolidateSessionFragments(sessionId, agentId, keyId);
  }

  async _autoLinkSessionFragments(fragments, agentId = "default", keyId = null) {
    return this.sessionLinker.autoLinkSessionFragments(fragments, agentId, keyId);
  }

  async _wouldCreateCycle(fromId, toId, agentId = "default", keyId = null) {
    return this.sessionLinker.wouldCreateCycle(fromId, toId, agentId, keyId);
  }

  /**
     * fragment_history - 파편 변경 이력 조회
     *
     * @param {Object} params
     *   - id {string} 파편 ID (필수)
     * @returns {Object} { current, versions, superseded_by_chain }
     */
  async fragmentHistory(params) {
    if (!params.id) {
      return { error: "id is required" };
    }
    const agentId     = params.agentId || "default";
    const keyId       = params._keyId ?? null;
    const groupKeyIds = params._groupKeyIds ?? (keyId ? [keyId] : []);

    /** getHistory 내부 getById에 keyId 전달 — SQL 레벨 필터로 권한 없으면 current=null */
    const result = await this.store.getHistory(params.id, agentId, keyId, groupKeyIds);
    if (!result.current) return { error: "Fragment not found or no permission" };

    return result;
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

    const agentId     = params.agentId || "default";
    const keyId       = params._keyId ?? null;
    const groupKeyIds = params._groupKeyIds ?? (keyId ? [keyId] : []);

    /** 시작 파편 소유권 확인 — SQL 레벨 필터로 권한 없으면 null 반환 */
    const startFrag = await this.store.getById(params.startId, agentId, keyId, groupKeyIds);
    if (!startFrag) {
      return { error: "Fragment not found or no permission" };
    }

    const nodes = await this.store.getRCAChain(params.startId, agentId, groupKeyIds);

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

  /**
   * reconstructHistory - case_id 또는 entity 기반 서사 재구성
   *
   * @param {Object}      params
   * @param {string}      [params.caseId]     - 케이스 식별자
   * @param {string}      [params.entity]     - topic/keywords 기반 필터
   * @param {Object}      [params.timeRange]  - { from: ISO8601, to: ISO8601 }
   * @param {string}      [params.query]      - 추가 content 키워드
   * @param {number}      [params.limit]      - 최대 반환 건수 (기본 100, 최대 500)
   * @param {number|null} [params.keyId]      - API 키 격리
   * @param {string|null} [params.workspace]  - 워크스페이스 격리
   * @returns {Promise<Object>} { ordered_timeline, causal_chains, unresolved_branches, supporting_fragments, summary }
   */
  async reconstructHistory(params) {
    const reconstructor = new HistoryReconstructor(this.store, this.store.links, this.caseEventStore);
    return reconstructor.reconstruct({
      caseId   : params.caseId    ?? null,
      entity   : params.entity    ?? null,
      timeRange: params.timeRange ?? null,
      query    : params.query     ?? null,
      limit    : params.limit     ?? 100,
      keyId    : params.keyId     ?? params._keyId ?? null,
      workspace: params.workspace ?? params._defaultWorkspace ?? null
    });
  }
}
