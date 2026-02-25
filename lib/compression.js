/**
 * HTTP 응답 압축 유틸리티
 *
 * 작성자: 최진호
 * 작성일: 2026-02-13
 *
 * gzip 압축을 통한 네트워크 대역폭 절감 및 응답 시간 단축
 */

import zlib from "zlib";
import { promisify } from "util";

const gzipAsync   = promisify(zlib.gzip);
const gunzipAsync = promisify(zlib.gunzip);

/** 압축 설정 */
const MIN_COMPRESS_SIZE = Number(process.env.MIN_COMPRESS_SIZE || 1024); // 1KB
const COMPRESSION_LEVEL = Number(process.env.COMPRESSION_LEVEL || 6);    // 0-9 (기본: 6)

/**
 * Accept-Encoding 헤더에서 gzip 지원 여부 확인
 */
export function supportsGzip(req) {
  const acceptEncoding = req.headers["accept-encoding"] || "";
  return acceptEncoding.includes("gzip");
}

/**
 * 응답 데이터를 gzip으로 압축
 *
 * @param {string|Buffer} data - 압축할 데이터
 * @param {number} level - 압축 레벨 (0-9, 기본: 6)
 * @returns {Promise<Buffer>} 압축된 데이터
 */
export async function compressGzip(data, level = COMPRESSION_LEVEL) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");

  // 최소 크기 미만이면 압축하지 않음
  if (buffer.length < MIN_COMPRESS_SIZE) {
    return null;
  }

  const compressed = await gzipAsync(buffer, { level });

  // 압축률이 낮으면 (압축 후 크기가 원본의 90% 이상) 압축하지 않음
  if (compressed.length >= buffer.length * 0.9) {
    return null;
  }

  return compressed;
}

/**
 * gzip 압축 데이터 해제
 *
 * @param {Buffer} data - 압축된 Buffer
 * @returns {Promise<string>} UTF-8 문자열
 * @throws {Error} 유효하지 않은 gzip 데이터이거나 빈 Buffer인 경우
 */
export async function decompressGzip(data) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);

  if (buffer.length === 0) {
    throw new Error("Cannot decompress empty buffer");
  }

  const decompressed = await gunzipAsync(buffer);
  return decompressed.toString("utf8");
}

/**
 * Content-Type 기반 압축 적합성 판단
 *
 * @param {string} contentType - MIME 타입
 * @returns {boolean} 압축 적합 여부
 */
export function shouldCompress(contentType) {
  if (!contentType) {
    return false;
  }

  const type = contentType.split(";")[0].trim().toLowerCase();

  /** 이미 압축되어 있거나 바이너리 타입은 압축 불필요 */
  const noCompressTypes = [
    "image/",
    "video/",
    "audio/",
    "application/zip",
    "application/gzip",
    "application/x-gzip",
    "application/octet-stream",
    "application/pdf"
  ];

  for (const prefix of noCompressTypes) {
    if (type.startsWith(prefix) || type === prefix) {
      return false;
    }
  }

  /** 텍스트 기반 타입은 압축 대상 */
  const compressTypes = [
    "text/",
    "application/json",
    "application/javascript",
    "application/xml",
    "application/ld+json",
    "application/manifest+json",
    "image/svg+xml"
  ];

  for (const prefix of compressTypes) {
    if (type.startsWith(prefix) || type === prefix) {
      return true;
    }
  }

  return false;
}

/**
 * HTTP 응답에 gzip 압축된 데이터 전송
 *
 * @param {http.ServerResponse} res - HTTP 응답 객체
 * @param {number} statusCode - HTTP 상태 코드
 * @param {string} contentType - Content-Type 헤더
 * @param {string|Buffer} data - 응답 데이터
 * @param {http.IncomingMessage} req - HTTP 요청 객체
 */
export async function sendCompressed(res, statusCode, contentType, data, req) {
  // gzip 지원 여부 확인
  if (!supportsGzip(req)) {
    res.statusCode = statusCode;
    res.setHeader("Content-Type", contentType);
    res.end(data);
    return;
  }

  // 압축 시도
  const compressed = await compressGzip(data);

  if (compressed) {
    // 압축 성공
    const originalSize = Buffer.byteLength(data);
    const compressedSize = compressed.length;
    const ratio = ((1 - compressedSize / originalSize) * 100).toFixed(1);

    console.log(`[Compression] ${originalSize} → ${compressedSize} bytes (${ratio}% saved)`);

    res.statusCode = statusCode;
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Encoding", "gzip");
    res.setHeader("Content-Length", compressed.length);
    res.end(compressed);
  } else {
    // 압축하지 않음 (크기 작거나 압축률 낮음)
    res.statusCode = statusCode;
    res.setHeader("Content-Type", contentType);
    res.end(data);
  }
}

/**
 * JSON 응답 전송 (자동 압축)
 *
 * @param {http.ServerResponse} res - HTTP 응답 객체
 * @param {number} statusCode - HTTP 상태 코드
 * @param {Object} data - JSON 데이터
 * @param {http.IncomingMessage} req - HTTP 요청 객체
 */
export async function sendJSON(res, statusCode, data, req) {
  const json = JSON.stringify(data);
  await sendCompressed(res, statusCode, "application/json; charset=utf-8", json, req);
}
