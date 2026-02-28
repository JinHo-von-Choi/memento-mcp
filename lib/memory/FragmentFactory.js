/**
 * FragmentFactory - 파편 자동 생성 및 키워드 추출
 *
 * 작성자: 최진호
 * 작성일: 2026-02-23
 * 수정일: 2026-02-25
 *
 * 원시 텍스트를 원자적 파편 단위로 분할하고 메타데이터를 부여
 * js-tiktoken(cl100k_base)으로 정밀 토큰 수 계산
 */

import crypto from "crypto";
import { encodingForModel } from "js-tiktoken";

const MAX_FRAGMENT_LENGTH = 300;

let _tokenEncoder = null;

/**
 * cl100k_base 인코더 인스턴스를 지연 로드한다.
 * 초기화 실패 시 문자 수 / 4 근사치로 폴백.
 */
function getTokenEncoder() {
  if (_tokenEncoder) return _tokenEncoder;
  try {
    _tokenEncoder = encodingForModel("gpt-4");
    return _tokenEncoder;
  } catch {
    return null;
  }
}

/**
 * 텍스트의 토큰 수를 cl100k_base로 정밀 계산한다.
 * 인코더 사용 불가 시 chars / 4 근사치 반환.
 */
function countTokens(text) {
  const enc = getTokenEncoder();
  if (enc) {
    return enc.encode(text).length;
  }
  return Math.ceil(text.length / 4);
}

const IMPORTANCE_WEIGHT = {
  error     : 0.9,
  decision  : 0.8,
  procedure : 0.7,
  preference: 0.95,
  relation  : 0.6,
  fact      : 0.5
};

export class FragmentFactory {

  /**
     * 원시 텍스트에서 단일 파편 생성
     *
     * @param {Object} params
     *   - content   {string} 파편 내용 (1~3문장 권장)
     *   - topic     {string} 주제
     *   - type      {string} fact|decision|error|preference|procedure|relation
     *   - keywords  {string[]} 선택 - 미입력 시 자동 추출
     *   - importance {number} 선택 - 미입력 시 type별 기본값
     *   - source    {string} 출처 (세션 ID, 도구명 등)
     *   - linkedTo  {string[]} 연결 파편 ID
     *   - agentId   {string} 에이전트 ID
     * @returns {Object} fragment
     */
  create(params) {
    const rawContent = (params.content || "").trim();
    if (!rawContent) throw new Error("Fragment content is required");

    /** PII(개인정보) 마스킹 처리 */
    const redactedContent = this._redactPII(rawContent);

    const truncated = redactedContent.length > MAX_FRAGMENT_LENGTH
      ? `${redactedContent.substring(0, MAX_FRAGMENT_LENGTH)}...`
      : redactedContent;

    const type       = params.type || "fact";
    const importance = params.importance ?? (IMPORTANCE_WEIGHT[type] || 0.5);
    const keywords   = params.keywords && params.keywords.length > 0
      ? params.keywords.map(k => k.toLowerCase())
      : this.extractKeywords(truncated);

    return {
      id               : this.generateId(),
      content          : truncated,
      topic            : params.topic || "general",
      keywords,
      type,
      importance,
      source           : params.source || null,
      linked_to        : params.linkedTo || [],
      agent_id         : params.agentId || "default",
      is_anchor        : params.isAnchor || false,
      ttl_tier         : this._inferTTL(type, importance),
      content_hash     : this._hashContent(truncated),
      estimated_tokens : countTokens(truncated)
    };
  }

  /**
   * PII(개인정보) 탐지 및 마스킹
   * 대상: API Key, Email, 비밀번호 패턴, 전화번호 등
   */
  _redactPII(text) {
    let redacted = text;

    /** 1. API Keys (OpenAI, Google 등 일반적인 패턴) */
    redacted = redacted.replace(/(sk-[a-zA-Z0-9]{32,}|AIza[0-9A-Za-z-_]{35})/g, "[REDACTED_API_KEY]");

    /** 2. 이메일 */
    redacted = redacted.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[REDACTED_EMAIL]");

    /** 3. 비밀번호 필드 패턴 */
    redacted = redacted.replace(/(password|passwd|pwd|비밀번호|비번)\s*[:=]\s*[^\s,]+/gi, (match, p1) => `${p1}: [REDACTED_PWD]`);

    /** 4. 한국 휴대전화 번호 */
    redacted = redacted.replace(/01[016789][-\s]?\d{3,4}[-\s]?\d{4}/g, "[REDACTED_PHONE]");

    return redacted;
  }

