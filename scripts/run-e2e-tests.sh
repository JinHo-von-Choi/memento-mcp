#!/usr/bin/env bash
set -euo pipefail

echo "[e2e] PostgreSQL 컨테이너 기동..."
docker compose -f docker-compose.test.yml up -d postgres-test

echo "[e2e] 헬스체크 대기..."
docker compose -f docker-compose.test.yml exec postgres-test \
  pg_isready -U memento -d memento_test

echo "[e2e] 마이그레이션 실행..."
for f in lib/memory/migration-*.sql; do
  psql postgresql://memento:memento_test@localhost:35433/memento_test -f "$f"
done

echo "[e2e] 테스트 실행..."
node --env-file=.env.test --test tests/e2e/*.test.js

echo "[e2e] 컨테이너 정리..."
docker compose -f docker-compose.test.yml down
