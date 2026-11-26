-- Migração aditiva exclusiva para atas pedagógicas: vínculo de assinatura à revisão de conteúdo
ALTER TABLE "PedagogicalMinute"
  ADD COLUMN IF NOT EXISTS "contentRevision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "physicalScanRevision" INTEGER,
  ADD COLUMN IF NOT EXISTS "physicalScanSupersededAt" TIMESTAMP(3);

ALTER TABLE "PedagogicalMinuteParticipant"
  ADD COLUMN IF NOT EXISTS "mobileSignRevision" INTEGER,
  ADD COLUMN IF NOT EXISTS "signedRevision" INTEGER;
