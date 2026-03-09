-- migration-008: 형태소 임베딩 사전 테이블
--
-- morpheme: 형태소 원형 (기본형)
-- embedding: 임베딩 벡터 (fragments.embedding과 동일 차원)
-- created_at: 등록 시각

CREATE TABLE IF NOT EXISTS agent_memory.morpheme_dict (
  morpheme   TEXT                     PRIMARY KEY,
  embedding  nerdvana.vector(1536),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 벡터 유사도 인덱스 (IVFFlat, 사전 규모에 따라 조정)
CREATE INDEX IF NOT EXISTS idx_morpheme_dict_embedding
  ON agent_memory.morpheme_dict
  USING ivfflat (embedding nerdvana.vector_cosine_ops)
  WITH (lists = 50);
