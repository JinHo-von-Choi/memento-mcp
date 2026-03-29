# CLI

```bash
node bin/memento.js <command> [options]
# 또는
npm run cli -- <command> [options]
```

| 커맨드 | 설명 |
|--------|------|
| `serve` | 서버 시작 |
| `migrate` | DB 마이그레이션 실행 |
| `cleanup [--execute]` | 노이즈 파편 정리 (기본 dry-run) |
| `backfill` | 임베딩 백필 |
| `stats` | 파편/앵커/토픽 통계 |
| `health` | DB/Redis/임베딩 연결 진단 |
| `recall <query> [--topic x] [--limit n] [--time-range from,to]` | 터미널 recall |
| `remember <content> --topic x --type fact` | 터미널 remember |
| `inspect <id>` | 파편 상세 + 1-hop 링크 |

모든 커맨드는 `--json` 플래그로 JSON 출력 지원.
