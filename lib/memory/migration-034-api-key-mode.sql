/*
 * migration-034-api-key-mode.sql
 *
 * 작성자: 최진호
 * 작성일: 2026-04-18
 *
 * api_keys 테이블에 default_mode 컬럼을 추가한다.
 * 값은 ModeRegistry에 등록된 preset 이름 (recall-only, write-only, onboarding, audit 등).
 * NULL 이면 mode preset 없이 전체 도구 노출 (기존 동작 유지).
 */

SET search_path TO agent_memory;

ALTER TABLE agent_memory.api_keys
  ADD COLUMN IF NOT EXISTS default_mode TEXT;

CREATE INDEX IF NOT EXISTS idx_api_keys_default_mode
  ON agent_memory.api_keys(default_mode)
  WHERE default_mode IS NOT NULL;
