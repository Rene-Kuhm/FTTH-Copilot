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
# 2. Dependencies stage (installs all workspace dependencies)
# ------------------------------------------------------------------------------
FROM base AS dependencies
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY packages/ ./packages/
COPY apps/ ./apps/

RUN pnpm install --frozen-lockfile

# ------------------------------------------------------------------------------
# 3. Builder stage (compiles Prisma client and Next.js standalone)
# ------------------------------------------------------------------------------
FROM base AS builder
WORKDIR /app

COPY --from=dependencies /app ./
ENV NODE_ENV=production

RUN pnpm --filter @ftth-copilot/db db:generate
RUN pnpm --filter @ftth-copilot/web build

# ------------------------------------------------------------------------------
# 4. Production runner stage (minimal, secure, non-root)
# ------------------------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001
ENV HOSTNAME="0.0.0.0"

RUN apk add --no-cache libc6-compat openssl wget

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy Prisma schema and engines for runtime queries
COPY --from=builder /app/packages/db/prisma ./packages/db/prisma

# Copy Next.js standalone bundle and static assets
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

USER nextjs

EXPOSE 3001
EXPOSE 1162/udp
EXPOSE 5514/udp

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3001/api/health || exit 1

CMD ["node", "apps/web/server.js"]
