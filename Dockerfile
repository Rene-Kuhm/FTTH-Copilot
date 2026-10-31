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

# The Edge middleware inlines process.env at build time, so JWT_SECRET has to be
# present here or every session fails verification and protected routes redirect
# to /login even though the Node API accepts the same cookie.
ARG JWT_SECRET
ENV JWT_SECRET=${JWT_SECRET}

COPY --from=dependencies /app ./
ENV NODE_ENV=production

RUN pnpm --filter @ftth-copilot/db db:generate
RUN NEXT_OUTPUT_MODE=standalone pnpm --filter @ftth-copilot/web build

# ------------------------------------------------------------------------------
# 4. Production runner stage (minimal, secure, non-root)
# ------------------------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV NODE_ENV=production
ENV PORT=3001
ENV HOSTNAME="0.0.0.0"

RUN apk add --no-cache libc6-compat openssl wget
RUN corepack enable && corepack prepare pnpm@11.22.0 --activate

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# The durable spool directory.
#
# It has to exist in the image, owned by the user the app runs as: a named
# volume mounted here is initialized from the image's directory and inherits
# that ownership. The worker image creates the same directory with the same
# ownership (both run as uid 1001), so the volume is writable no matter which
# of the two containers initializes it first.
RUN mkdir -p /var/lib/ftth-copilot/spool \
    && chown -R nextjs:nodejs /var/lib/ftth-copilot/spool \
    && chmod 750 /var/lib/ftth-copilot/spool

# Copy Prisma schema and engines for runtime queries
COPY --from=builder /app/packages/db/prisma ./packages/db/prisma

# Copy Next.js standalone bundle and static assets
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs

EXPOSE 3001
EXPOSE 1162/udp
EXPOSE 5514/udp

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3001/api/health || exit 1

CMD ["node", "apps/web/server.js"]
