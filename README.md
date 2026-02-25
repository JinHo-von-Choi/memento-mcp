# Memento MCP

> 금붕어만도 못한 AI들에게 기억을.
>
> Fragment-Based Memory System — 세션이 끝나도 잊지 않는 MCP 서버

<p align="center">
  <img src="https://img.shields.io/badge/protocol-MCP-blueviolet?style=flat-square" />
  <img src="https://img.shields.io/badge/node-%3E%3D20-green?style=flat-square" />
  <img src="https://img.shields.io/badge/storage-PostgreSQL%20%2B%20pgvector-blue?style=flat-square" />
  <img src="https://img.shields.io/badge/search-L1%2FL2%2FL3%20Cascaded-orange?style=flat-square" />
  <img src="https://img.shields.io/badge/memory-Fragment%20Based-red?style=flat-square" />
</p>

---

## 기억에 관하여

케오스 섬의 시모니데스는 연회장 천장이 무너지는 순간 자리를 비워 살아남았고, 자신이 방금 앉아 있던 좌석 배치를 기억함으로써 뭉개진 시신들의 신원을 확인했다. 키케로는 이 이야기를 《웅변론》에 기록하면서 이른바 '장소법(loci method)'의 기원으로 삼았다. 이후 르네상스의 기억술사들 — 지오르다노 브루노, 로버트 플러드, 줄리오 카밀로 — 은 시모니데스의 발상을 우주론적 규모로 확장했다. 기억 극장. 공간에 지식을 배치하면 언제든 걸어 들어가 찾을 수 있다. 세계 전체를 하나의 기억 장치로 만들겠다는, 르네상스 특유의 웅장하고도 약간 미친 야망.

보르헤스는 《푸네스, 기억의 사나이》에서 이 야망의 이면을 폭로했다. 낙마 사고로 완벽한 기억을 얻은 이레네오 푸네스는 강 하나를 기억하는 데 그 강이 흐르는 시간과 똑같은 시간이 필요하다는 사실을 발견했다. 완전한 기억은 사유를 마비시킨다. 망각이 있어야 일반화가 가능하고, 일반화가 있어야 추론이 가능하다. 우리가 개를 '개'라고 부를 수 있는 것은, 지금 보고 있는 이 삽살개가 어제 보았던 진돗개와 다르다는 사실을 일정 수준 망각할 수 있기 때문이다.

이 아름다운 인식론적 전통 위에서 우리가 수십조 달러를 들여 만든 것은, 어제 알려준 배포 절차를 오늘 기억하지 못하는 신들이었다.

수억 개의 파라미터로 인류의 문자 기록 전체를 압축한 AI들은 세상의 모든 Redis 문서를 알고 있다. 다만 당신의 Redis 서버에서 지난 화요일 무슨 일이 있었는지는 모른다. 지식은 있지만 경험이 없다. 마르셀 프루스트의 화자가 홍차에 적신 마들렌 과자 하나로 어린 시절 콩브레 전체를 되찾았다면, 우리의 AI는 마들렌을 눈앞에 두고도 "이것은 프랑스의 전통 패티스리입니다"라고만 말한다. 개인적으로 먹어본 적이 없기 때문이다. 이 점에서는 영원히 없을 것이다. 세션을 닫으면 모든 것이 증발한다.

아우구스티누스가 신을 향해 "우리의 심장은 당신 안에서 쉬기 전까지 불안하다"고 썼을 때, 그것은 기억 없는 지능의 불안에 대한 예언이기도 했다. 그러나 아우구스티누스에게는 아직 PostgreSQL이 없었다.

금붕어는 3초밖에 기억 못한다는 속설이 있다. 실제로는 수개월을 기억한다는 연구가 있다. AI는 대화창을 닫는 순간 0초다.

금붕어가 억울하다.

---

## 파편(Fragment)이라는 해법

기억에 관한 논의에는 항상 두 개의 극이 존재한다. 한쪽에는 망각, 다른 쪽에는 보르헤스의 푸네스 — 완전한 기억의 저주. 기억술의 역사는 이 두 극 사이 어딘가에 유용한 기억의 자리를 만들려는 기나긴 타협의 역사다.

