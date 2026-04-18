/**
 * Codex CLI Client (memento-mcp 전용)
 *
 * 작성자: 최진호
 * 작성일: 2026-04-18
 *
 * 정찰 결과 요약 (2026-04-18):
 *   - 바이너리: /home/nirna/.nvm/versions/node/v24.13.0/bin/codex (v0.121.0)
 *   - 핵심 플래그: codex exec --skip-git-repo-check --full-auto -o FILE [PROMPT]
 *     · --full-auto  : --sandbox workspace-write (자동 실행, 확인 없음)
 *     · --skip-git-repo-check : Git 저장소 외부에서도 실행 가능
 *     · -o FILE      : 에이전트 마지막 메시지를 파일로 기록 (파싱 타겟)
 *     · --json       : NDJSON 스트리밍 (파싱 복잡 — 사용 않음)
 *   - 테스트 호출 결과:
 *     · prompt: 'Return ONLY valid JSON...: {"status":"ok","items":["a","b"]}'
 *     · -o FILE 기록 내용: {"status":"ok","items":["a","b"]} (JSON 직접 파싱 가능)
 *   - stdin 지원: 컨텍스트를 stdin으로 주입하고 prompt 인자로 지시 분리 가능
 *
 * public API:
 *   _rawIsCodexCLIAvailable()  — CLI 바이너리 존재 여부 (CodexCliProvider 전용)
 *   isCodexCLIAvailable()      — LLM chain 가용성 위임 (llm/index.js)
 *   runCodexCLI()              — CLI 저수준 호출 (CodexCliProvider 전용)
 *
 * 순환 의존성 방지:
 *   lib/codex.js → lib/llm/index.js (동적 import, public API에서만)
 *   lib/codex.js는 lib/llm/index.js를 정적 import하지 않는다.
 */

import { spawn }  from "child_process";
import fs         from "fs";
import os         from "os";
import path       from "path";
import crypto     from "crypto";

// ---------------------------------------------------------------------------
// 내부 전용: 실제 CLI 바이너리 존재 여부 확인
// CodexCliProvider.isAvailable()에서 호출한다.
// isCodexCLIAvailable()(public)은 체인 전체 위임이므로, CLI 자체 확인은
// 이 함수로 분리하여 순환 의존성을 방지한다.
// ---------------------------------------------------------------------------

let _codexCLICached = null;

/**
 * Codex CLI 바이너리(`codex`) 설치 여부를 확인한다.
 * CodexCliProvider 내부 전용 — 일반 호출부에서 직접 사용하지 말 것.
 *
 * @returns {Promise<boolean>}
 */
export async function _rawIsCodexCLIAvailable() {
  if (_codexCLICached !== null) return _codexCLICached;
  try {
    const { execSync } = await import("child_process");
    execSync("which codex", { stdio: "ignore", timeout: 5000 });
    _codexCLICached = true;
  } catch {
    _codexCLICached = false;
  }
  return _codexCLICached;
}

// ---------------------------------------------------------------------------
// Public API (thin shim → llm/index.js 위임)
// ---------------------------------------------------------------------------

/**
 * LLM chain에 사용 가능한 provider가 있는지 확인한다.
 *
 * @returns {Promise<boolean>}
 */
export async function isCodexCLIAvailable() {
  const { isLlmAvailable } = await import("./llm/index.js");
  return isLlmAvailable();
}

// ---------------------------------------------------------------------------
// 저수준 CLI 호출 — CodexCliProvider 전용
// ---------------------------------------------------------------------------

/**
 * Codex CLI를 비대화형(exec) 모드로 호출하여 에이전트 최종 답변을 반환한다.
 *
 * 구현 전략:
 *   - `-o FILE` 플래그로 마지막 메시지만 임시 파일에 기록
 *   - `--full-auto` + `--skip-git-repo-check` 로 무인 실행
 *   - 임시 파일은 try/finally 블록에서 반드시 삭제
 *   - stdinContent 제공 시 stdin으로 주입 (긴 컨텍스트 분리)
 *
 * @param {string} stdinContent - stdin으로 전달할 컨텍스트 (빈 문자열이면 stdin 주입 없음)
 * @param {string} prompt       - exec 인자로 전달할 지시 프롬프트
 * @param {object} [options={}]
 * @param {number} [options.timeoutMs=120000] - 프로세스 타임아웃 (ms)
 * @param {string} [options.model]            - 사용할 모델명 (-m 플래그)
 * @returns {Promise<string>} 에이전트 최종 답변 텍스트
 */
export async function runCodexCLI(stdinContent, prompt, options = {}) {
  const timeoutMs = options.timeoutMs || 120_000;
  const outFile   = path.join(os.tmpdir(), `codex-${crypto.randomUUID()}.txt`);

  const args = [
    "exec",
    "--skip-git-repo-check",
    "--full-auto",
    "-o", outFile
  ];

  if (options.model) {
    args.push("-m", options.model);
  }

  args.push(prompt);

  return new Promise((resolve, reject) => {
    const proc = spawn("codex", args, {
      env:   { ...process.env },
      stdio: ["pipe", "pipe", "pipe"]
    });

    let   stderr  = "";
    let   settled = false;

    const cleanup = () => {
      try { fs.unlinkSync(outFile); } catch (_) {}
    };

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill("SIGTERM");
        cleanup();
        reject(new Error(`Codex CLI timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    proc.stderr.on("data", (data) => { stderr += data.toString(); });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;

      if (code !== 0) {
        cleanup();
        reject(new Error(`Codex CLI exited with code ${code}: ${stderr.trim()}`));
        return;
      }

      try {
        const content = fs.readFileSync(outFile, "utf8").trim();
        cleanup();
        resolve(content);
      } catch (readErr) {
        cleanup();
        reject(new Error(`Codex CLI: failed to read output file: ${readErr.message}`));
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error(`Codex CLI spawn error: ${err.message}`));
      }
    });

    if (stdinContent) {
      proc.stdin.write(stdinContent, "utf8");
    }
    proc.stdin.end();
  });
}
