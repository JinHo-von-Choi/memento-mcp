/**
 * PostgreSQL 클라이언트
 *
 * 작성자: 최진호
 * 작성일: 2026-02-14
 */

import pg from "pg";

const { Pool } = pg;

/**
 * PostgreSQL 연결 풀
 */
export class PostgresClient {
  constructor(config) {
    this.pool = new Pool({
      host     : config.host || "nerdvana.kr",
      port     : config.port || 3388,
      database : config.database || "bee_db",
      user     : config.user || "bee",
      password : config.password,
      max      : config.maxConnections || 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000
    });

    this.pool.on("error", (err) => {
      console.error("[PostgresClient] 연결 풀 에러:", err);
    });
  }

  /**
   * 쿼리 실행
   */
  async query(text, params) {
    const start = Date.now();
    try {
      const result = await this.pool.query(text, params);
      const duration = Date.now() - start;
      console.log(`[PostgresClient] 쿼리 실행: ${duration}ms`);
      return result;
    } catch (error) {
      console.error("[PostgresClient] 쿼리 실패:", error.message);
      throw error;
    }
  }

  /**
   * 트랜잭션 시작
   */
  async getClient() {
    return await this.pool.connect();
  }

  /**
   * 연결 종료
   */
  async close() {
    await this.pool.end();
  }
}

/**
 * 싱글톤 인스턴스
 */
let clientInstance = null;

export function getPostgresClient(config) {
  if (!clientInstance) {
    clientInstance = new PostgresClient(config);
  }
  return clientInstance;
}
