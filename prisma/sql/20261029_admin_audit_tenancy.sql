-- Run after `npm run db:deploy`, BEFORE deploying the tenant-scoped admin code.
-- Idempotent: Prisma db push may already have created the column/index/FK.
-- Legacy rows are attributed only when their author has an unambiguous current
-- school. System/orphan rows remain NULL and are intentionally invisible.
BEGIN;

ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "schoolId" TEXT;

UPDATE "audit_logs" AS audit
SET "schoolId" = actor."schoolId"
FROM "users" AS actor
WHERE audit."userId" = actor."id"
  AND audit."schoolId" IS NULL
  AND actor."schoolId" IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.audit_logs'::regclass
      AND conname = 'audit_logs_schoolId_fkey'
  ) THEN
    ALTER TABLE "audit_logs"
      ADD CONSTRAINT "audit_logs_schoolId_fkey"
      FOREIGN KEY ("schoolId") REFERENCES "schools"("id")
      ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "audit_logs_schoolId_createdAt_idx"
  ON "audit_logs"("schoolId", "createdAt");

COMMIT;
