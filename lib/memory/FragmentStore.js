/**
 * FragmentStore - 파편 저장소 파사드 (읽기/쓰기 분리)
 *
 * 작성자: 최진호
 * 작성일: 2026-02-23
 * 수정일: 2026-03-03 (Temporal Schema - valid_from/valid_to, searchAsOf 추가)
 * 수정일: 2026-03-03 (API 키 격리 - key_id 컬럼, 조회 필터 추가)
 * 수정일: 2026-03-15 (읽기/쓰기 분리 — FragmentReader / FragmentWriter 위임)
 */

import { FragmentReader } from "./FragmentReader.js";
import { FragmentWriter } from "./FragmentWriter.js";
import { LinkStore }      from "./LinkStore.js";
import { FragmentGC }     from "./FragmentGC.js";

export class FragmentStore {
  constructor() {
    this.reader = new FragmentReader();
    this.writer = new FragmentWriter();
    this.links  = new LinkStore();
    this.gc     = new FragmentGC();
  }

  // ── Read delegations ────────────────────────────────────────────────────────

  getById(id, agentId)                                                { return this.reader.getById(id, agentId); }
  getByIds(ids, agentId, keyId)                                       { return this.reader.getByIds(ids, agentId, keyId); }
  getHistory(fragmentId, agentId)                                     { return this.reader.getHistory(fragmentId, agentId); }
  searchByKeywords(keywords, options)                                  { return this.reader.searchByKeywords(keywords, options); }
  searchByTopic(topic, options)                                        { return this.reader.searchByTopic(topic, options); }
  searchBySemantic(queryEmbedding, limit, minSimilarity, agentId, keyId, includeSuperseded) {
    return this.reader.searchBySemantic(queryEmbedding, limit, minSimilarity, agentId, keyId, includeSuperseded);
  }
  searchAsOf(asOf, agentId, opts, keyId)                               { return this.reader.searchAsOf(asOf, agentId, opts, keyId); }

  // ── Write delegations ───────────────────────────────────────────────────────

  ensureSchema()                                                       { return this.writer.ensureSchema(); }
  insert(fragment)                                                     { return this.writer.insert(fragment); }
  update(id, updates, agentId, keyId, existing)                       { return this.writer.update(id, updates, agentId, keyId, existing); }
  delete(id, agentId, keyId)                                          { return this.writer.delete(id, agentId, keyId); }
  deleteByAgent(agentId)                                              { return this.writer.deleteByAgent(agentId); }
  incrementAccess(ids, agentId, opts)                                 { return this.writer.incrementAccess(ids, agentId, opts); }
  touchLinked(retrievedIds, agentId)                                  { return this.writer.touchLinked(retrievedIds, agentId); }
  archiveVersion(fragment, agentId)                                   { return this.writer.archiveVersion(fragment, agentId); }
  deleteExpired()                                                      { return this.writer.deleteExpired(); }

  // ── GC delegations ──────────────────────────────────────────────────────────

  decayImportance()                                                    { return this.gc.decayImportance(); }
  transitionTTL()                                                      { return this.gc.transitionTTL(); }
  decayEmaActivation()                                                 { return this.gc.decayEmaActivation(); }

  // ── Link delegations ────────────────────────────────────────────────────────

  createLink(fromId, toId, relationType, agentId)                     { return this.links.createLink(fromId, toId, relationType, agentId); }
  getLinkedFragments(fromIds, relationType, agentId, keyId)           { return this.links.getLinkedFragments(fromIds, relationType, agentId, keyId); }
  getLinkedIds(fragmentId, agentId)                                   { return this.links.getLinkedIds(fragmentId, agentId); }
  isReachable(startId, targetId, agentId)                             { return this.links.isReachable(startId, targetId, agentId); }
  getRCAChain(startId, agentId)                                       { return this.links.getRCAChain(startId, agentId); }
}
