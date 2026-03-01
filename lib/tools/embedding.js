/**
 * 문서 임베딩 유틸리티 모듈
 *
 * 작성자: 최진호
 * 작성일: 2026-02-23
 * 수정일: 2026-03-01
 * 설명: 듀얼 모드 임베딩 (OpenAI API / 로컬 HuggingFace ONNX)
 *       OPENAI_API_KEY 설정 시 OpenAI, 미설정 시 로컬 모델 자동 선택
 *       SHA-256 해시를 통한 변경 감지 및 중복 탐지
 */

import { createHash } from "crypto";
import {
  OPENAI_API_KEY,
  EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS
} from "../config.js";

const USE_OPENAI = !!OPENAI_API_KEY;

/** ─── OpenAI 백엔드 ─── */

let _openaiClient = null;

async function getOpenAIClient() {
  if (_openaiClient) return _openaiClient;

  const { default: OpenAI } = await import("openai");
  _openaiClient = new OpenAI({ apiKey: OPENAI_API_KEY });
  return _openaiClient;
}

async function generateEmbeddingOpenAI(text) {
  const client   = await getOpenAIClient();
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text
  });
  return response.data[0].embedding;
}

async function generateBatchEmbeddingsOpenAI(texts, batchSize = 100) {
  const client     = await getOpenAIClient();
  const allVectors = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch    = texts.slice(i, i + batchSize);
    const response = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch
    });

    const sorted = response.data.sort((a, b) => a.index - b.index);
    for (const item of sorted) {
      allVectors.push(item.embedding);
    }

    if (i + batchSize < texts.length) {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  return allVectors;
}

/** ─── 로컬 HuggingFace 백엔드 ─── */

let _pipeline = null;
let _loading  = null;
let _failed   = false;

async function getEmbeddingPipeline() {
  if (_pipeline) return _pipeline;
  if (_failed) return null;
  if (_loading) return _loading;

  _loading = (async () => {
    try {
      const { pipeline } = await import("@huggingface/transformers");

      console.log(`[Embedding] Loading model: ${EMBEDDING_MODEL} ...`);
      const t0 = Date.now();

      _pipeline = await pipeline("feature-extraction", EMBEDDING_MODEL, {
        dtype: "fp32"
      });

      const sec = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`[Embedding] Model ready in ${sec}s (dims: ${EMBEDDING_DIMENSIONS})`);

      return _pipeline;
    } catch (err) {
      console.warn(`[Embedding] Model load failed: ${err.message}`);
      _failed = true;
      return null;
    } finally {
      _loading = null;
    }
  })();

  return _loading;
}

async function generateEmbeddingLocal(text) {
  const pipe = await getEmbeddingPipeline();
  if (!pipe) {
    throw new Error("임베딩 모델을 로드할 수 없습니다");
  }

  const output = await pipe(text, { pooling: "mean", normalize: true });
  return Array.from(output.data);
}

async function generateBatchEmbeddingsLocal(texts, batchSize = 32) {
  const pipe = await getEmbeddingPipeline();
  if (!pipe) {
    throw new Error("임베딩 모델을 로드할 수 없습니다");
  }

  const allVectors = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);

    for (const text of batch) {
      const output = await pipe(text, { pooling: "mean", normalize: true });
      allVectors.push(Array.from(output.data));
    }
  }

  return allVectors;
}

/** ─── 공용 API ─── */

/**
 * 임베딩 사용 가능 여부 (동기)
 * OpenAI 모드: API 키가 설정되어 있으면 항상 true
 * 로컬 모드: 모델 로드 실패 시에만 false
 */
export function isEmbeddingAvailable() {
  if (USE_OPENAI) return true;
  return !_failed;
}

/**
 * 문서 콘텐츠의 SHA-256 해시 생성
 *
 * @param {string} content - 원본 텍스트
 * @returns {string} hex 해시값
 */
export function computeContentHash(content) {
  return createHash("sha256")
    .update(content, "utf8")
    .digest("hex");
}

/**
 * 문서에서 임베딩에 사용할 텍스트 추출
 * frontmatter 제거, 코드 블록 축약, 링크 정리 후 적절한 길이로 자르기
 *
 * @param {string} content    - 마크다운 원본
 * @param {number} maxTokens  - 대략적인 최대 토큰 수 (기본 8000)
 * @returns {string} 정제된 텍스트
 */
