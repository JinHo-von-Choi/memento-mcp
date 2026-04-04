# Test Strategy

## Framework Assignment

| Directory | Runner | Purpose |
|-----------|--------|---------|
| `tests/unit/` | `node --test` | 단위 테스트 — mock/stub 기반, DB 불필요 |
| `tests/integration/` | `node --test` | 통합 테스트 — 실제 DB/Redis 연결 필요 |
| `tests/e2e/` | `node --test` | E2E — 서버 프로세스 기동 후 HTTP 요청 |
| `tests/*.test.js` (루트) | Jest | 레거시 — 점진적으로 `tests/unit/`으로 마이그레이션 |

## Commands

| Command | Scope |
|---------|-------|
| `npm test` | unit 전체 (Jest + Node test runner) |
| `npm run test:jest` | Jest 루트 테스트만 |
| `npm run test:unit:node` | Node test runner unit 테스트만 |
| `npm run test:integration` | 통합 + e2e (DB/Redis 필요) |
| `npm run test:e2e` | e2e만 |
| `node --test tests/unit/<file>.test.js` | 단일 파일 실행 |

## Conventions

- 파일명: `<module-name>.test.js`
- 새 테스트는 반드시 `tests/unit/`에 Node test runner로 작성
- Jest 루트 테스트(`tests/*.test.js`)는 신규 추가 금지, 기존 것만 유지
- 장기적으로 Jest -> Node test runner 단일화 마이그레이션 예정
- Given-When-Then 또는 Arrange-Act-Assert 패턴 사용
- describe 블록으로 모듈/기능 단위 그룹화
- mock은 `node:test`의 `mock.fn()` 사용 (Jest의 `jest.fn()` 아님)

## Migration Guide (Jest -> Node test runner)

루트 Jest 테스트를 마이그레이션할 때:

1. `tests/unit/`로 파일 이동
2. `jest` import를 `node:test`로 교체:
   - `describe, it, expect` -> `describe, it` from `node:test` + `assert` from `node:assert/strict`
   - `jest.fn()` -> `mock.fn()`
   - `expect(x).toBe(y)` -> `assert.strictEqual(x, y)`
   - `expect(x).toEqual(y)` -> `assert.deepStrictEqual(x, y)`
   - `expect(fn).toThrow()` -> `assert.throws(fn)`
3. 원본 Jest 파일 삭제
4. `npm test` 전체 통과 확인
