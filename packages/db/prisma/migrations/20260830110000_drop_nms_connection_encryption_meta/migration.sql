-- Drop the redundant IV column. The IV is already embedded inside the
-- AES-256-GCM blob stored in "encryptedKey", so "encryptionMeta" was dead data.
ALTER TABLE "nms_connections" DROP COLUMN "encryptionMeta";
