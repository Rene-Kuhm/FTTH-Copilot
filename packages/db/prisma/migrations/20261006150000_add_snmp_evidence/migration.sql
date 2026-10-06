-- Durable SNMP trap evidence for forensics.
--
-- Policy: normalised non-identifying varbinds in plain text, identifying
-- varbinds (MACs, ONU serials) encrypted at rest, 90 day retention via
-- expiresAt, and cascade delete so offboarding a tenant removes its evidence.
--
-- Note the mapped table name: the Prisma model is SnmpEvidence but the table
-- is snmp_evidence, and SQL only knows the table.
CREATE TABLE "snmp_evidence" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "senderIp" TEXT NOT NULL,
    "snmpVersion" TEXT NOT NULL,
    "pduType" TEXT NOT NULL,
    "trapOid" TEXT NOT NULL,
    "sysUpTime" INTEGER,
    "eventTime" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "varbinds" JSONB NOT NULL,
    "identifyingVarsEncrypted" TEXT,

    CONSTRAINT "snmp_evidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "snmp_evidence_tenantId_evidenceId_key" ON "snmp_evidence"("tenantId", "evidenceId");
CREATE INDEX "snmp_evidence_tenantId_receivedAt_idx" ON "snmp_evidence"("tenantId", "receivedAt");
CREATE INDEX "snmp_evidence_expiresAt_idx" ON "snmp_evidence"("expiresAt");
CREATE INDEX "snmp_evidence_fingerprint_idx" ON "snmp_evidence"("fingerprint");

ALTER TABLE "snmp_evidence" ADD CONSTRAINT "snmp_evidence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
