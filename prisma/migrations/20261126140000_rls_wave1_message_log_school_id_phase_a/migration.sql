-- Fase A da Onda 1 RLS: materialização aditiva de MessageLog.schoolId
-- 1. Adiciona coluna anulável (compatível com escritores anteriores durante a transição)
ALTER TABLE "MessageLog"
  ADD COLUMN IF NOT EXISTS "schoolId" TEXT;

-- 2. Backfill a partir de Student.schoolId somente onde MessageLog.schoolId está nulo
-- Valores já preenchidos são preservados intactos; divergências são reportadas pelo pré-flight.
UPDATE "MessageLog" ml
SET "schoolId" = st."schoolId"
FROM "Student" st
WHERE ml."studentId" = st."id"
  AND ml."schoolId" IS NULL
  AND st."schoolId" IS NOT NULL;

-- 3. Índice previsto no ADR-001 para consultas por escola ordenadas por sentAt DESC
CREATE INDEX IF NOT EXISTS "MessageLog_schoolId_sentAt_idx"
  ON "MessageLog"("schoolId", "sentAt" DESC);

-- 4. FK simples anulável para School (NOT NULL e FKs compostas ficam para a Fase B)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'MessageLog_schoolId_fkey'
  ) THEN
    ALTER TABLE "MessageLog"
      ADD CONSTRAINT "MessageLog_schoolId_fkey"
      FOREIGN KEY ("schoolId") REFERENCES "School"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;
