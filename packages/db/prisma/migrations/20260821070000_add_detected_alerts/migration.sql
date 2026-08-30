-- CreateEnum
CREATE TYPE "AlertKind" AS ENUM ('predicted_low_signal', 'predicted_high_temperature', 'intermittent_connection', 'frequent_reboots', 'metric_anomaly');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('warning', 'critical');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('open', 'acknowledged', 'resolved');

-- CreateTable
CREATE TABLE "detected_alerts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectionId" TEXT,
    "kind" "AlertKind" NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "deviceKind" "DeviceKind" NOT NULL,
    "deviceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "etaMs" INTEGER,
    "confidence" DOUBLE PRECISION,
    "status" "AlertStatus" NOT NULL DEFAULT 'open',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastNotifiedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "detected_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "detected_alerts_tenantId_connectionId_kind_deviceKind_deviceId_key" ON "detected_alerts"("tenantId", "connectionId", "kind", "deviceKind", "deviceId");

-- CreateIndex
CREATE INDEX "detected_alerts_tenantId_status_lastSeenAt_idx" ON "detected_alerts"("tenantId", "status", "lastSeenAt");

-- AddForeignKey
ALTER TABLE "detected_alerts" ADD CONSTRAINT "detected_alerts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detected_alerts" ADD CONSTRAINT "detected_alerts_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "nms_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