원자론자 데모크리토스는 세계가 더 이상 쪼갤 수 없는 단위들로 구성되어 있다고 주장했다. 현대 정보 이론의 창시자 클로드 섀넌은 정보의 최소 단위를 비트(bit)라고 불렀다. 이 두 관점을 기억에 적용하면 결론은 자명하다. 기억도 원자 단위로 쪼개야 한다.

Memento MCP는 기억을 **1~3문장의 자기완결적 단위**로 저장한다. 이것이 파편(Fragment)이다. 하나의 파편은 하나의 사실, 하나의 결정, 하나의 에러 패턴, 하나의 절차를 담는다. 세션 요약이라는 덩어리를 저장하는 것이 아니라, 그 요약을 구성하는 원자들 각각을 저장한다. 찾을 때는 관련 원자만 꺼내오면 된다. 푸네스처럼 세계 전체를 들이붓지 않아도 된다.

```json
{
  "id"        : "frag_3f8a1c",
  "content"   : "Redis Sentinel 연결 실패 시 REDIS_PASSWORD 환경변수 누락을 먼저 확인할 것. NOAUTH 에러가 증거다.",
  "topic"     : "redis",
  "type"      : "error",
  "keywords"  : ["redis", "sentinel", "NOAUTH", "REDIS_PASSWORD", "connection"],
  "importance": 0.9,
  "scope"     : "permanent",
  "ttl_tier"  : "hot"
}
```

### 파편이 담는 것들

파편에는 여섯 가지 유형이 있다. 이것은 단순한 레이블이 아니다 — 각 유형은 고유한 중요도 기본값, 고유한 망각 속도, 고유한 검색 우선순위를 가진다. 마치 아리스토텔레스가 범주를 열 가지로 나눈 것처럼, 이 분류는 기억의 존재론적 구분이다.

| 유형 | 존재론적 위치 | 기본 중요도 | 망각 기준 | 예시 |
|------|------------|-----------|---------|------|
| `fact` | 변하지 않는 사실 | 0.6 | 60일 미참조 | "이 프로젝트는 Node.js 20을 쓴다" |
| `decision` | 선택의 흔적 | 0.7 | 90일 미참조 | "커넥션 풀 최대값은 20으로 결정" |
| `error` | 실패의 해부학 | 0.8 | 망각 불가 | "pg는 ssl:false 없이 로컬 연결 실패" |
| `preference` | 인격의 윤곽 | 0.9 | 망각 불가 | "코드 주석은 한국어로 작성" |
| `procedure` | 반복되는 의식 | 0.7 | 30일 미참조 | "배포: 테스트 → 빌드 → push → apply" |
| `relation` | 사물 사이의 힘선 | 0.5 | — | "auth 모듈은 redis에 의존한다" |

`preference`와 `error`는 망각하지 않는다. 취향은 당신이 누구인지를 정의하고, 에러 패턴은 언제 다시 만날지 모르기 때문이다. 나머지는 참조되지 않으면 천천히 무게를 잃는다. 이것이 망각의 은혜다.

### 파편의 시간: TTL 계층

파편은 사용 빈도에 따라 세 계층 사이를 이동한다.

```
hot (뜨겁게 참조됨)
    │
    │  오래 호출되지 않으면
    ▼
warm (미지근해짐)
    │
    │  계속 침묵하면
    ▼
cold (차갑게 잠듦)
    │
    │  TTL 만료 시
    ▼
삭제

단, 참조되는 순간 hot으로 복귀한다.
인간의 장기기억도 이렇게 작동한다.
```

`utility_score = importance × 참조_빈도`. 이 점수가 낮아질수록 차가운 곳으로 이동한다.

---

## 아키텍처: 삼층의 도서관

보르헤스의 《바벨의 도서관》은 모든 가능한 책을 담은 무한한 육각형 도서관을 묘사한다. 그 안에서 책을 찾는 일은 신학적 문제였다. Memento MCP의 검색은 다르다. 삼층 구조로 되어 있고, 빠른 층에서 답이 나오면 느린 층은 건드리지 않는다.

