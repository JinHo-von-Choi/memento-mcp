/**
 * Winston Logger 설정
 *
 * 작성자: 최진호
 * 작성일: 2026-02-12
 *
 * 기능:
 * - 로그 레벨별 파일 분리
 * - 일별 로그 로테이션
 * - 파일 크기 제한 (20MB)
 * - 최대 보관 기간 (30일)
 * - 개발/프로덕션 환경별 설정
 */

import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import path from "path";
import { LOG_DIR } from "./config.js";

const { combine, timestamp, printf, colorize, errors } = winston.format;

/** 로그 포맷 */
const logFormat = printf(({ level, message, timestamp, stack }) => {
  if (stack) {
    return `${timestamp} [${level}]: ${message}\n${stack}`;
  }
  return `${timestamp} [${level}]: ${message}`;
});

/** 환경 감지 */
const isDevelopment = process.env.NODE_ENV !== "production";

/** 로그 레벨 */
const logLevel = process.env.LOG_LEVEL || (isDevelopment ? "debug" : "info");

/** Winston Logger 생성 */
export const logger = winston.createLogger({
  level: logLevel,
  format: combine(
    errors({ stack: true }),
    timestamp({ format: "YYYY-MM-DD HH:mm:ss" })
  ),
  transports: [
    /** 콘솔 출력 (개발 환경) */
    ...(isDevelopment ? [
      new winston.transports.Console({
        format: combine(
          colorize(),
          logFormat
        )
      })
    ] : []),

    /** Error 로그 (일별 로테이션) */
    new DailyRotateFile({
      filename: path.join(LOG_DIR, "error-%DATE%.log"),
      datePattern: "YYYY-MM-DD",
      level: "error",
      format: logFormat,
      maxSize: "20m",
      maxFiles: "30d",
      zippedArchive: true
    }),

    /** Combined 로그 (일별 로테이션) */
    new DailyRotateFile({
      filename: path.join(LOG_DIR, "combined-%DATE%.log"),
      datePattern: "YYYY-MM-DD",
      format: logFormat,
      maxSize: "20m",
      maxFiles: "30d",
      zippedArchive: true
    }),

    /** Agent 로그 (일별 로테이션) */
    new DailyRotateFile({
      filename: path.join(LOG_DIR, "agent-%DATE%.log"),
      datePattern: "YYYY-MM-DD",
      format: logFormat,
      maxSize: "20m",
      maxFiles: "30d",
      zippedArchive: true,
      level: "info"
    })
  ],
  exceptionHandlers: [
    new DailyRotateFile({
      filename: path.join(LOG_DIR, "exceptions-%DATE%.log"),
      datePattern: "YYYY-MM-DD",
      maxSize: "20m",
      maxFiles: "30d"
    })
  ],
  rejectionHandlers: [
    new DailyRotateFile({
      filename: path.join(LOG_DIR, "rejections-%DATE%.log"),
      datePattern: "YYYY-MM-DD",
      maxSize: "20m",
      maxFiles: "30d"
    })
  ]
});

/** 로그 디렉토리 생성 확인 */
logger.on("error", (error) => {
  console.error("Logger error:", error);
});

/** 로거 초기화 메시지 */
logger.info("Winston logger initialized", {
  level: logLevel,
  environment: isDevelopment ? "development" : "production",
  logDir: LOG_DIR
});

/** 로그 헬퍼 함수 */
export function logInfo(message, meta = {}) {
  logger.info(message, meta);
}

export function logWarn(message, meta = {}) {
  logger.warn(message, meta);
}

export function logError(message, error = null, meta = {}) {
  if (error) {
    logger.error(message, {
      error  : error.name,
      message: error.message,
      stack  : error.stack,
      ...meta
    });
  } else {
    logger.error(message, meta);
  }
}

export function logDebug(message, meta = {}) {
  logger.debug(message, meta);
}

/** HTTP 요청 로깅 */
export function logRequest(req, duration = 0) {
  logger.info("HTTP Request", {
    method   : req.method,
    url      : req.url,
    ip       : req.ip || req.headers["x-forwarded-for"] || req.socket.remoteAddress,
    userAgent: req.headers["user-agent"],
    duration : `${duration}ms`
  });
}

/** 도구 실행 로깅 */
export function logToolExecution(toolName, params, result, duration) {
  logger.info("Tool Execution", {
    tool    : toolName,
    params  : sanitizeParams(params),
    success : !result.error,
    duration: `${duration}ms`
  });
}

/** 민감 정보 제거 */
function sanitizeParams(params) {
  const sanitized      = { ...params };

  // 민감한 필드 마스킹
  const sensitiveFields = ["password", "accessKey", "token", "secret"];

  for (const field of sensitiveFields) {
    if (sanitized[field]) {
      sanitized[field] = "***REDACTED***";
    }
  }

  return sanitized;
}

/** 종료 시 로그 플러시 */
export async function closeLogger() {
  return new Promise((resolve) => {
    logger.end(() => {
      console.log("Logger closed");
      resolve();
    });
  });
}

export default logger;
