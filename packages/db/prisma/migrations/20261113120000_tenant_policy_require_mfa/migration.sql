-- AlterTable
ALTER TABLE "tenant_policies" ADD COLUMN "require_mfa" BOOLEAN NOT NULL DEFAULT false;
