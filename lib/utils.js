/**
 * 유틸리티 함수
 *
 * @deprecated 각 도메인 모듈 사용 권장.
 * 하위 호환 re-export.
 *
 * 작성자: 최진호
 * 작성일: 2026-01-30
 * 수정일: 2026-03-09
 */

import { promises as fsp } from "fs";
import path                 from "path";

export { sseWrite, readJsonBody, validateOrigin } from "./http/helpers.js";
export { logAudit, logAccess }                    from "./logging/audit.js";

/**
 * 마크다운 파일 목록 조회 (재귀)
 */
export async function listMarkdownFiles(dir, base = "") {
  let results            = [];
  const entries            = await fsp.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath        = path.join(dir, entry.name);
    const relativePath     = path.join(base, entry.name);

    if (entry.isDirectory()) {
      const subResults     = await listMarkdownFiles(entryPath, relativePath);
      results            = results.concat(subResults);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      const stat           = await fsp.stat(entryPath);

      results.push({
        path : relativePath,
        size : stat.size,
        mtime: stat.mtime.toISOString()
      });
    }
  }

  return results;
}