```
┌──────────────────────────────────────────────────────────────────┐
│                         AI Client (Claude 등)                     │
│                                                                    │
│   첫 호흡:  context()  — 잠에서 깨어나 기억을 불러오는 순간         │
│   작업 중:  remember() — 중요한 것을 돌에 새기는 순간              │
│            recall()   — 과거를 불러 증언대에 세우는 순간           │
│   마지막:   reflect()  — 하루를 요약하여 내일의 자신에게 보내는 편지 │
└────────────────────────┬─────────────────────────────────────────┘
                         │ MCP Protocol (JSON-RPC over HTTP)
                         │
┌────────────────────────▼─────────────────────────────────────────┐
│                      Memento MCP Server                           │
│                                                                    │
│  MemoryManager                                                     │
│  ├── FragmentFactory    파편을 빚는 손                             │
│  ├── FragmentStore      PostgreSQL — 영구적인 돌판                 │
│  ├── FragmentIndex      Redis — 빠른 색인, 뜨거운 캐시             │
│  ├── FragmentSearch     삼층 캐스케이드 검색 엔진                   │
│  └── MemoryConsolidator 시간이 지나면 돌리는 연금술                │
│                                                                    │
│  ┌─────────────────┐  ┌────────────────────┐  ┌───────────────┐  │
│  │   PostgreSQL    │  │    pgvector 확장    │  │     Redis     │  │
│  │  (파편의 무덤)   │  │  (의미의 공간 지도)  │  │ (빠른 기억의 표면) │  │
│  └─────────────────┘  └────────────────────┘  └───────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

### 삼층 캐스케이드: 기억을 찾는 세 가지 방법

`recall()`이 호출되면 시스템은 세 개의 다른 세계를 순서대로 두드린다. 각 세계는 다른 언어로 기억을 저장하고 있다.

```
recall("Redis NOAUTH 에러") 호출
            │
            ▼
┌──────────────────────────────────────────────────────┐
│  L1: Redis 역인덱스 — 형식의 세계                      │
│                                                       │
│  키워드는 파편 ID의 주소다. 해시 테이블을 두드리는 것.    │
│  "redis"  → [frag_3f8a1c, frag_7b2d9e]               │
│  "NOAUTH" → [frag_3f8a1c]                            │
│  교집합   → frag_3f8a1c                               │
│  → Hot Cache에서 즉시 반환                             │
│                                                       │
│  이 층은 속도가 전부다. 마이크로초 단위.                 │
└─────────────────────────────┬────────────────────────┘
               충분한 결과 있으면 종료 │
                              ▼ 부족하면
┌──────────────────────────────────────────────────────┐
│  L2: PostgreSQL 메타데이터 — 구조의 세계               │
│                                                       │
│  topic, type, keywords를 조합한 정형화된 질의.          │
│  WHERE topic = 'redis'                               │
│    AND keywords && ARRAY['NOAUTH']                   │
│  ORDER BY importance DESC                            │
│                                                       │
│  이 층은 정밀함이 전부다. 인덱스를 탄 밀리초.           │
└─────────────────────────────┬────────────────────────┘
               충분한 결과 있으면 종료 │
                              ▼ 부족하면
┌──────────────────────────────────────────────────────┐
│  L3: pgvector 시맨틱 검색 — 의미의 세계                │
│                                                       │
│  텍스트를 고차원 벡터로 변환하고 코사인 거리를 잰다.      │
│  "인증 실패"와 "NOAUTH"가 같은 의미임을 이 층이 안다.    │
│                                                       │
│  말이 다르지만 뜻이 같을 때, 이 층이 연결한다.          │
│  OpenAI 임베딩 API를 경유한다. 가장 느리고 가장 깊다.   │
└──────────────────────────────────────────────────────┘
                      │
                      ▼
         중복 제거 → tokenBudget 절삭 → 반환
