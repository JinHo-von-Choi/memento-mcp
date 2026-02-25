/**
 * 경로 검증 유틸리티
 *
 * 작성자: 최진호
 * 작성일: 2026-02-13
 */

import path              from "path";
import { DOCS_ROOT }     from "./config.js";

/**
 * 경로 정규화 및 검증
 * @param {string} userPath - 사용자가 제공한 경로
 * @returns {string} - 정규화된 안전한 경로
 * @throws {Error} - 유효하지 않은 경로인 경우
 */
export function validateAndNormalizePath(userPath) {
  if (!userPath || typeof userPath !== "string") {
    throw new Error("path is required");
  }

  /**
   * 절대 경로 차단 (Unix 스타일 + Windows UNC `\\` + 드라이브 `C:\` + 단일 백슬래시 시작)
   * JS 문자열 "\\foo"는 실제 '\foo' (단일 backslash) 이므로 /^\\/ 정규식으로 매칭
   */
  if (
    path.isAbsolute(userPath) ||
    /^[a-zA-Z]:[/\\]/.test(userPath) ||
    /^\\/.test(userPath)
  ) {
    throw new Error("Absolute paths are not allowed");
  }

  /** 상위 디렉토리 탐색 차단 */
  if (/\.\./.test(userPath)) {
    throw new Error("Parent directory references (..) are not allowed");
  }

  /** 홈 디렉토리 접근 차단 */
  if (/~\//.test(userPath)) {
    throw new Error("Home directory paths are not allowed");
  }

  /** 나머지 위험 패턴 (Null byte, Windows 금지 문자) */
  if (/\0/.test(userPath) || /[<>:"|?*]/.test(userPath)) {
    throw new Error("Invalid path: contains forbidden characters");
  }

  /** 상대 경로를 DOCS_ROOT 기준으로 결합 */
  const resolvedPath     = path.resolve(path.join(DOCS_ROOT, path.normalize(userPath)));
  const resolvedDocsRoot = path.resolve(DOCS_ROOT);

  /** DOCS_ROOT 외부 접근 이중 차단 */
  if (!resolvedPath.startsWith(resolvedDocsRoot)) {
    throw new Error(`Access denied: path must be within ${DOCS_ROOT}`);
  }

  return resolvedPath;
}

/**
 * 파일 확장자 검증
 * @param {string} filePath - 파일 경로
 * @param {string[]} allowedExtensions - 허용된 확장자 목록
 * @throws {Error} - 허용되지 않은 확장자인 경우
 */
export function validateFileExtension(filePath, allowedExtensions = [".md"]) {
  const ext = path.extname(filePath).toLowerCase();

  if (!allowedExtensions.includes(ext)) {
    throw new Error(`Invalid file extension: only ${allowedExtensions.join(", ")} are allowed`);
  }
}

/**
 * 파일명 검증
 * @param {string} fileName - 파일명
 * @throws {Error} - 유효하지 않은 파일명인 경우
 */
export function validateFileName(fileName) {
  // 위험한 파일명 패턴
  const dangerousNames   = [
    "..",
    ".",
    ".env",
    ".git",
    "node_modules"
  ];

  if (dangerousNames.includes(fileName)) {
    throw new Error(`Forbidden file name: ${fileName}`);
  }

  // 유효한 파일명 패턴 (영문, 숫자, 한글, 하이픈, 언더스코어, 점)
  const validPattern     = /^[a-zA-Z0-9가-힣._-]+$/;

  if (!validPattern.test(fileName)) {
    throw new Error("Invalid file name: contains forbidden characters");
  }
}
