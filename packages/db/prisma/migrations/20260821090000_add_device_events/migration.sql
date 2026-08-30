-- CreateEnum
CREATE TYPE "DeviceEventCategory" AS ENUM ('auth_failure', 'access', 'config_change', 'other');

-- CreateTable
CREATE TABLE "device_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectionId" TEXT,
    "sourceIp" TEXT,
    "facility" INTEGER,
    "severity" INTEGER,
    "category" "DeviceEventCategory" NOT NULL DEFAULT 'other',
    "message" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "device_events_tenantId_category_occurredAt_idx" ON "device_events"("tenantId", "category", "occurredAt");

-- CreateIndex
CREATE INDEX "device_events_tenantId_occurredAt_idx" ON "device_events"("tenantId", "occurredAt");

-- AddForeignKey
ALTER TABLE "device_events" ADD CONSTRAINT "device_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_events" ADD CONSTRAINT "device_events_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "nms_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
