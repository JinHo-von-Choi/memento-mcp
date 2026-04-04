-- migration-028-composite-indexes.sql
-- topic fallback 검색 + API 키 격리 조회 복합 인덱스
-- 작성자: 최진호
-- 작성일: 2026-04-05

-- ─────────────────────────────────────────────
-- 1. (agent_id, topic, created_at DESC) 복합 인덱스
--    migration-016의 idx_frag_agent_topic(agent_id, topic)을 완전 포함하므로
--    기존 인덱스를 DROP하고 created_at DESC를 포함한 인덱스로 교체한다.
--    FragmentReader.searchByTopic() 쿼리에서 topic + agent_id 필터 +
--    created_at DESC 정렬을 커버한다.
-- ─────────────────────────────────────────────

DROP INDEX IF EXISTS agent_memory.idx_frag_agent_topic;

CREATE INDEX IF NOT EXISTS idx_frag_agent_topic_created
  ON agent_memory.fragments (agent_id, topic, created_at DESC);

-- ─────────────────────────────────────────────
-- 2. (key_id, agent_id, importance DESC) 부분 인덱스
--    valid_to IS NULL 조건의 활성 파편만 대상.
--    QuotaChecker COUNT(key_id + valid_to IS NULL) 쿼리와
--    API 키 격리 + importance 정렬 조회를 커버한다.
-- ─────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_frag_keyid_agent_importance
  ON agent_memory.fragments (key_id, agent_id, importance DESC)
  WHERE valid_to IS NULL;
