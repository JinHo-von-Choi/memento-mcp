#!/usr/bin/env bash
# Memento MCP Setup
# 작성자: 최진호

set -euo pipefail

# ── 색상 ─────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}${BOLD}[setup]${RESET} $*"; }
success() { echo -e "${GREEN}${BOLD}[✓]${RESET} $*"; }
warn()    { echo -e "${YELLOW}${BOLD}[!]${RESET} $*"; }
error()   { echo -e "${RED}${BOLD}[✗]${RESET} $*" >&2; }

ask() {
  local prompt="$1" default="${2:-}" var
  if [[ -n "$default" ]]; then
    read -rp "$(echo -e "${BOLD}${prompt}${RESET} [${default}]: ")" var
    echo "${var:-$default}"
  else
    read -rp "$(echo -e "${BOLD}${prompt}${RESET}: ")" var
    echo "$var"
  fi
}

ask_secret() {
  local prompt="$1" var
  read -rsp "$(echo -e "${BOLD}${prompt}${RESET}: ")" var
  echo
  echo "$var"
}

ask_yn() {
  local prompt="$1" default="${2:-y}" ans
  read -rp "$(echo -e "${BOLD}${prompt}${RESET} [${default}]: ")" ans
  ans="${ans:-$default}"
  [[ "$ans" =~ ^[Yy] ]]
}

# ── 시작 ─────────────────────────────────────────────────────────
echo
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${BOLD}  Memento MCP — Interactive Setup${RESET}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo

# ── .env 존재 확인 ────────────────────────────────────────────────
ENV_FILE=".env"

if [[ -f "$ENV_FILE" ]]; then
  warn ".env 파일이 이미 존재합니다."
  if ! ask_yn "덮어쓰겠습니까?" "n"; then
    info "기존 .env를 유지합니다. 종료합니다."
    exit 0
  fi
  cp "$ENV_FILE" "${ENV_FILE}.backup.$(date +%Y%m%d_%H%M%S)"
  success "기존 .env를 백업했습니다."
fi

echo

# ── 서버 설정 ─────────────────────────────────────────────────────
info "서버 설정"
PORT=$(ask "포트" "57332")
SESSION_TTL=$(ask "세션 TTL (분)" "60")
LOG_DIR=$(ask "로그 디렉토리" "/var/log/mcp")
MEMENTO_ACCESS_KEY=$(ask_secret "액세스 키 (MEMENTO_ACCESS_KEY, 비워두면 인증 없음)")

echo

# ── PostgreSQL ────────────────────────────────────────────────────
info "PostgreSQL 설정"
PG_HOST=$(ask "호스트" "localhost")
PG_PORT=$(ask "포트" "5432")
PG_DB=$(ask "데이터베이스 이름")
PG_USER=$(ask "사용자")
PG_PASSWORD=$(ask_secret "비밀번호")
DB_MAX_CONNECTIONS=$(ask "최대 커넥션 수" "20")

DATABASE_URL="postgresql://${PG_USER}:$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$PG_PASSWORD")@${PG_HOST}:${PG_PORT}/${PG_DB}"

echo

# ── Redis ─────────────────────────────────────────────────────────
info "Redis 설정"
if ask_yn "Redis를 사용하겠습니까?" "y"; then
  REDIS_ENABLED="true"
  REDIS_HOST=$(ask "Redis 호스트" "localhost")
  REDIS_PORT=$(ask "Redis 포트" "6379")
  REDIS_PASSWORD=$(ask_secret "Redis 비밀번호 (없으면 Enter)")
  REDIS_DB=$(ask "Redis DB 번호" "0")
else
  REDIS_ENABLED="false"
  REDIS_HOST="localhost"; REDIS_PORT="6379"; REDIS_PASSWORD=""; REDIS_DB="0"
fi

echo

# ── 임베딩 Provider ───────────────────────────────────────────────
info "임베딩 Provider 선택"
echo "  1) openai    (text-embedding-3-small, 1536차원)"
echo "  2) gemini    (gemini-embedding-001, 3072차원)"
echo "  3) ollama    (로컬, nomic-embed-text)"
echo "  4) localai   (로컬 OpenAI 호환)"
echo "  5) custom    (직접 설정)"
echo "  6) 없음      (시맨틱 검색 비활성화)"
EMBED_CHOICE=$(ask "선택" "1")

