# CLI

```bash
node bin/memento.js <command> [options]
# or
npm run cli -- <command> [options]
```

| Command | Description |
|---------|-------------|
| `serve` | Start the server |
| `migrate` | Run DB migrations |
| `cleanup [--execute]` | Clean up noisy fragments (dry-run by default) |
| `backfill` | Backfill embeddings |
| `stats` | Fragment / anchor / topic statistics |
| `health` | DB / Redis / embedding connectivity diagnostics |
| `recall <query> [--topic x] [--limit n] [--time-range from,to]` | Terminal recall |
| `remember <content> --topic x --type fact` | Terminal remember |
| `inspect <id>` | Fragment detail + 1-hop links |

All commands support `--json` flag for JSON output.
