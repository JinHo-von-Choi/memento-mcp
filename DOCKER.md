# Docker Guide — Memento MCP Server

## Prerequisites

- Docker 19.03+ (with BuildKit) or Docker Desktop
- A PostgreSQL 16+ instance with the `pgvector` extension (0.5.0+)

## Database Setup (one-time)

Before starting the container, initialise the schema on your PostgreSQL server:

```bash
psql -U $POSTGRES_USER -d $POSTGRES_DB -c "CREATE EXTENSION IF NOT EXISTS vector;"
psql -U $POSTGRES_USER -d $POSTGRES_DB -f lib/memory/memory-schema.sql
```

Verify with `\dx` in psql — the HNSW index requires pgvector 0.5.0 or later.

---

## Quick Start (single-platform build)

```bash
# Build
docker build -t memento-mcp .

# Run
docker run -d \
  --name memento-mcp \
  -p 56332:56332 \
  -e POSTGRES_HOST=host.docker.internal \
  -e POSTGRES_PORT=5432 \
  -e POSTGRES_DB=your_db \
  -e POSTGRES_USER=your_user \
  -e POSTGRES_PASSWORD=your_password \
  -e MEMENTO_ACCESS_KEY=your_secret_key \
  memento-mcp
```

## Multi-platform Build & Push to Docker Hub

Build for both `linux/amd64` and `linux/arm64` and push directly to Docker Hub:

```bash
# 1. Create a buildx builder (first time only)
docker buildx create --name memento-builder --use
docker buildx inspect --bootstrap

# 2. Log in to Docker Hub
docker login

# 3. Build & push (replace myaccount with your Docker Hub username)
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --tag myaccount/memento-mcp:latest \
  --tag myaccount/memento-mcp:1.0.1 \
  --push \
  .
```

To build locally without pushing (single platform, loads into local Docker):

```bash
docker buildx build --load -t memento-mcp .
```

---

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `POSTGRES_HOST` | PostgreSQL hostname |
| `POSTGRES_PORT` | PostgreSQL port (default `5432`) |
| `POSTGRES_DB` | Database name |
| `POSTGRES_USER` | Database user |
| `POSTGRES_PASSWORD` | Database password |

### Recommended

| Variable | Description |
|----------|-------------|
| `MEMENTO_ACCESS_KEY` | Bearer token for client auth (empty = auth disabled) |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `56332` | HTTP listen port |
| `SESSION_TTL_MINUTES` | `60` | Session idle timeout |
| `LOG_DIR` | `/var/log/mcp` | Winston log directory |
| `ALLOWED_ORIGINS` | _(empty)_ | Comma-separated CORS origins |
| `REDIS_ENABLED` | `false` | Enable Redis caching |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `REDIS_PASSWORD` | _(empty)_ | Redis password |
| `OPENAI_API_KEY` | _(empty)_ | For L3 embedding search |
| `OPENAI_BASE_URL` | _(empty)_ | Custom OpenAI-compatible API base URL (e.g. LM Studio, Ollama) |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | OpenAI embedding model |
| `EMBEDDING_DIMENSIONS` | `1536` | Embedding vector dimensions (must match model output) |
| `NLI_SERVICE_URL` | _(empty)_ | External NLI service (skips in-process ONNX model) |

You can pass all variables via an env file:

```bash
docker run -d --env-file .env -p 56332:56332 memento-mcp
```

---

## Health Check

The container has a built-in health check that polls the `/health` endpoint every 30 seconds (with a 40-second start-up grace period to allow NLI model preloading).

```bash
docker inspect --format='{{.State.Health.Status}}' memento-mcp
```

## Logs

Application logs are written to `/var/log/mcp` inside the container. Mount a volume to persist them:

```bash
docker run -d \
  -v memento-logs:/var/log/mcp \
  -p 56332:56332 \
  --env-file .env \
  memento-mcp
```

## Monitoring

Prometheus metrics are exposed at `/metrics`:

```bash
curl http://localhost:56332/metrics
```

---

## Docker Compose Example

```yaml
services:
  memento-mcp:
    build: .
    # Or use a pre-built image:
    # image: myaccount/memento-mcp:latest
    ports:
      - "56332:56332"
    environment:
      POSTGRES_HOST: postgres
      POSTGRES_PORT: 5432
      POSTGRES_DB: memento
      POSTGRES_USER: memento
      POSTGRES_PASSWORD: changeme
      MEMENTO_ACCESS_KEY: changeme
    volumes:
      - memento-logs:/var/log/mcp
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped

  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_DB: memento
      POSTGRES_USER: memento
      POSTGRES_PASSWORD: changeme
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./lib/memory/memory-schema.sql:/docker-entrypoint-initdb.d/01-schema.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U memento"]
      interval: 5s
      timeout: 3s
      retries: 5

volumes:
  pgdata:
  memento-logs:
```

Start the full stack:

```bash
docker compose up -d
```

This uses the `pgvector/pgvector:pg16` image which ships with the `vector` extension pre-installed, and mounts the schema SQL into the PostgreSQL init directory so the database is ready on first boot.

---

## MCP Client Configuration

Once the server is running, point your MCP client at it:

```json
{
  "mcpServers": {
    "memento": {
      "type": "http",
      "url": "http://localhost:56332/mcp",
      "headers": {
        "Authorization": "Bearer ${MEMENTO_ACCESS_KEY}"
      }
    }
  }
}
```

For external access, place the service behind a reverse proxy with TLS termination.
