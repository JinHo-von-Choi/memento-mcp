#!/usr/bin/env node
import "dotenv/config";
import { parseArgs } from '../lib/cli/parseArgs.js';

const COMMANDS = {
  serve:      () => import('../lib/cli/serve.js'),
  migrate:    () => import('../lib/cli/migrate.js'),
  cleanup:    () => import('../lib/cli/cleanup.js'),
  backfill:   () => import('../lib/cli/backfill.js'),
  stats:      () => import('../lib/cli/stats.js'),
  health:     () => import('../lib/cli/health.js'),
  recall:     () => import('../lib/cli/recall.js'),
  remember:   () => import('../lib/cli/remember.js'),
  inspect:    () => import('../lib/cli/inspect.js'),
  update:     () => import('../lib/cli/update.js'),
  export:     () => import('../lib/cli/export.js'),
  import:     () => import('../lib/cli/import.js'),
  completion: () => import('../lib/cli/completion.js'),
  session:    () => import('../lib/cli/session.js'),
};

/** 원격 모드를 지원하지 않는 로컬 전용 명령 목록 */
const LOCAL_ONLY_COMMANDS = new Set(["serve", "migrate", "cleanup", "backfill", "health", "update", "export", "import"]);

function printUsage() {
  const lines = [
    'Usage: memento-mcp <command> [options]',
    '',
    'Commands:',
    '  serve                       Start the MCP server',
    '  migrate                     Run DB migrations',
    '  cleanup [--execute]         Clean noise fragments (default: dry-run)',
    '  backfill                    Backfill missing embeddings',
    '  stats                       Show fragment statistics',
    '  health                      Check DB/Redis/embedding connectivity',
    '  recall <query> [--topic x]  Search fragments from terminal',
    '  remember <content> --topic  Store a fragment from terminal',
    '  inspect <fragment-id>       Show fragment detail + 1-hop links',
    '  update [--execute] [--redetect]  Check and apply updates (default: dry-run)',
    '  export [--topic x] [--type t]   Export fragments as JSONL to stdout or file',
    '  import [--input FILE]            Import fragments from JSONL file or stdin',
    '  completion <shell>               Print shell completion script (bash|zsh)',
    '  session <list|show|delete>       Manage active sessions (headless/CI)',
    '',
    'Options:',
    '  --help                      Show this help message',
    '  --json                      Output as JSON (where supported)',
    '  --remote <URL>              MCP 원격 서버 URL (recall/remember/stats/inspect 전용)',
    '  --key <KEY>                 API 키 Bearer 토큰 (--remote 사용 시 필수)',
    '  --timeout <ms>              원격 요청 타임아웃 밀리초 (default: 30000)',
    '',
    'Remote-capable commands: recall, remember, stats, inspect, session',
    'Local-only commands: serve, migrate, cleanup, backfill, health, update, export, import',
  ];
  console.log(lines.join('\n'));
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);

  if (!cmd || cmd === '--help') {
    printUsage();
    process.exit(0);
  }

  if (!COMMANDS[cmd]) {
    console.error(`Unknown command: ${cmd}`);
    console.error('Run "memento-mcp --help" for usage.');
    process.exit(1);
  }

  const args = parseArgs(rest);

  /** --remote 지정 시 로컬 전용 명령은 즉시 거부 */
  const remoteUrl = args.remote || process.env.MEMENTO_CLI_REMOTE;
  if (remoteUrl && LOCAL_ONLY_COMMANDS.has(cmd)) {
    console.error(`'${cmd}' 명령은 로컬 전용입니다. --remote 플래그를 사용할 수 없습니다.`);
    console.error('원격 모드를 지원하는 명령: recall, remember, stats, inspect');
    process.exit(1);
  }

  // 서브명령별 --help / -h
  if (args.help || args.h) {
    const mod = await COMMANDS[cmd]();
    const helpText = mod.usage ?? mod.default?.usage ?? `No help available for: ${cmd}`;
    console.log(helpText);
    process.exit(0);
  }

  try {
    const mod = await COMMANDS[cmd]();
    await mod.default(args);
  } catch (err) {
    console.error(`[${cmd}] ${err.message}`);
    if (args.verbose) {
      console.error(err.stack);
    }
    process.exit(1);
  }

  // Non-blocking update check
  if (cmd !== "update" && process.env.UPDATE_CHECK_DISABLED !== "true") {
    import("../lib/updater/cache.js").then(async ({ UpdateCache }) => {
      const c = new UpdateCache();
      if (!c.isExpired(Number(process.env.UPDATE_CHECK_INTERVAL_HOURS || 24))) return;
      try {
        const { checkForUpdate } = await import("../lib/updater/version-checker.js");
        const r = await checkForUpdate({ githubToken: process.env.GITHUB_TOKEN });
        const { detectInstallType } = await import("../lib/updater/install-detector.js");
        c.set({ ...r, installType: await detectInstallType() });
        if (r.updateAvailable) process.stderr.write(`\n[memento-mcp] v${r.latestVersion} available. Run "memento-mcp update" to upgrade.\n`);
      } catch { /* network failure - silent */ }
    }).catch(() => {});
  }
}

main();
