/**
 * NLIClassifier - Natural Language Inference 기반 모순 탐지
 *
 * 작성자: 최진호
 * 작성일: 2026-02-28
 *
 * 두 파편의 관계를 entailment / contradiction / neutral로 분류한다.
 * 다국어 NLI 모델(mDeBERTa)을 ONNX Runtime CPU 백엔드로 실행.
 * MemoryConsolidator의 모순 탐지에서 Gemini CLI 호출 전 1차 필터로 사용.
 *
 * 모델: Xenova/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7
 *   - 다국어 지원 (한국어 포함)
 *   - ~280MB ONNX (최초 실행 시 자동 다운로드, 이후 캐싱)
 *   - CPU 전용, GPU 불필요
 *   - 단일 추론 ~50-200ms (warm)
 *
 * 3단계 하이브리드 파이프라인에서의 위치:
 *   1. pgvector 코사인 유사도 > 0.85 → 후보 필터
 *   2. NLI 분류 (이 모듈) → 명확한 모순 즉시 해결
 *   3. Gemini CLI 에스컬레이션 → 수치/도메인 모순 처리
 */

let _tokenizer = null;
let _model     = null;
let _id2label  = null;
let _loading   = null;
let _failed    = false;

const MODEL_ID = "Xenova/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7";

/**
 * 모델 + 토크나이저 싱글턴 로드
 * 최초 호출 시 ~30초 (다운로드 + ONNX 초기화), 이후 즉시 반환
 */
async function loadModel() {
  if (_model && _tokenizer) return { tokenizer: _tokenizer, model: _model };
  if (_failed) return null;
  if (_loading) return _loading;

  _loading = (async () => {
    try {
      const { AutoTokenizer, AutoModelForSequenceClassification } =
        await import("@huggingface/transformers");

      console.log(`[NLIClassifier] Loading model: ${MODEL_ID} ...`);
      const t0 = Date.now();

      _tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
      _model     = await AutoModelForSequenceClassification.from_pretrained(
        MODEL_ID,
        { dtype: "q8" }
      );

      _id2label = _model.config.id2label ||
        { 0: "entailment", 1: "neutral", 2: "contradiction" };

      const sec = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`[NLIClassifier] Model ready in ${sec}s (labels: ${JSON.stringify(_id2label)})`);

      return { tokenizer: _tokenizer, model: _model };
    } catch (err) {
      console.warn(`[NLIClassifier] Model load failed: ${err.message}`);
      _failed = true;
      return null;
    } finally {
      _loading = null;
    }
  })();

  return _loading;
}

/**
 * softmax 유틸리티
 * @param {number[]} logits
 * @returns {number[]}
 */
function softmax(logits) {
  const maxVal = Math.max(...logits);
  const exps   = logits.map(x => Math.exp(x - maxVal));
  const sum    = exps.reduce((a, b) => a + b, 0);
  return exps.map(e => e / sum);
}

/**
 * NLI 모델 사용 가능 여부 (동기)
 * 로드 실패 확정 시 false, 그 외 true (낙관적)
 */
export function isNLIAvailable() {
  return !_failed;
}

/**
 * 두 텍스트의 NLI 관계를 분류
 *
 * @param {string} premise    - 기존 파편 내용
 * @param {string} hypothesis - 신규 파편 내용
 * @returns {Promise<{label: string, scores: {entailment: number, neutral: number, contradiction: number}} | null>}
 *   label: 최고 확률 레이블
 *   scores: 각 레이블의 확률
 *   null: 모델 미가용
 */
export async function classifyNLI(premise, hypothesis) {
  const loaded = await loadModel();
  if (!loaded) return null;

  try {
    const { tokenizer, model } = loaded;

    const inputs = tokenizer(premise, {
      text_pair:  hypothesis,
      padding:    true,
      truncation: true
    });

    const output = await model(inputs);
    const probs  = softmax(Array.from(output.logits.data));

    const scores = {};
    let topLabel = "";
    let topScore = -1;

    for (const [idx, label] of Object.entries(_id2label)) {
      const p       = probs[parseInt(idx)];
      scores[label] = p;
      if (p > topScore) {
        topScore = p;
        topLabel = label;
      }
    }

    return { label: topLabel, scores };
  } catch (err) {
    console.warn(`[NLIClassifier] Inference failed: ${err.message}`);
    return null;
  }
}

/**
 * 두 파편이 모순인지 판정
 *
 * 판정 기준:
 *   - contradiction score >= 0.8 → 확정 모순, 에스컬레이션 불필요
 *   - contradiction score >= 0.5 → 의심 모순, LLM 에스컬레이션 필요
 *   - entailment score >= 0.6    → 비모순 확정
 *   - 그 외                      → 에스컬레이션 필요
 *
 * @param {string} contentA - 파편 A 내용
 * @param {string} contentB - 파편 B 내용
 * @returns {Promise<{contradicts: boolean, confidence: number, needsEscalation: boolean, scores: object} | null>}
 */
export async function detectContradiction(contentA, contentB) {
  const result = await classifyNLI(contentA, contentB);
  if (!result) return null;

  const { scores } = result;
  const cScore     = scores.contradiction || 0;
  const eScore     = scores.entailment    || 0;

  /** 높은 신뢰도 모순 → Gemini 호출 생략 */
  if (cScore >= 0.8) {
    return {
      contradicts:     true,
      confidence:      cScore,
      needsEscalation: false,
      scores
    };
  }

  /** 확실한 entailment → 모순 아님 */
  if (eScore >= 0.6) {
    return {
      contradicts:     false,
      confidence:      eScore,
      needsEscalation: false,
      scores
    };
  }

  /** 중간 수준 모순 신호 → Gemini 에스컬레이션 */
  if (cScore >= 0.5) {
    return {
      contradicts:     true,
      confidence:      cScore,
      needsEscalation: true,
      scores
    };
  }

  /** neutral 지배적이거나 모호 → 에스컬레이션 */
  return {
    contradicts:     false,
    confidence:      scores.neutral || 0,
    needsEscalation: cScore >= 0.2,
    scores
  };
}

/**
 * NLI 모델 사전 로드 (서버 시작 시 호출하여 cold start 방지)
 */
export async function preloadNLI() {
  await loadModel();
}
