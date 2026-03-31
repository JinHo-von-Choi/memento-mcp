#!/usr/bin/env node
/**
 * 경량 DB 마이그레이션 러너
 * agent_memory.schema_migrations 테이블에 적용 이력을 기록하고
 * 미적용 migration-NNN-*.sql 파일만 순서대로 실행한다.
 */
import fs   from "node:fs";
import path from "node:path";
import pg   from "pg";
import dotenv from "dotenv";

dotenv.config();

if (!process.env.DATABASE_URL) {
  const h  = process.env.POSTGRES_HOST     || "localhost";
  const p  = process.env.POSTGRES_PORT     || "5432";
  const d  = process.env.POSTGRES_DB       || "memento";
  const u  = process.env.POSTGRES_USER     || "postgres";
  const pw = process.env.POSTGRES_PASSWORD || "";
  process.env.DATABASE_URL = `postgresql://${u}:${encodeURIComponent(pw)}@${h}:${p}/${d}`;
}

const DB_URL        = process.env.DATABASE_URL;
const MIGRATION_DIR = path.join(import.meta.dirname, "../lib/memory");

if (!DB_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

async function migrate() {
  const pool   = new pg.Pool({ connectionString: DB_URL });
  const client  = await pool.connect();

  const MIGRATE_LOCK_ID = 73657;
  await client.query(`SELECT pg_advisory_lock(${MIGRATE_LOCK_ID})`);
  console.log("Migration lock acquired");

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_memory.schema_migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // pgvector 스키마 자동 감지
    let pgvectorSchema = process.env.PGVECTOR_SCHEMA || "";
    if (!pgvectorSchema) {
      try {
        const extResult = await client.query(
          `SELECT n.nspname FROM pg_extension e
           JOIN pg_namespace n ON e.extnamespace = n.oid
           WHERE e.extname = 'vector'`
        );
        if (extResult.rows.length > 0 && extResult.rows[0].nspname !== "public") {
          pgvectorSchema = extResult.rows[0].nspname;
        }
      } catch { /* pgvector not installed */ }
    }

    const searchPathParts = ["agent_memory"];
    if (pgvectorSchema) searchPathParts.push(pgvectorSchema);
    searchPathParts.push("public");
    const searchPathSQL = `SET search_path TO ${searchPathParts.join(", ")}`;
    console.log(`search_path: ${searchPathParts.join(", ")}${pgvectorSchema ? ` (pgvector in ${pgvectorSchema})` : ""}`);

    const { rows } = await client.query(
      "SELECT filename FROM agent_memory.schema_migrations ORDER BY filename"
    );
    const applied = new Set(rows.map(r => r.filename));

    const files = fs.readdirSync(MIGRATION_DIR)
      .filter(f => f.startsWith("migration-") && f.endsWith(".sql"))
      .sort();

    const pending = files.filter(f => !applied.has(f));

    if (pending.length === 0) {
      console.log("All migrations already applied.");
      return;
    }

    console.log(`${pending.length} pending migration(s):`);

    for (const file of pending) {
      console.log(`  Applying ${file}...`);
      let sql = fs.readFileSync(path.join(MIGRATION_DIR, file), "utf-8");
      // Strip inner BEGIN/COMMIT (migrate.js wraps with outer transaction)
      sql = sql.replace(/^\s*BEGIN\s*;?\s*$/gmi, "");
      sql = sql.replace(/^\s*COMMIT\s*;?\s*$/gmi, "");
      // Strip inner schema_migrations INSERT (migrate.js handles this)
      sql = sql.replace(/INSERT\s+INTO\s+agent_memory\.schema_migrations[\s\S]*?ON\s+CONFLICT[\s\S]*?;\s*/gi, "");

      await client.query("BEGIN");
      await client.query(searchPathSQL);
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO agent_memory.schema_migrations (filename) VALUES ($1)",
          [file]
        );
        await client.query("COMMIT");
        console.log(`  done.`);
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(`  FAILED: ${err.message}`);
        throw err;
      }
    }

    console.log(`${pending.length} migration(s) applied successfully.`);
  } finally {
    await client.query(`SELECT pg_advisory_unlock(${MIGRATE_LOCK_ID})`);
    console.log("Migration lock released");
    client.release();
    await pool.end();
  }
}

migrate().catch(err => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
