-- CreateTable
CREATE TABLE "auth_rate_limits" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "auth_rate_limits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auth_rate_limits_key_windowStart_key" ON "auth_rate_limits"("key", "windowStart");

-- CreateIndex
CREATE INDEX "auth_rate_limits_expiresAt_idx" ON "auth_rate_limits"("expiresAt");
