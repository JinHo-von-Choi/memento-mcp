# ---- Build stage: install production dependencies ----
FROM node:22-slim AS deps

WORKDIR /app

COPY package.json package-lock.json ./

# Force CPU-only ONNX Runtime (avoids CUDA 11 build failures).
RUN npm ci --omit=dev --onnxruntime-node-install-cuda=skip

# ---- Runtime stage ----
FROM node:22-slim

LABEL org.opencontainers.image.title="memento-mcp" \
      org.opencontainers.image.description="Fragment-Based Memory MCP Server" \
      org.opencontainers.image.source="https://github.com/anthropics/memento-mcp" \
      org.opencontainers.image.licenses="Apache-2.0"

WORKDIR /app

# Create log directory and a non-root user.
RUN mkdir -p /var/log/mcp /home/mcp/.cache \
    && addgroup --system --gid 1001 mcp \
    && adduser  --system --uid 1001 --ingroup mcp mcp \
    && chown mcp:mcp /var/log/mcp /home/mcp/.cache

# Redirect HuggingFace model cache to a writable directory.
ENV HF_HOME=/home/mcp/.cache/huggingface

# Copy production node_modules from build stage.
COPY --from=deps /app/node_modules ./node_modules

# The @huggingface/transformers package writes a browser-style cache inside its
# own package directory, ignoring HF_HOME.  Pre-create it so the non-root user
# can write to it.
RUN mkdir -p /app/node_modules/@huggingface/transformers/.cache \
    && chown -R mcp:mcp /app/node_modules/@huggingface/transformers/.cache

# Copy application source.
COPY package.json ./
COPY server.js    ./
COPY lib/         ./lib/
COPY config/      ./config/

# Drop to non-root.
USER mcp

EXPOSE 56332

# Health check against the built-in /health endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD node -e "fetch('http://localhost:${PORT||56332}/health').then(r=>{if(!r.ok)throw r.status}).catch(()=>process.exit(1))"

# Graceful shutdown: the server handles SIGTERM.
STOPSIGNAL SIGTERM

CMD ["node", "server.js"]
