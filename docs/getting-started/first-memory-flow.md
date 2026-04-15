---
title: "First Memory Flow"
date: 2026-03-13
author: 최진호
updated: 2026-04-16
---

# First Memory Flow

이 문서는 설치 직후 Memento MCP가 실제로 기억을 저장하고 불러오는지 검증하는 절차다.

## 목표

1. `remember` 호출 성공
2. `recall` 호출 성공
3. `context` 호출 성공

## 1. remember

```bash
curl -s -X POST http://localhost:57332/mcp \
  -H "Authorization: Bearer change-me" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "remember",
      "arguments": {
        "topic": "first-run",
        "type": "fact",
        "content": "첫 remember 테스트를 성공적으로 수행했다."
      }
    }
  }'
```

올바른 입력 특징:
- `topic`, `type`, `content`가 모두 있음
- `content`는 1~3문장 수준의 원자적 사실

자주 틀리는 입력:
- 너무 긴 세션 전체 요약을 한 번에 넣는 경우
- `type`에 지원되지 않는 문자열을 넣는 경우

## 2. recall

```bash
curl -s -X POST http://localhost:57332/mcp \
  -H "Authorization: Bearer change-me" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "recall",
      "arguments": {
        "topic": "first-run"
      }
    }
  }'
```

기대 결과:
- 조금 전에 저장한 파편이 결과에 포함된다.

## 3. context

```bash
curl -s -X POST http://localhost:57332/mcp \
  -H "Authorization: Bearer change-me" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "context",
      "arguments": {}
    }
  }'
```

`context`는 세션 시작 시 핵심 기억을 묶어서 불러오는 도구다. `remember`와 `recall`이 개별 파편 저장/조회라면, `context`는 세션 부팅용 요약 주입에 가깝다.

## 4. 다음 단계

- Claude Code와 연결하려면 [Claude Code Configuration](claude-code.md)
- Windows 환경이라면 [Windows WSL2 Setup](windows-wsl2.md) 또는 [Windows PowerShell Setup](windows-powershell.md)
- 오류가 나면 [Troubleshooting](troubleshooting.md)
- v2.8.0 옵션: Symbolic Memory 활성화 방법은 [docs/configuration.md](../configuration.md) 및 [CHANGELOG.md](../../CHANGELOG.md) 참조.