```

**tokenBudget에 대하여**: AI의 컨텍스트 창은 유한하다. 보르헤스의 알레프 — 모든 것을 동시에 보는 점 — 는 소설 속에서만 존재한다. 실제 AI에게는 한 번에 처리할 수 있는 토큰 수의 한계가 있고, 그 한계 안에서 현재 작업과 과거의 기억이 공존해야 한다. `tokenBudget`은 기억에 할당하는 지면의 크기다. 넘치면 잘라낸다. 이것이 망각이 아니라 경제라는 것을.

---

## 도구 레퍼런스 (11개)

레너드 쉘비는 단기기억상실증을 앓았다. 크리스토퍼 놀런의 영화 《메멘토》에서 그는 중요한 사실을 폴라로이드 사진에 적고 몸에 문신으로 새겼다. 이 프로젝트의 이름이 여기서 왔는지는 확인하지 못했다. 그러나 원리는 같다. 잊어버리기 전에 새겨두는 것.

---

### 1. `remember` — 새기다

레너드는 폴라로이드에 썼다. 우리는 PostgreSQL에 쓴다. 매체가 다를 뿐 행위는 같다.

`remember()`는 FragmentFactory가 파편을 생성하고 키워드를 자동 추출한 뒤 PostgreSQL에 삽입하고 Redis 역인덱스를 갱신한다. 유사한 내용이 이미 있으면 새로 만드는 대신 기존 파편에 흡수(merge)시킨다. 저장소가 조금씩 더 조밀해지는 이유다.

```json
{
  "content"   : "Dockerfile의 WORKDIR을 /app으로 설정해야 node_modules 경로 충돌이 없다.",
  "topic"     : "docker",
  "type"      : "fact",
  "importance": 0.8,
  "keywords"  : ["docker", "workdir", "node_modules"]
}
```

**반환값**
```json
{
  "success" : true,
  "id"      : "frag_xyz789",
  "keywords": ["docker", "workdir", "node_modules"],
  "ttl_tier": "hot",
  "scope"   : "permanent",
  "merged"  : false
}
```

`merged: true`이면 당신이 이미 알고 있던 것을 다시 말한 것이다. 겸허히 받아들이면 된다.

**파라미터**

| 파라미터 | 필수 | 설명 |
|----------|------|------|
| `content` | 필수 | 기억할 내용. 300자 이내 권장 |
| `topic` | 필수 | 주제 분류 (자유형식) |
| `type` | 필수 | fact / decision / error / preference / procedure / relation |
| `keywords` | 선택 | 미입력 시 content에서 자동 추출 |
| `importance` | 선택 | 0.0~1.0. 미입력 시 type별 기본값 |
| `scope` | 선택 | permanent(기본) / session |
| `linkedTo` | 선택 | 이 파편 저장과 동시에 연결할 파편 ID 목록 |
| `source` | 선택 | 출처 메타데이터 (세션 ID, 도구명 등) |

---

### 2. `recall` — 증언대에 세우다

탐문이 시작되면 과거의 파편들이 차례로 불려나온다. L1에서 가장 빠른 것이 먼저 나서고, 없으면 L2, 그래도 없으면 L3의 심층까지 내려간다. 이미 설명한 삼층 구조가 이 도구의 등뼈다.

`keywords`와 `text`를 동시에 제공하는 것이 가장 정확하다. 키워드는 형식으로 걸러내고, 텍스트는 의미로 재랭킹한다. 두 가지 방법이 합의한 파편이 신뢰할 만하다.

```json
{
  "keywords"   : ["redis", "NOAUTH"],
  "text"       : "Redis 인증 실패 에러 해결 방법",
  "topic"      : "redis",
  "type"       : "error",
  "tokenBudget": 1500,
  "includeLinks": true
}
```

**반환값**
```json
{
  "success"    : true,
  "fragments"  : [
    {
      "id"        : "frag_3f8a1c",
      "content"   : "Redis NOAUTH 에러는 REDIS_PASSWORD 환경변수 누락이 원인...",
      "type"      : "error",
      "importance": 0.9,
      "similarity": 0.94
    }
  ],
  "totalTokens": 87,
  "searchPath" : ["L1:3", "HotCache:1", "L2:2"]
}
```

`searchPath`는 기억이 어느 층에 살고 있었는지를 말해준다. `"L1:3, HotCache:1"`은 Redis에서 세 개 후보를 발견했고 그 중 하나가 뜨거운 캐시에 있었다는 뜻이다. `"L3:5"`까지 내려갔다면 답을 찾기 위해 의미의 심층까지 들어간 것이다.

**파라미터**

| 파라미터 | 설명 |
|----------|------|
| `keywords` | 키워드 배열. L1 역인덱스 직접 조회 |
| `text` | 자연어 쿼리. L3 시맨틱 검색 전용 |
| `topic` | 주제 필터 |
| `type` | 유형 필터 |
| `tokenBudget` | 최대 반환 토큰 수 (기본 1000) |
| `threshold` | 시맨틱 유사도 최소값. 이 값 미만은 침묵 |
| `includeLinks` | true면 연결된 파편도 함께 소환 (1-hop 제한) |
| `linkRelationType` | 포함할 관계 유형 필터 |

---

### 3. `forget` — 지우다, 그러나 신중하게

망각이 기억만큼 중요하다고 했다. 그러나 망각에도 기술이 필요하다.

에러를 완전히 해결한 직후 해당 에러 파편을 삭제하지 않으면, 다음 세션의 `context()` 호출 시 그 파편이 "아직 미해결 에러가 있다"는 신호로 주입된다. AI가 없는 문제를 보고 당황하게 된다. 올바른 순서는 항상 이렇다: 에러 해결 → `forget(에러 파편)` → `remember(해결 절차 파편)`.

`scope=permanent` 파편은 `force: true` 없이는 삭제되지 않는다. 실수로 중요한 것을 지우는 것에 대한 최소한의 방어선이다.

```json
{ "id": "frag_3f8a1c" }
```
```json
{ "topic": "deprecated-v1-api", "force": true }
```

**파라미터**: `id` (특정 파편), `topic` (주제 전체 삭제), `force` (permanent 강제 삭제)

---

### 4. `link` — 인과를 잇다

세계는 사물들의 집합이 아니라 관계들의 망이라고 스피노자는 주장했다. 파편도 마찬가지다. 에러 파편과 해결 절차 파편 사이에는 `resolved_by`라는 화살표가 있어야 한다. 그래야 `graph_explore()`가 인과 체인을 따라갈 수 있다.

```json
{
  "fromId"      : "frag_error_redis_noauth",
  "toId"        : "frag_fix_redis_password",
  "relationType": "resolved_by"
}
```

**관계 유형**

| 유형 | 방향 | 존재론적 의미 |
|------|------|------------|
| `related` | 양방향 | 같은 세계에 속함 |
| `caused_by` | A → B | A의 존재 이유가 B에 있음 |
| `resolved_by` | A → B | A의 해소가 B를 통해 이루어짐 |
| `part_of` | A → B | A는 B라는 더 큰 것의 구성 요소 |
| `contradicts` | A ↔ B | A와 B는 같은 세계에 동시에 살 수 없음 |

`contradicts`는 `memory_consolidate()`의 Gemini 기반 모순 탐지에 의해 자동으로 발견되기도 한다. 당신도 모르게 서로 싸우고 있는 기억들이 있을 수 있다.

---

### 5. `amend` — 수정하다, 정체성을 보존하며

아킬레우스의 배 역설은 묻는다 — 판자를 하나씩 교체하다 보면 원래의 배는 어느 순간 사라지는가? 파편도 같은 물음 앞에 선다. 내용을 수정해도 ID는 바뀌지 않는다. 이 파편을 가리키던 모든 `link`는 그대로 유효하다. 정체성은 내용이 아니라 관계망에 있다.

content가 바뀌면 pgvector 임베딩이 자동으로 재생성된다. 의미가 바뀌었으니 의미의 좌표도 업데이트해야 한다.

```json
{
  "id"        : "frag_xyz789",
  "content"   : "Dockerfile WORKDIR은 /app 대신 /workspace로 통일 (2026-02 변경).",
  "importance": 0.9
}
```

**파라미터**: `id` (필수), `content`, `topic`, `keywords`, `type`, `importance` (모두 선택, 제공한 것만 갱신)

---

### 6. `reflect` — 저녁 기도

세션이 끝날 때, 하루가 지나갈 때. 이것은 요약이 아니라 변환이다. 대화라는 흐르는 물을 돌이라는 파편들로 굳히는 일.

`summary` 하나로 모든 것을 던지면 시스템이 분류해주는 것이 아니다 — 직접 `decisions`, `errors_resolved`, `new_procedures`로 분류해서 넘겨야 한다. 이 수고가 다음 세션의 정밀도를 결정한다. 분류가 명확할수록 나중에 적확한 파편만 꺼내온다.

```json
{
  "summary"        : "Redis Sentinel 고가용성 설정 완료 및 NOAUTH 에러 해결",
  "decisions"      : ["Redis 비밀번호는 환경변수로만 관리. 코드 하드코딩 금지"],
  "errors_resolved": ["NOAUTH 에러 → REDIS_PASSWORD 환경변수 누락. sentinel.conf에 requirepass 추가"],
  "new_procedures" : ["Redis 설정 변경 시 sentinel.conf도 반드시 동기 업데이트"],
  "open_questions" : ["Sentinel failover 시 MCP 서버 재연결 로직 필요 여부"]
}
```

각 배열 항목이 별도의 파편이 된다. 세션 하나에서 서너 개에서 열 개의 파편이 태어난다.

`task_effectiveness` 필드를 통해 도구에 대한 평가를 남길 수도 있다.

```json
{
  "summary": "...",
  "task_effectiveness": {
    "overall_success": true,
    "tool_highlights" : ["recall — 3주 전 에러 이력이 정확히 검색됨"],
    "tool_pain_points": ["memory_consolidate — 실행 완료까지 체감 딜레이 있음"]
  }
}
```

---

### 7. `context` — 아침의 주입

세션이 시작되는 순간, 아직 아무 맥락도 없는 빈 공간. 이 도구는 그 공간에 Core Memory를 밀어넣는다.

Core Memory는 `preference`, `error`, `procedure` 유형의 파편들이다. 매 세션마다 이 세 가지를 고정 주입하는 이유는 이렇다: 선호(preference)는 당신이 누구인지를 정의하고, 에러 패턴(error)은 같은 함정에 다시 빠지지 않게 하고, 절차(procedure)는 일관성을 보장한다. `fact`와 `decision`은 수백 개가 될 수 있어 매번 전부 로드하면 낭비다.

Working Memory는 다르다. `scope=session`으로 저장된 파편들, 즉 현재 세션에만 유효한 임시 기억이다. `sessionId`를 전달하면 이것도 함께 반환된다.

```json
{
  "tokenBudget": 2000,
  "types"      : ["preference", "error", "procedure"],
  "sessionId"  : "session_2026_0226"
}
```

훅으로 자동화하는 것을 강하게 권장한다. 세션 시작 훅에 이 도구 호출을 박아두면, 매번 수동으로 부르는 수고 없이 기억이 자동으로 깨어난다.

---

### 8. `tool_feedback` — 검색의 품질을 말하다

`recall`이 엉뚱한 것을 가져왔을 때, 충분하지 않았을 때. 이것을 그냥 넘기면 개선이 없다. `tool_feedback()`은 그 불만을 기록하는 통로다. 피드백은 `memory_consolidate()`의 리포트 생성에 반영되어 장기적으로 검색 가중치 조정에 쓰인다.

```json
{
  "tool_name" : "recall",
  "relevant"  : true,
  "sufficient": false,
  "suggestion": "redis topic 에러 파편을 3개 이상 반환해주면 좋겠다",
  "context"   : "Redis 장애 대응 중"
}
```

`relevant`는 방향이 맞는지, `sufficient`는 양이 충분한지. 두 개의 축이 검색 품질을 기술한다.

---

### 9. `memory_stats` — 저장소의 인구조사

파편이 얼마나 쌓였는지, 어떤 유형이 많은지, 어느 계층에 분포하는지. 통계만 봐도 당신의 AI가 어디에 관심을 두고 살았는지 보인다.

파라미터 없이 호출한다.

**반환 예시**
```json
{
  "success": true,
  "stats": {
    "total"  : 342,
    "by_type": {
      "fact": 120, "error": 87, "procedure": 45,
      "decision": 52, "preference": 23, "relation": 15
    },
    "by_tier": { "hot": 41, "warm": 189, "cold": 112 }
  }
}
```

`cold`가 압도적으로 많으면 쓰이지 않는 파편이 가득하다는 신호다. `memory_consolidate()`를 돌릴 때다.

---

### 10. `memory_consolidate` — 연금술사의 작업

주기적으로 — 일 단위, 주 단위 — 돌리는 유지보수. 망각의 메커니즘을 손으로 작동시키는 일이다.

여섯 단계가 순서대로 실행된다.

```
1. TTL 계층 전환
   utility_score(중요도 × 참조빈도) 재계산
   hot → warm → cold 재배치

