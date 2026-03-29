# Contributing to Memento MCP

## Development Setup

1. Clone the repository
2. `cp .env.example .env` and configure
3. Start PostgreSQL with pgvector: `docker-compose -f docker-compose.test.yml up -d`
4. `npm install`
5. `npm run migrate`
6. `npm test`

### Full Development Stack

For a complete local environment with PostgreSQL + Redis:

```bash
docker-compose -f docker-compose.dev.yml up -d
cp .env.example .env  # Edit DB credentials to match dev compose
npm install
npm run migrate
node server.js
```

### Docker Build

```bash
docker build -t memento-mcp .
```

## Code Style

- ESM imports only (no require)
- All SQL queries use parameterized binding ($1, $2)
- Error logging via Winston (logInfo, logWarn, logError from lib/logger.js)
- Variables: const by default, let when mutation needed

## Testing

- Unit tests: `tests/unit/` (node:test runner)
- E2E tests: `tests/e2e/` (requires PostgreSQL)
- Jest tests: `tests/*.test.js` (root level)
- Run all: `npm test`

## Pull Request Checklist

- [ ] `npm test` passes (0 failures)
- [ ] `npx eslint . --max-warnings 0` passes
- [ ] New migration file if DB schema changed
- [ ] CHANGELOG.md updated
- [ ] SKILL.md updated if tool parameters changed

## Commit Messages

Format: `type: description`
Types: feat, fix, docs, chore, refactor, test
