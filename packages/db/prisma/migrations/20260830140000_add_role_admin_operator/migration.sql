-- The original `init` migration declared the Role enum with only OWNER
-- and MEMBER. The application schema (and role permissions) later grew to
-- include ADMIN and OPERATOR. This migration brings the database enum up to
-- date so Prisma's generated client matches the live schema.
--
-- Postgres 12+ allows ALTER TYPE ... ADD VALUE outside a transaction, which
-- is how Prisma applies enum-value migrations since Prisma 4.
ALTER TYPE "Role" ADD VALUE 'ADMIN';
ALTER TYPE "Role" ADD VALUE 'OPERATOR';