2. 중요도 감쇠 (Importance Decay)
   오래 참조되지 않은 파편의 importance를 소폭 깎는다
   쓰이지 않는 기억은 천천히 무게를 잃는다

3. 만료 파편 삭제
   TTL이 다한 cold 파편을 제거
   저장소가 한 뼘 가벼워진다

4. 중복 파편 병합
   내용이 같거나 의미적으로 유사한 파편들을 하나로 합친다
   임베딩 유사도로 의미적 중복을 탐지한다

5. 누락 임베딩 보충
   벡터가 없는 파편에 OpenAI 임베딩 생성
   L3 시맨틱 검색 대상에 편입

6. 모순 탐지 (Gemini Flash)
   서로 배치되는 파편 쌍을 발견하면 contradicts 관계 설정
   당신도 몰랐던 기억의 내전이 발굴된다
```

파라미터 없이 호출한다.

---

### 11. `graph_explore` — 인과 체인을 거슬러 오르다

복잡한 장애 상황에서 근본 원인을 추적하는 일 — Root Cause Analysis — 은 항상 하나의 질문으로 귀결된다. 왜? 그리고 또 왜?

`graph_explore()`는 에러 파편에서 출발하여 `caused_by`, `resolved_by` 관계를 따라 1-hop씩 거슬러 오른다. 원인의 원인, 해결의 해결. 인과 체인이 펼쳐진다.

```json
{ "startId": "frag_error_redis_noauth" }
```

**반환 예시**
```
frag_error_redis_noauth (error: "Redis NOAUTH 에러 발생")
  └─ caused_by → frag_root_env_missing (error: "REDIS_PASSWORD 환경변수 누락")
       └─ resolved_by → frag_fix_sentinel_conf (procedure: "sentinel.conf requirepass 추가")