EMBEDDING_PROVIDER=""; EMBEDDING_API_KEY=""; EMBEDDING_MODEL=""
EMBEDDING_DIMENSIONS=""; EMBEDDING_BASE_URL=""

case "$EMBED_CHOICE" in
  1)
    EMBEDDING_PROVIDER="openai"
    EMBEDDING_API_KEY=$(ask_secret "OpenAI API Key")
    EMBEDDING_MODEL=$(ask "모델" "text-embedding-3-small")
    EMBEDDING_DIMENSIONS=$(ask "차원 수" "1536")
    ;;
  2)
    EMBEDDING_PROVIDER="gemini"
    EMBEDDING_API_KEY=$(ask_secret "Gemini API Key")
    EMBEDDING_MODEL=$(ask "모델" "gemini-embedding-001")
    EMBEDDING_DIMENSIONS=$(ask "차원 수" "3072")
    warn "3072차원 최초 사용 시 migration-007 실행이 필요합니다."
    ;;
  3)
    EMBEDDING_PROVIDER="ollama"
    EMBEDDING_MODEL=$(ask "모델" "nomic-embed-text")
    EMBEDDING_DIMENSIONS=$(ask "차원 수" "768")
    ;;
  4)
    EMBEDDING_PROVIDER="localai"
    EMBEDDING_MODEL=$(ask "모델" "text-embedding-ada-002")
    EMBEDDING_DIMENSIONS=$(ask "차원 수" "1536")
    ;;
  5)
    EMBEDDING_PROVIDER="custom"
    EMBEDDING_BASE_URL=$(ask "Base URL (예: http://localhost:8080/v1)")
    EMBEDDING_API_KEY=$(ask_secret "API Key")
    EMBEDDING_MODEL=$(ask "모델명")
    EMBEDDING_DIMENSIONS=$(ask "차원 수")
    ;;
  6)
    EMBEDDING_PROVIDER=""
    ;;
esac

echo

# ── .env 파일 작성 ────────────────────────────────────────────────
info ".env 파일 작성 중..."

cat > "$ENV_FILE" <<EOF
# Memento MCP 환경 변수
# 생성일: $(date '+%Y-%m-%d %H:%M:%S')

# ─── 서버 ────────────────────────────────────────────────────────
PORT=${PORT}
SESSION_TTL_MINUTES=${SESSION_TTL}
LOG_DIR=${LOG_DIR}
EOF

if [[ -n "$MEMENTO_ACCESS_KEY" ]]; then
  echo "MEMENTO_ACCESS_KEY=${MEMENTO_ACCESS_KEY}" >> "$ENV_FILE"
else
  echo "# MEMENTO_ACCESS_KEY=" >> "$ENV_FILE"
fi

cat >> "$ENV_FILE" <<EOF

# ─── PostgreSQL ───────────────────────────────────────────────────
POSTGRES_HOST=${PG_HOST}
POSTGRES_PORT=${PG_PORT}
POSTGRES_DB=${PG_DB}
POSTGRES_USER=${PG_USER}
POSTGRES_PASSWORD=${PG_PASSWORD}
DATABASE_URL=${DATABASE_URL}
DB_MAX_CONNECTIONS=${DB_MAX_CONNECTIONS}
DB_IDLE_TIMEOUT_MS=30000
DB_CONN_TIMEOUT_MS=10000
DB_QUERY_TIMEOUT=30000

# ─── Redis ────────────────────────────────────────────────────────
REDIS_ENABLED=${REDIS_ENABLED}
REDIS_HOST=${REDIS_HOST}
REDIS_PORT=${REDIS_PORT}
EOF

if [[ -n "$REDIS_PASSWORD" ]]; then
  echo "REDIS_PASSWORD=${REDIS_PASSWORD}" >> "$ENV_FILE"
else
  echo "# REDIS_PASSWORD=" >> "$ENV_FILE"
fi

cat >> "$ENV_FILE" <<EOF
REDIS_DB=${REDIS_DB}
CACHE_ENABLED=true
CACHE_DB_TTL=300
EOF

if [[ -n "$EMBEDDING_PROVIDER" ]]; then
  cat >> "$ENV_FILE" <<EOF

