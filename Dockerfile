# Production image for Adel Service. Build does not contact Stripe or a database.
# Runtime secrets come from the host environment, not from this file.

FROM node:22-bookworm-slim AS build
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.33.4 --activate
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/mcp/package.json packages/mcp/package.json
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm install --frozen-lockfile
ARG DATABASE_URL=postgres://build:build@127.0.0.1:5432/build
RUN DATABASE_URL="$DATABASE_URL" SESSION_SECRET=build-time-only-secret-value pnpm build

FROM node:22-bookworm-slim AS runner
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV ADEL_SERVER=1
ENV PORT=3000
ENV UPLOAD_DIR=/data/uploads
COPY --from=build /app /app
RUN mkdir -p /data/uploads \
  && chown -R node:node /app /data/uploads \
  && chmod +x /app/scripts/docker-entrypoint.sh /app/scripts/backup-db.sh
USER node
EXPOSE 3000
ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
CMD ["serve"]