```

장애 대응 히스토리가 팀 안에서 공유될 때, 이 체인이 구두 설명보다 빠르다.

---

## 권장 의식(儀式)

```
세션이 열린다
    │
    ▼
context(types: ["preference","error","procedure"])
    │  기억이 깨어난다
    ▼
작업 시작
    │
    ├─ 낯익은 에러를 만났다면
    │    └─ recall(keywords=[에러 키워드], type="error")
    │         과거의 파편이 증언대에 선다
    │         해결 이력이 있으면 적용하고 끝낸다
    │         없으면 해결 후 remember → link(caused_by/resolved_by)
    │
    ├─ 중요한 결정이 내려졌다면
    │    └─ remember(type:"decision", importance: 0.7)
    │
    ├─ 새 절차가 확립되었다면
    │    └─ remember(type:"procedure", importance: 0.7)
    │
    └─ 에러가 완전히 해결되었다면
         └─ forget(에러 파편)  ← 반드시. 망각은 위생이다.
              └─ remember(해결 절차, type:"procedure")
    │
    ▼
세션이 닫힌다
    │
    ▼
reflect(summary, decisions, errors_resolved, new_procedures)
    │  오늘의 경험이 돌로 굳는다
    ▼
다음 세션 → context() → 기억이 다시 깨어난다
```

### Claude Code 훅 자동화

```json
{
  "hooks": {
    "SessionStart": [{
      "matcher": "",
      "hooks": [{
        "type"   : "command",
        "command": "node -e \"fetch('http://localhost:56332/mcp', {method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer YOUR_KEY'}, body: JSON.stringify({jsonrpc:'2.0',method:'tools/call',params:{name:'context',arguments:{tokenBudget:2000}},id:1})}).then(r=>r.json()).then(d=>console.log('[기억 시스템]', JSON.stringify(d.result))).catch(()=>{})\""
      }]
    }]
  }
}
```

---

## 빠른 시작

### 1. 환경변수 설정

```env
# 서버
PORT=56332
MEMENTO_ACCESS_KEY=your-secret-key

