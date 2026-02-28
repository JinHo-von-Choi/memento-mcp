/**
 * Memento MCP Prompts 정의
 */

export const PROMPTS = [
  {
    name: "analyze-session",
    description: "현재 세션의 활동을 분석하고 장기 기억으로 저장할 항목을 제안합니다.",
    arguments: [
      {
        name: "focus",
        description: "분석 초점 (예: '기술적 결정', '에러 해결')",
        required: false
      }
    ]
  },
  {
    name: "retrieve-relevant-memory",
    description: "특정 주제나 작업과 관련된 과거 기억을 효율적으로 검색하도록 가이드합니다.",
    arguments: [
      {
        name: "topic",
        description: "검색할 주제",
        required: true
      }
    ]
  },
  {
    name: "onboarding",
    description: "Memento MCP 기억 시스템 사용법을 안내합니다.",
    arguments: []
  }
];

/**
 * 프롬프트 상세 내용 반환
 */
export async function getPrompt(name, args = {}) {
  switch (name) {
    case "analyze-session":
      const focusText = args.focus ? `特に「${args.focus}」에 중점을 두어 ` : "";
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `현재 세션에서 발생한 중요한 정보들을 분석해줘. ${focusText}나중에 'reflect' 도구로 저장할 수 있도록 다음 항목들을 정리해줘:
1. 확정된 기술적 결정 (decisions)
2. 해결된 에러와 그 방법 (errors_resolved)
3. 새로 확립된 절차나 워크플로우 (new_procedures)
4. 아직 해결되지 않은 질문이나 후속 작업 (open_questions)

분석이 끝나면 내가 'reflect' 도구를 호출해서 이 내용들을 저장할게.`
            }
          }
        ]
      };

    case "retrieve-relevant-memory":
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `지금 내가 작업 중인 '${args.topic}' 주제와 관련된 과거의 기억이 있는지 'recall' 도구를 사용해서 찾아봐줘. 
단순한 키워드 검색뿐만 아니라 'text' 파라미터를 사용해서 시맨틱 검색도 병행해줘. 
검색된 결과가 있다면 현재 작업에 어떻게 적용할 수 있을지 알려줘.`
            }
          }
        ]
      };

    case "onboarding":
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Memento MCP 시스템을 어떻게 사용하면 좋을지 설명해줘. 
특히 'remember', 'recall', 'reflect'라는 세 가지 핵심 도구를 언제, 어떻게 사용하는 것이 가장 효율적인지 예시와 함께 알려줘.`
            }
          }
        ]
      };

    default:
      throw new Error(`Unknown prompt: ${name}`);
  }
}