  /**
     * 긴 텍스트를 문장 단위로 분할하여 복수 파편 생성
     *
     * @param {string} text - 원본 텍스트
     * @param {Object} meta - 공통 메타데이터 (topic, type, source, agentId)
     * @returns {Object[]} fragments
     */
  splitAndCreate(text, meta = {}) {
    const sentences  = this._splitSentences(text);
    const fragments  = [];
    let buffer       = "";

    for (const sentence of sentences) {
      if ((`${buffer  } ${  sentence}`).trim().length > MAX_FRAGMENT_LENGTH && buffer.length > 0) {
        fragments.push(this.create({
          content : buffer.trim(),
          ...meta
        }));
        buffer = sentence;
      } else {
        buffer = buffer ? `${buffer  } ${  sentence}` : sentence;
      }
    }

    if (buffer.trim().length > 0) {
      fragments.push(this.create({
        content: buffer.trim(),
        ...meta
      }));
    }

    /** 순차 파편 간 자동 링크 */
    for (let i = 1; i < fragments.length; i++) {
      fragments[i].linked_to.push(fragments[i - 1].id);
    }

    return fragments;
  }

  /**
     * 에러 정보를 파편으로 변환
     */
  fromError(errorInfo) {
    const content = [
      errorInfo.message || "Unknown error",
      errorInfo.tool ? `도구: ${errorInfo.tool}` : "",
      errorInfo.resolution ? `해결: ${errorInfo.resolution}` : ""
    ].filter(Boolean).join(". ");

    return this.create({
      content,
      topic    : errorInfo.topic || "error",
      type     : "error",
      keywords : [...(errorInfo.keywords || []), "error", errorInfo.tool].filter(Boolean),
      source   : errorInfo.source || "auto",
      agentId  : errorInfo.agentId
    });
  }

  /**
     * 도구 실행 결과를 파편으로 변환
     */
  fromToolResult(toolName, args, result, agentId) {
    const content = `${toolName} 실행 → ${this._summarizeResult(result)}`;
    const topic   = this._inferTopic(toolName);

    return this.create({
      content,
      topic,
      type     : "fact",
      keywords : [toolName, ...Object.keys(args).slice(0, 3)],
      source   : `tool:${toolName}`,
      agentId
    });
  }

  /**
     * 키워드 자동 추출 (간이 TF 기반)
     */
  extractKeywords(text, maxCount = 5) {
    const stopwords = new Set([
      "이", "그", "저", "것", "수", "등", "및", "를", "을", "에",
      "의", "가", "는", "은", "도", "로", "와", "과", "한", "하",
      "the", "a", "an", "is", "are", "was", "were", "be", "been",
      "have", "has", "had", "do", "does", "did", "will", "would",
      "should", "could", "can", "may", "might", "this", "that",
      "with", "from", "for", "and", "but", "or", "not", "in",
      "on", "at", "to", "of", "it", "its", "by", "as"
    ]);

    const words = text.toLowerCase()
      .replace(/[^\w\sㄱ-ㅎ가-힣]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 1 && !stopwords.has(w));

    /** 빈도 계산 */
    const freq = new Map();
    for (const w of words) {
      freq.set(w, (freq.get(w) || 0) + 1);
    }

    return Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxCount)
      .map(([w]) => w);
  }

  /**
     * 고유 ID 생성 (frag-xxx 형식)
     */
  generateId() {
    return `frag-${crypto.randomBytes(8).toString("hex")}`;
  }

  /**
     * TTL 계층 추론
     */
  _inferTTL(type, importance) {
    if (type === "preference")           return "permanent";
    if (importance >= 0.8)               return "permanent";
    if (type === "error" || type === "procedure") return "hot";
    if (importance >= 0.5)               return "warm";
    return "cold";
  }

  /**
     * 컨텐츠 해시
     */
  _hashContent(content) {
    return crypto.createHash("sha256").update(content).digest("hex").substring(0, 16);
  }

  /**
     * 문장 분할
     */
  _splitSentences(text) {
    return text
      .split(/(?<=[.!?。\n])\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
  }

  /**
     * 결과 요약 (200자 제한)
     */
  _summarizeResult(result) {
    const str = typeof result === "string"
      ? result
      : JSON.stringify(result);
    return str.length > 200 ? `${str.substring(0, 200)  }...` : str;
  }

  /**
     * 도구명에서 토픽 추론
     */
  _inferTopic(toolName) {
    const mapping = {
      db_query        : "database",
      db_tables       : "database",
      db_schema       : "database",
      send_email      : "email",
      list_emails     : "email",
      search_emails   : "email",
      manage_wiki_page: "wiki",
      search_wiki     : "wiki",
      list_docs       : "docs",
      get_doc         : "docs",
      create_doc      : "docs",
      update_doc      : "docs",
      send_sms        : "notification"
    };
    return mapping[toolName] || "tool";
  }
}
