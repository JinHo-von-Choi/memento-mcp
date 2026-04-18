/*
 * migration-035-affect.sql
 *
 * 작성자: 최진호
 * 작성일: 2026-04-18
 *
 * fragments 테이블에 affect(정서 태그) 컬럼 추가.
 * 허용값: neutral | frustration | confidence | surprise | doubt | satisfaction
 * 기본값: 'neutral'
 *
 * 인덱스: neutral 제외(대다수) → partial index로 노이즈 없이 유의미한 정서만 색인.
 */

ALTER TABLE agent_memory.fragments
  ADD COLUMN IF NOT EXISTS affect TEXT
    CHECK (affect IN ('neutral', 'frustration', 'confidence', 'surprise', 'doubt', 'satisfaction'))
    DEFAULT 'neutral';

CREATE INDEX IF NOT EXISTS idx_frag_affect
  ON agent_memory.fragments(affect)
  WHERE affect IS NOT NULL AND affect != 'neutral';

COMMENT ON COLUMN agent_memory.fragments.affect IS
  '정서 태그. neutral/frustration/confidence/surprise/doubt/satisfaction 중 하나. 기본값 neutral.';
