-- Shared, atomic rate-limit counters for cost-sensitive API operations.
CREATE TABLE "rate_limit_buckets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rate_limit_buckets_userId_scope_windowStart_key"
    ON "rate_limit_buckets"("userId", "scope", "windowStart");
CREATE INDEX "rate_limit_buckets_expiresAt_idx" ON "rate_limit_buckets"("expiresAt");

ALTER TABLE "rate_limit_buckets"
    ADD CONSTRAINT "rate_limit_buckets_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
