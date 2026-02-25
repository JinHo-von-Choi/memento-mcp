/**
 * 액세스 통계
 *
 * 작성자: 최진호
 * 작성일: 2026-01-30
 */

import { promises as fsp } from "fs";
import path              from "path";

/** 액세스 통계 (인메모리) */
export const accessStats = new Map();

/**
 * 통계 업데이트
 */
export function updateAccessStats(toolName, docPath) {
  if (toolName === "get_doc" && docPath) {
    const count            = accessStats.get(docPath) || 0;
    accessStats.set(docPath, count + 1);
  }
}

/**
 * 통계 저장 (주기적)
 */
export async function saveAccessStats(logDir) {
  try {
    await fsp.mkdir(logDir, { recursive: true });
    const statsFile        = path.join(logDir, "access-stats.json");
    const statsData        = Object.fromEntries(accessStats);
    await fsp.writeFile(statsFile, JSON.stringify(statsData, null, 2));
    console.log(`[Stats] Saved ${accessStats.size} document access counts`);
  } catch (err) {
    console.error("[Stats] Failed to save stats:", err);
  }
}
