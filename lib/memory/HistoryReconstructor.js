/**
 * HistoryReconstructor - case/entity 기반 서사 재구성
 *
 * 작성자: 최진호
 * 작성일: 2026-04-03
 *
 * case_id 또는 entity(topic/keywords) 기반 fragments를 시간순으로 조회하고
 * fragment_links 기반 인과 체인을 구성하여 서사를 복원한다.
 */

import { getPrimaryPool } from "../tools/db.js";

const SCHEMA = "agent_memory";

export class HistoryReconstructor {
  /**
   * @param {import("./FragmentStore.js").FragmentStore} store
   * @param {import("./LinkStore.js").LinkStore}         linkStore
   */
  constructor(store, linkStore) {
    this.store     = store;
    this.linkStore = linkStore;
  }

  /**
   * case_id 또는 entity 기반 fragments를 시간순으로 조회하고
   * fragment_links 기반 인과 체인을 구성한다.
   *
   * @param {Object}      params
   * @param {string}      [params.caseId]     - 재구성할 케이스 식별자
   * @param {string}      [params.entity]     - topic/keywords ILIKE 필터 (caseId 없을 때 사용)
   * @param {Object}      [params.timeRange]  - { from: ISO8601, to: ISO8601 }
   * @param {string}      [params.query]      - 추가 content 키워드 필터
   * @param {number}      [params.limit=100]  - 최대 반환 건수
   * @param {number|null} [params.keyId]      - API 키 격리 필터
   * @param {string|null} [params.workspace]  - 워크스페이스 격리 필터
   * @returns {Promise<{
   *   ordered_timeline:      Object[],
   *   causal_chains:         Object[],
   *   unresolved_branches:   Object[],
   *   supporting_fragments:  Object[],
   *   summary:               string
   * }>}
   */
  async reconstruct(params) {
    const caseId    = params.caseId    ?? null;
    const entity    = params.entity    ?? null;
    const timeRange = params.timeRange ?? null;
    const query     = params.query     ?? null;
    const limit     = Math.min(params.limit ?? 100, 500);
    const keyId     = params.keyId     ?? null;
    const workspace = params.workspace ?? null;

    if (!caseId && !entity) {
      throw new Error("caseId 또는 entity 중 하나는 필수입니다.");
    }

    const timeline = await this._fetchTimelineParameterized({ caseId, entity, timeRange, query, limit, keyId, workspace });

    if (timeline.length === 0) {
      return {
        ordered_timeline    : [],
        causal_chains       : [],
        unresolved_branches : [],
        supporting_fragments: [],
        summary             : "조회된 파편이 없습니다."
      };
    }

    const fragmentIds = timeline.map(f => f.id);
    const links       = await this._fetchLinks(fragmentIds);

    const causal_chains       = this._buildCausalChains(timeline, links);
    const unresolved_branches = this._detectUnresolvedBranches(timeline, causal_chains);

    /** 인과 체인에 포함되지 않은 파편을 supporting_fragments로 분류 */
    const chainedIds = new Set(
      causal_chains.flatMap(c => c.chain.map(n => n.id))
    );
    const supporting_fragments = timeline.filter(f => !chainedIds.has(f.id));

    const summary = this._buildSummary(timeline, causal_chains, unresolved_branches);

    return {
      ordered_timeline    : timeline,
      causal_chains,
      unresolved_branches,
      supporting_fragments,
      summary
    };
  }

  /**
   * 파라미터 인덱스를 명시적으로 관리하는 타임라인 쿼리 (caseId 또는 entity 기반)
   *
   * @private
   */
  async _fetchTimelineParameterized({ caseId, entity, timeRange, query, limit, keyId, workspace }) {
    const pool   = getPrimaryPool();
    const params = [];

    /** $1: caseId 또는 entity */
    let scopeClause;
    if (caseId) {
      params.push(caseId);                        // $1
      scopeClause = `f.case_id = $1`;
    } else {
      params.push(`%${entity}%`);                 // $1
      params.push(entity.toLowerCase());          // $2
      scopeClause = `(f.topic ILIKE $1 OR f.keywords @> ARRAY[$2]::text[])`;
    }

    const nextIdx = () => params.length + 1;

    /** 시간 범위 파라미터 */
    params.push(timeRange?.from ?? null);         // $n
    const fromIdx = params.length;
    params.push(timeRange?.to ?? null);           // $n+1
    const toIdx = params.length;

    /** content 키워드 */
    let queryClause = "";
    if (query) {
      params.push(`%${query}%`);
      queryClause = `AND f.content ILIKE $${params.length}`;
    }

    /** key_id 격리 */
    params.push(keyId);
    const keyIdx = params.length;
    const keyClause = `AND (f.key_id IS NULL OR f.key_id = $${keyIdx})`;

    /** workspace 격리 */
    let wsClause = "";
    if (workspace) {
      params.push(workspace);
      wsClause = `AND (f.workspace = $${params.length} OR f.workspace IS NULL)`;
    }

    /** limit */
    params.push(limit);
    const limitIdx = params.length;

    const sql = `
      SELECT f.id, f.content, f.topic, f.type, f.importance, f.keywords,
             f.case_id, f.session_id, f.resolution_status, f.goal, f.outcome,
             f.phase, f.assertion_status, f.workspace, f.created_at
        FROM ${SCHEMA}.fragments f
       WHERE ${scopeClause}
         AND ($${fromIdx}::timestamptz IS NULL OR f.created_at >= $${fromIdx})
         AND ($${toIdx}::timestamptz   IS NULL OR f.created_at <= $${toIdx})
         ${queryClause}
         ${keyClause}
         ${wsClause}
         AND f.valid_to IS NULL
       ORDER BY f.created_at ASC
       LIMIT $${limitIdx}`;

    const { rows } = await pool.query(sql, params);
    return rows;
  }

