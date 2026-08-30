-- CreateEnum
CREATE TYPE "DeviceKind" AS ENUM ('OLT', 'ONU');

-- CreateEnum
CREATE TYPE "MetricKind" AS ENUM ('RX_POWER_DBM', 'TX_POWER_DBM', 'TEMPERATURE_CELSIUS', 'UPTIME_SECONDS', 'STATUS');

-- CreateTable
CREATE TABLE "metric_samples" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectionId" TEXT,
    "deviceKind" "DeviceKind" NOT NULL,
    "deviceId" TEXT NOT NULL,
    "kind" "MetricKind" NOT NULL,
    "value" DOUBLE PRECISION,
    "valueText" TEXT,
    "sampledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metric_samples_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "metric_samples_tenantId_connectionId_deviceKind_deviceId_kind_sampledAt_idx" ON "metric_samples"("tenantId", "connectionId", "deviceKind", "deviceId", "kind", "sampledAt");

-- CreateIndex
CREATE INDEX "metric_samples_tenantId_sampledAt_idx" ON "metric_samples"("tenantId", "sampledAt");

-- CreateIndex
CREATE INDEX "metric_samples_sampledAt_idx" ON "metric_samples"("sampledAt");

-- AddForeignKey
ALTER TABLE "metric_samples" ADD CONSTRAINT "metric_samples_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_samples" ADD CONSTRAINT "metric_samples_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "nms_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