export function prepareTextForEmbedding(content, maxTokens = 8000) {
  let text = content;

  /** frontmatter 제거 */
  text = text.replace(/^---\n[\s\S]*?\n---\n?/, "");

  /** 코드 블록을 [CODE] 플레이스홀더로 축약 */
  text = text.replace(/```[\s\S]*?```/g, "[CODE]");

  /** 마크다운 링크에서 URL 제거, 텍스트만 유지 */
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  /** HTML 태그 제거 */
  text = text.replace(/<[^>]+>/g, "");

  /** 연속 공백/개행 정리 */
  text = text.replace(/\n{3,}/g, "\n\n").trim();

  /** 대략적으로 maxTokens * 4 글자까지 (영문 기준 1 token ~ 4 chars) */
  const maxChars = maxTokens * 4;
  if (text.length > maxChars) {
    text = text.slice(0, maxChars);
  }

  return text;
}

/**
 * 단일 텍스트의 임베딩 벡터 생성
 *
 * @param {string} text - 임베딩할 텍스트
 * @returns {Promise<number[]>} 벡터 (차원은 설정에 따라 다름)
 */
export async function generateEmbedding(text) {
  if (USE_OPENAI) return generateEmbeddingOpenAI(text);
  return generateEmbeddingLocal(text);
}

/**
 * 배치 임베딩 생성 (여러 텍스트 동시 처리)
 *
 * @param {string[]} texts      - 임베딩할 텍스트 배열
 * @param {number}   batchSize  - 호출당 처리 단위
 * @returns {Promise<number[][]>} 각 텍스트의 벡터 배열
 */
export async function generateBatchEmbeddings(texts, batchSize) {
  if (USE_OPENAI) return generateBatchEmbeddingsOpenAI(texts, batchSize || 100);
  return generateBatchEmbeddingsLocal(texts, batchSize || 32);
}

/**
 * 마크다운 문서에서 메타데이터 추출
 *
 * @param {string} content      - 마크다운 원본
 * @param {string} relativePath - 문서 상대 경로
 * @returns {Object} 추출된 메타데이터
 */
export function extractDocumentMetadata(content, relativePath) {
  /** H1 타이틀 추출 */
  const h1Matches = [...content.matchAll(/^#\s+(.+)$/gm)];
  const h1Titles  = h1Matches.map(m => m[1].trim());

  /** frontmatter에서 title/category 추출 */
  let fmTitle    = null;
  let fmCategory = null;

  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const fm        = fmMatch[1];
    const titleLine = fm.match(/title:\s*["']?(.+?)["']?\s*$/m);
    const catLine   = fm.match(/category:\s*["']?(.+?)["']?\s*$/m);
    if (titleLine) fmTitle    = titleLine[1].trim();
    if (catLine)   fmCategory = catLine[1].trim();
  }

  /** 경로 기반 카테고리 추론 */
  const pathParts  = relativePath.split("/");
  const pathCategory = pathParts.length > 1 ? pathParts[0] : "root";

  /** 단어 수 (공백 기준 대략적 계산) */
  const wordCount = content.split(/\s+/).filter(Boolean).length;

  return {
    title     : fmTitle || h1Titles[0] || null,
    category  : fmCategory || pathCategory,
    h1Titles,
    wordCount,
    fileSize  : Buffer.byteLength(content, "utf8")
  };
}

/**
 * 두 벡터 간 코사인 유사도 계산 (JS 레벨)
 * DB의 vector_cosine_ops와 동일한 결과
 *
 * @param {number[]} vecA
 * @param {number[]} vecB
 * @returns {number} 0~1 사이 유사도 (1이 완전 동일)
 */
export function cosineSimilarity(vecA, vecB) {
  if (vecA.length !== vecB.length) {
    throw new Error(`벡터 차원 불일치: ${vecA.length} vs ${vecB.length}`);
  }

  let dotProduct = 0;
  let normA      = 0;
  let normB      = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA      += vecA[i] * vecA[i];
    normB      += vecB[i] * vecB[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

/**
 * pgvector 형식 문자열 변환
 * number[] -> '[0.1,0.2,...]' 형식
 *
 * @param {number[]} vector
 * @returns {string}
 */
export function vectorToSql(vector) {
  return `[${vector.join(",")}]`;
}

export { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS };
