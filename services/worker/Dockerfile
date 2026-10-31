# syntax=docker/dockerfile:1

# ------------------------------------------------------------------------------
# 1. Base image with Node.js 22 and pnpm
# ------------------------------------------------------------------------------
FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN apk add --no-cache libc6-compat openssl
RUN corepack enable && corepack prepare pnpm@11.22.0 --activate

# ------------------------------------------------------------------------------
# 2. Dependencies stage
#
# Only the worker and the packages it imports are installed — the worker is a
# long-running process, it needs the job queue and nothing else.
#
# The workspace packages ship TypeScript source (there is no compiled dist/),
# so `packages/jobs/src` is part of the image: the worker imports the queue
# vocabulary and the `defineWorker` helper from there.
#
# `--ignore-scripts` keeps the install hermetic: the worker needs no native
# build step, and the root `postinstall` (Prisma client generation) does not
# apply to this image.
# ------------------------------------------------------------------------------
FROM base AS dependencies
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/jobs/package.json ./packages/jobs/package.json
COPY packages/jobs/src ./packages/jobs/src
COPY services/worker/package.json ./services/worker/package.json
COPY services/worker/src ./services/worker/src

RUN pnpm install --frozen-lockfile --prod --filter @ftth-copilot/worker... --ignore-scripts

# ------------------------------------------------------------------------------
# 3. Runner stage (minimal, secure, non-root)
# ------------------------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV WORKER_PORT=8081
ENV WORKER_HOST=0.0.0.0

RUN apk add --no-cache libc6-compat openssl wget \
    && addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 worker

COPY --from=dependencies --chown=worker:nodejs /app ./

USER worker

# The worker runs from its own package directory: `tsx` is resolved from
# there, and it is the package that declares it as a dependency.
WORKDIR /app/services/worker

EXPOSE 8081

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:8081/healthz || exit 1

# `tsx` runs the TypeScript source directly — the workspace packages have no
# build step, so there is nothing to compile before starting.
CMD ["node", "--import", "tsx", "src/index.ts"]