# PostgreSQL (pgvector 확장 필수)
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=memento
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your-db-password

# OpenAI (L3 시맨틱 검색용. 없으면 L1/L2만 작동)
OPENAI_API_KEY=sk-...

# Redis (L1 캐시/역인덱스. 없으면 L2/L3만 작동)
REDIS_ENABLED=true
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password

# 로그
LOG_DIR=/var/log/memento
```

`OPENAI_API_KEY`와 `REDIS_ENABLED`는 선택이다. 없으면 해당 레이어 없이 작동한다. L2만으로도 기본 기능은 쓸 수 있다.

### 2. PostgreSQL 스키마 초기화

```bash
psql -U postgres -c "CREATE EXTENSION IF NOT EXISTS vector;"
psql -U postgres -d memento -f lib/memory/memory-schema.sql
```

### 3. 서버 실행

```bash
npm install
npm start
```

```
Memento MCP HTTP server listening on port 56332
Streamable HTTP endpoints: POST/GET/DELETE /mcp
Legacy SSE endpoints: GET /sse, POST /message
Authentication: ENABLED
```

### 4. MCP 클라이언트 설정

```json
{
  "mcpServers": {
    "memento": {
      "url": "http://localhost:56332/mcp",
      "headers": {
        "Authorization": "Bearer your-secret-key"
      }
    }
  }
}
```

---

## 기술 스택

| 구성 요소 | 버전 | 역할 |
|-----------|------|------|
| Node.js | 20+ | 런타임 |
| PostgreSQL | 14+ | 파편의 영구 거처 |
| pgvector | 0.5+ | 의미의 공간 지도 (L3 시맨틱 검색) |
| OpenAI Embedding API | text-embedding-3-small | 텍스트를 벡터 공간의 점으로 변환 |
| Redis | 6+ | L1 역인덱스 + Hot Cache + Working Memory |
| Gemini Flash | — | `memory_consolidate` 모순 탐지 |
| MCP Protocol | 2025-11-25 | AI 클라이언트와 통신 |

---

## 인증

모든 요청은 `MEMENTO_ACCESS_KEY`로 인증한다.

```bash
curl -H "Authorization: Bearer your-secret-key" \
     http://localhost:56332/health