  /**
   * fragment_links를 조회하여 인과 체인 구성용 링크 데이터를 반환한다.
   *
   * @private
   * @param {string[]} fragmentIds
   * @returns {Promise<Object[]>}
   */
  async _fetchLinks(fragmentIds) {
    if (!fragmentIds || fragmentIds.length === 0) return [];

    const pool         = getPrimaryPool();
    const { rows }     = await pool.query(
      `SELECT fl.from_id, fl.to_id, fl.relation_type, fl.weight
         FROM ${SCHEMA}.fragment_links fl
        WHERE fl.from_id = ANY($1)
           OR fl.to_id   = ANY($1)`,
      [fragmentIds]
    );
    return rows;
  }

  /**
   * fragment_links BFS로 caused_by / resolved_by 인과 체인을 구성한다.
   *
   * @private
   * @param {Object[]} fragments
   * @param {Object[]} links
   * @returns {Object[]} causal_chains 배열
   */
  _buildCausalChains(fragments, links) {
    const CAUSAL_TYPES  = new Set(["caused_by", "resolved_by"]);
    const fragMap       = new Map(fragments.map(f => [f.id, f]));

    /** 인과 관계 링크만 추출 */
    const causalLinks   = links.filter(l => CAUSAL_TYPES.has(l.relation_type));
    if (causalLinks.length === 0) return [];

    /** 역방향 인덱스: id → outgoing causal links */
    const outgoing = new Map();
    for (const link of causalLinks) {
      if (!outgoing.has(link.from_id)) outgoing.set(link.from_id, []);
      outgoing.get(link.from_id).push(link);
    }

    /** 체인 시작점: causal link의 from_id 중 다른 링크의 to_id가 아닌 것 */
    const toIds    = new Set(causalLinks.map(l => l.to_id));
    const fromIds  = [...new Set(causalLinks.map(l => l.from_id))];
    const roots    = fromIds.filter(id => !toIds.has(id));

    const chains = [];

    for (const rootId of roots) {
      const chain    = [];
      const visited  = new Set();
      const queue    = [rootId];

      /** BFS 순회 */
      while (queue.length > 0) {
        const current = queue.shift();
        if (visited.has(current)) continue;
        visited.add(current);

        const frag = fragMap.get(current);
        if (frag) chain.push({ ...frag, _chain_position: chain.length });

        const next = outgoing.get(current) || [];
        for (const link of next) {
          if (!visited.has(link.to_id)) {
            queue.push(link.to_id);
          }
        }
      }

      if (chain.length > 0) {
        const hasResolution = chain.some(f => f.resolution_status === "resolved");
        chains.push({
          root_id    : rootId,
          chain,
          length     : chain.length,
          is_resolved: hasResolution
        });
      }
    }

    return chains;
  }

  /**
   * resolution_status='open'인 episode 파편을 미해결 브랜치로 수집한다.
   *
   * @private
   * @param {Object[]} fragments
   * @param {Object[]} chains
   * @returns {Object[]} unresolved_branches 배열
   */
  _detectUnresolvedBranches(fragments, chains) {
    const resolvedChainIds = new Set(
      chains.filter(c => c.is_resolved).flatMap(c => c.chain.map(n => n.id))
    );

    return fragments.filter(f =>
      f.resolution_status === "open" && !resolvedChainIds.has(f.id)
    );
  }

  /**
   * 타임라인·체인·미해결 브랜치를 기반으로 요약 문자열을 생성한다.
   *
   * @private
   * @param {Object[]} timeline
   * @param {Object[]} chains
   * @param {Object[]} branches
   * @returns {string}
   */
  _buildSummary(timeline, chains, branches) {
    const total      = timeline.length;
    const first      = timeline[0]?.created_at;
    const last       = timeline[timeline.length - 1]?.created_at;
    const resolved   = chains.filter(c => c.is_resolved).length;
    const unresolved = branches.length;

    const lines = [
      `총 ${total}개 파편 (${first ? first.toISOString?.() ?? first : "-"} ~ ${last ? last.toISOString?.() ?? last : "-"})`,
      `인과 체인: ${chains.length}개 (해결됨: ${resolved}, 미해결: ${chains.length - resolved})`,
      `미해결 브랜치: ${unresolved}개`
    ];

    if (branches.length > 0) {
      lines.push(
        "미해결 항목: " +
        branches.slice(0, 3).map(b => b.content?.slice(0, 60)).join(" | ")
      );
    }

    return lines.join("\n");
  }
}
