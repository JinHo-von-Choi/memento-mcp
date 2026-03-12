# Integration 테스트 DB 의존성 감사

작성자: 최진호
작성일: 2026-03-12

## temporal.test.js → e2e (DB 직접 쿼리)

| 테스트 케이스 | DB 사용 패턴 | 분류 |
|---|---|---|
| 2026-01-15 시점에는 v1만 반환 | `pg.Pool` 직접 쿼리, INSERT 픽스처 삽입 | e2e |
| 2026-02-15 시점에는 v2만 반환 | `pg.Pool` 직접 쿼리 | e2e |
| 현재 시점: valid_to IS NULL만 반환 | `pg.Pool` 직접 쿼리 | e2e |
| searchAsOf: v1 시점 조회 결과에 v1 포함, v2 미포함 | `pg.Pool` 직접 쿼리 | e2e |
| valid_from = valid_to 경계값: 정확히 만료된 시점은 반환하지 않음 | `pg.Pool` 직접 쿼리 | e2e |

근거: 파일 상단에서 `new pg.Pool({ connectionString: process.env.DATABASE_URL })` 로 연결 생성. `before()`에서 픽스처 INSERT, `after()`에서 DELETE + `pool.end()`. 모든 테스트 케이스가 실제 DB 쿼리에 의존함.

## pipeline-overhaul.test.js → integration 유지 (DB 불필요)

| 테스트 케이스 | DB 사용 패턴 | 분류 |
|---|---|---|
| EmbeddingWorker is EventEmitter with expected interface | prototype 인터페이스 검사만 | contract |
| GraphLinker exposes linkFragment and retroLink | prototype 인터페이스 검사만 | contract |
| _computeRankScore accepts anchorTime parameter | `Object.create(FragmentSearch.prototype)` + 순수 함수 호출 | contract |
| past anchorTime ranks nearby fragments higher | 순수 함수 호출 | contract |
| importance weight dominates when recency is equal | 순수 함수 호출 | contract |
| MEMORY_CONFIG has contextInjection settings | config import만 | contract |
| MEMORY_CONFIG has gc settings with correct defaults | config import만 | contract |
| MEMORY_CONFIG has pagination settings | config import만 | contract |
| cursor encoding/decoding roundtrip | 순수 Buffer 연산 | contract |
| ranking weights sum to 1.0 | config import만 | contract |
| RRF search config has k and l1WeightFactor | config import만 | contract |
| MEMORY_CONFIG has embeddingWorker settings | config import만 | contract |
| backfill-embeddings.js exists and is importable | `fs/promises.stat` 파일 존재 확인만 | contract |

근거: `pg`, `DATABASE_URL`, `INSERT`, `SELECT`, `pg.Pool`, `connect` 패턴이 전혀 없음. DB 모듈을 dynamic import하더라도 `Object.create(Prototype)` 패턴으로 실제 DB 연결 없이 순수 함수만 호출. tests/integration/ 유지.

## 결론

- `tests/integration/temporal.test.js` → `tests/e2e/temporal.test.js` 이동
- `tests/integration/pipeline-overhaul.test.js` → `tests/integration/` 유지
