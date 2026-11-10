-- 1. Backfill de schoolId órfão ou 'default-leopoldina' para o ID real da Escola Piloto Fundadora (INEP 41042730)
DO $$
DECLARE
  v_pilot_school_id TEXT;
BEGIN
  SELECT "id" INTO v_pilot_school_id FROM "School" WHERE "inepCode" = '41042730' LIMIT 1;

  IF v_pilot_school_id IS NULL THEN
    INSERT INTO "School" ("id", "inepCode", "name", "city", "state", "nre", "network", "active", "createdAt", "updatedAt")
    VALUES ('default-leopoldina', '41042730', 'Colégio Estadual Leopoldina B. Pedroso', 'Ponta Grossa', 'PR', 'Ponta Grossa', 'ESTADUAL', true, NOW(), NOW())
    RETURNING "id" INTO v_pilot_school_id;
  END IF;

  -- Tabelas operacionais obrigatórias por unidade escolar
  UPDATE "ClassGroup"
  SET "schoolId" = v_pilot_school_id
  WHERE "schoolId" IS NULL OR ("schoolId" = 'default-leopoldina' AND v_pilot_school_id <> 'default-leopoldina');

  UPDATE "Student"
  SET "schoolId" = v_pilot_school_id
  WHERE "schoolId" IS NULL OR ("schoolId" = 'default-leopoldina' AND v_pilot_school_id <> 'default-leopoldina');

  UPDATE "MessageTemplate"
  SET "schoolId" = v_pilot_school_id
  WHERE "schoolId" IS NULL OR ("schoolId" = 'default-leopoldina' AND v_pilot_school_id <> 'default-leopoldina');

  -- Em AuditLog e User, preserva nulos legítimos (ex.: LOGIN_DENIED pré-autenticação e SuperAdmin global),
  -- convertendo apenas eventual string literal 'default-leopoldina'
  IF v_pilot_school_id <> 'default-leopoldina' THEN
    UPDATE "AuditLog"
    SET "schoolId" = v_pilot_school_id
    WHERE "schoolId" = 'default-leopoldina';

    UPDATE "User"
    SET "schoolId" = v_pilot_school_id
    WHERE "schoolId" = 'default-leopoldina';
  END IF;
END $$;

-- 2. DropForeignKey antigas (SetNull)
ALTER TABLE "ClassGroup" DROP CONSTRAINT "ClassGroup_schoolId_fkey";
ALTER TABLE "MessageTemplate" DROP CONSTRAINT "MessageTemplate_schoolId_fkey";
ALTER TABLE "Student" DROP CONSTRAINT "Student_schoolId_fkey";

-- 3. AlterTable: schoolId NOT NULL + novas flags booleanas persistidas (N3 & N4)
ALTER TABLE "ClassGroup" ALTER COLUMN "schoolId" SET NOT NULL;
ALTER TABLE "MessageTemplate" ALTER COLUMN "schoolId" SET NOT NULL;
ALTER TABLE "Student" ALTER COLUMN "schoolId" SET NOT NULL;

ALTER TABLE "PedagogicalMinute" ADD COLUMN "hasPhysicalScan" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "PedagogicalMinuteParticipant"
  ADD COLUMN "hasActiveSignLink" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "hasSignature" BOOLEAN NOT NULL DEFAULT false;

-- 4. Backfill determinístico das flags booleanas de Atas e Participantes (N3 & N4)
UPDATE "PedagogicalMinute"
SET "hasPhysicalScan" = (
  "physicalSignedScanData" IS NOT NULL
  OR "physicalScanStorageKey" IS NOT NULL
  OR "physicalScanSha256" IS NOT NULL
);

UPDATE "PedagogicalMinuteParticipant"
SET "hasActiveSignLink" = ("mobileSignToken" IS NOT NULL),
    "hasSignature" = ("signatureData" IS NOT NULL OR "verifiedEmail" IS NOT NULL);

-- 5. AddForeignKey estritas (Restrict)
ALTER TABLE "ClassGroup" ADD CONSTRAINT "ClassGroup_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Student" ADD CONSTRAINT "Student_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MessageTemplate" ADD CONSTRAINT "MessageTemplate_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
