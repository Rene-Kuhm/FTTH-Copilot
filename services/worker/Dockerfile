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
# 2. Prisma client stage
#
# `@ftth-copilot/db` generates its Prisma client into `packages/db/src/generated`
# and that output is not committed: the worker imports the db package (through
# the scheduler), so the client has to exist in the image. It is generated here
# — in a stage of its own, where the Prisma CLI is installed — and copied into
# the dependencies stage. The same stage downloads the Prisma query engine, the
# native binary the client needs to talk to Postgres.
# ------------------------------------------------------------------------------
FROM base AS prisma-client
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/db/package.json ./packages/db/package.json
COPY packages/db/prisma ./packages/db/prisma
COPY packages/shared/package.json ./packages/shared/package.json

RUN pnpm install --frozen-lockfile --filter @ftth-copilot/db...
RUN pnpm --filter @ftth-copilot/db exec prisma generate

# ------------------------------------------------------------------------------
# 3. Dependencies stage
#
# Only the worker and the packages it imports are installed — the worker is a
# long-running process, it needs the job queue, the scheduler and the packages
# the scheduler runs on, and nothing else.
#
# The workspace packages ship TypeScript source (there is no compiled dist/),
# so the source of every package in the dependency closure is part of the
# image. The closure of `@ftth-copilot/worker` is:
#
#   worker → { jobs, ingest → { db → shared, monitoring → { alerts →
#   detection, analytics, connectors-core }, scheduler → { db → shared,
#   monitoring → { alerts → detection, analytics, connectors-core }, soc →
#   { alerts, security, db }, analytics, connectors-factory → { db,
#   connectors-{core, smartolt, mikrowisp, mikrotik} } }, security, shared,
#   soc → { alerts, security, db } } }
#
# `--ignore-scripts` keeps the install hermetic: the only native artifact the
# image needs is the Prisma query engine, which is copied from the stage above.
# ------------------------------------------------------------------------------
FROM base AS dependencies
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/jobs/package.json ./packages/jobs/package.json
COPY packages/jobs/src ./packages/jobs/src
COPY packages/ingest/package.json ./packages/ingest/package.json
COPY packages/ingest/src ./packages/ingest/src
COPY packages/scheduler/package.json ./packages/scheduler/package.json
COPY packages/scheduler/src ./packages/scheduler/src
COPY packages/connectors/core/package.json ./packages/connectors/core/package.json
COPY packages/connectors/core/src ./packages/connectors/core/src
COPY packages/connectors/factory/package.json ./packages/connectors/factory/package.json
COPY packages/connectors/factory/src ./packages/connectors/factory/src
COPY packages/connectors/mikrotik/package.json ./packages/connectors/mikrotik/package.json
COPY packages/connectors/mikrotik/src ./packages/connectors/mikrotik/src
COPY packages/connectors/mikrowisp/package.json ./packages/connectors/mikrowisp/package.json
COPY packages/connectors/mikrowisp/src ./packages/connectors/mikrowisp/src
COPY packages/connectors/smartolt/package.json ./packages/connectors/smartolt/package.json
COPY packages/connectors/smartolt/src ./packages/connectors/smartolt/src
# The generated Prisma client is copied from the stage above, so only the
# hand-written sources of the db package are taken from the build context.
COPY packages/db/package.json ./packages/db/package.json
COPY packages/db/src/*.ts ./packages/db/src/
COPY packages/db/prisma ./packages/db/prisma
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/shared/src ./packages/shared/src
COPY packages/monitoring/package.json ./packages/monitoring/package.json
COPY packages/monitoring/src ./packages/monitoring/src
COPY packages/alerts/package.json ./packages/alerts/package.json
COPY packages/alerts/src ./packages/alerts/src
COPY packages/detection/package.json ./packages/detection/package.json
COPY packages/detection/src ./packages/detection/src
COPY packages/analytics/package.json ./packages/analytics/package.json
COPY packages/analytics/src ./packages/analytics/src
COPY packages/soc/package.json ./packages/soc/package.json
COPY packages/soc/src ./packages/soc/src
COPY packages/security/package.json ./packages/security/package.json
COPY packages/security/src ./packages/security/src
COPY packages/investigations/package.json ./packages/investigations/package.json
COPY packages/investigations/src ./packages/investigations/src
COPY packages/evidence/package.json ./packages/evidence/package.json
COPY packages/evidence/src ./packages/evidence/src
COPY packages/agent-core/package.json ./packages/agent-core/package.json
COPY packages/agent-core/src ./packages/agent-core/src
COPY services/worker/package.json ./services/worker/package.json
COPY services/worker/src ./services/worker/src

RUN pnpm install --frozen-lockfile --prod --filter @ftth-copilot/worker... --ignore-scripts
# The Prisma query engine is a native binary that `@prisma/engines` downloads
# in its install script, which `--ignore-scripts` skipped.
COPY --from=prisma-client /app/node_modules/.pnpm/@prisma+engines@*/node_modules/@prisma/engines/ /tmp/prisma-engines/
RUN for dir in /app/node_modules/.pnpm/@prisma+engines@*; do cp -a /tmp/prisma-engines/. "$dir/node_modules/@prisma/engines/"; done

# ------------------------------------------------------------------------------
# 4. Runner stage (minimal, secure, non-root)
# ------------------------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV WORKER_PORT=8081
ENV WORKER_HOST=0.0.0.0

RUN apk add --no-cache libc6-compat openssl wget \
    && addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 worker

# The durable spool directory.
#
# It has to exist in the image, owned by the user the worker runs as: a
# named volume mounted here is initialized from the image's directory, and
# it inherits that ownership. Without it the volume is created owned by root
# and the receiver cannot write a single event into it — every datagram is
# received and dropped with EACCES.
RUN mkdir -p /var/lib/ftth-copilot/spool \
    && chown -R worker:nodejs /var/lib/ftth-copilot/spool \
    && chmod 750 /var/lib/ftth-copilot/spool

COPY --from=dependencies --chown=worker:nodejs /app ./
COPY --from=prisma-client --chown=worker:nodejs \
    /app/packages/db/src/generated ./packages/db/src/generated

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