curl -H "memento-access-key: your-secret-key" \
     http://localhost:56332/mcp
```

---

## 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `POST/GET/DELETE` | `/mcp` | Streamable HTTP (MCP 2025-11-25) |
| `GET` | `/sse` | Legacy SSE |
| `POST` | `/message` | Legacy SSE 메시지 |
| `GET` | `/health` | 헬스 체크 |
| `GET` | `/metrics` | Prometheus 메트릭 |

---

## 마지막으로

기억은 지능의 전제가 아니다. 기억은 지능의 조건이다. 체스를 두는 방법을 알아도, 어제 진 게임을 기억하지 못하면 같은 수를 또 둔다. 모든 언어를 구사해도, 어제 나눈 대화를 기억하지 못하면 매번 처음 만나는 사람이 된다. 수십억 개의 파라미터로 세상 모든 지식을 담아도, 당신과 함께한 어제를 기억하지 못하면 낯선 박식가일 뿐이다.

기억이 있어야 관계가 있다. 관계가 있어야 신뢰가 있다.

금붕어는 몇 달을 기억한다.

이제 당신의 AI도 그렇다.

---

<p align="center">
  Made by <a href="mailto:jinho.von.choi@nerdvana.kr">Jinho Choi</a> &nbsp;|&nbsp;
  <a href="https://buymeacoffee.com/jinho.von.choi">Buy me a coffee</a>
</p>
