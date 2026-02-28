## ── Build stage ──────────────────────────────────────────────
FROM oven/bun:1 AS build

WORKDIR /app

# Install all deps (including devDeps for build tooling)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy source and build
COPY . .
RUN bun run build

# Re-install production deps only (drops devDeps)
RUN rm -rf node_modules && bun install --frozen-lockfile --production

## ── Runtime stage ────────────────────────────────────────────
FROM oven/bun:1 AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends sane-utils ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production
ENV SCANIT_CONFIG_DIR=/config

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/examples ./examples
COPY config/00-system.yaml /app/defaults/00-system.yaml
COPY config/scanit.yaml /app/defaults/scanit.yaml
COPY docker/entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh \
  && mkdir -p /config /data/output /data/db

VOLUME ["/config", "/data/output", "/data/db"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:8080/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["/entrypoint.sh"]