# ─── 임베딩 ──────────────────────────────────────────────────────
EMBEDDING_PROVIDER=${EMBEDDING_PROVIDER}
EOF
  [[ -n "$EMBEDDING_API_KEY"    ]] && echo "$(echo "$EMBEDDING_PROVIDER" | tr '[:lower:]' '[:upper:]' | sed 's/OPENAI/OPENAI/;s/GEMINI/GEMINI/')_API_KEY=${EMBEDDING_API_KEY}" >> "$ENV_FILE"
  # provider별 키 이름 처리
  if [[ "$EMBEDDING_PROVIDER" == "openai" ]]; then
    sed -i "s/^OPENAI_API_KEY=.*//" "$ENV_FILE"
    echo "OPENAI_API_KEY=${EMBEDDING_API_KEY}" >> "$ENV_FILE"
  elif [[ "$EMBEDDING_PROVIDER" == "gemini" ]]; then
    sed -i "s/^GEMINI_API_KEY=.*//" "$ENV_FILE"
    echo "GEMINI_API_KEY=${EMBEDDING_API_KEY}" >> "$ENV_FILE"
  elif [[ "$EMBEDDING_PROVIDER" == "custom" ]]; then
    echo "EMBEDDING_BASE_URL=${EMBEDDING_BASE_URL}" >> "$ENV_FILE"
    echo "EMBEDDING_API_KEY=${EMBEDDING_API_KEY}" >> "$ENV_FILE"
  fi
  [[ -n "$EMBEDDING_MODEL"      ]] && echo "EMBEDDING_MODEL=${EMBEDDING_MODEL}" >> "$ENV_FILE"
  [[ -n "$EMBEDDING_DIMENSIONS" ]] && echo "EMBEDDING_DIMENSIONS=${EMBEDDING_DIMENSIONS}" >> "$ENV_FILE"
fi

# provider별 키 중복 라인 정리
sed -i '/^$/d;/^$/d' "$ENV_FILE" 2>/dev/null || true

success ".env 작성 완료"
chmod 600 "$ENV_FILE"

echo

# ── npm install ───────────────────────────────────────────────────
if ask_yn "npm install을 실행하겠습니까?" "y"; then
  info "npm install 실행 중..."
  npm install
  success "패키지 설치 완료"
fi

echo

# ── DB 스키마 ─────────────────────────────────────────────────────
if ask_yn "PostgreSQL 스키마를 적용하겠습니까?" "y"; then
  echo "  1) 신규 설치 (memory-schema.sql)"
  echo "  2) 기존 설치 업그레이드 (migration-001 ~ 006)"
  SCHEMA_CHOICE=$(ask "선택" "1")

  export DATABASE_URL

  if [[ "$SCHEMA_CHOICE" == "1" ]]; then
    info "스키마 적용 중..."
    psql "$DATABASE_URL" -f lib/memory/memory-schema.sql
    success "스키마 적용 완료"
  else
    info "마이그레이션 적용 중..."
    for i in 001 002 003 004 005 006; do
      f="lib/memory/migration-${i}-"*".sql"
      if compgen -G "$f" > /dev/null; then
        psql "$DATABASE_URL" -f $f && success "migration-${i} 완료" || warn "migration-${i} 실패 (이미 적용되었을 수 있음)"
      fi
    done
  fi

  if [[ -n "$EMBEDDING_PROVIDER" ]] && [[ "${EMBEDDING_DIMENSIONS:-0}" -gt 2000 ]]; then
    warn "차원 수 ${EMBEDDING_DIMENSIONS} > 2000 — migration-007이 필요합니다."
    if ask_yn "migration-007을 실행하겠습니까?" "y"; then
      EMBEDDING_DIMENSIONS="$EMBEDDING_DIMENSIONS" DATABASE_URL="$DATABASE_URL" \
        node lib/memory/migration-007-flexible-embedding-dims.js
      success "migration-007 완료"
    fi
  fi

  if [[ -n "$EMBEDDING_PROVIDER" ]]; then
    if ask_yn "기존 벡터 L2 정규화를 실행하겠습니까? (1회성)" "y"; then
      node lib/memory/normalize-vectors.js
      success "L2 정규화 완료"
    fi
  fi
fi

echo
echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${GREEN}${BOLD}  설정 완료. 서버 시작: node server.js${RESET}"
echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo
