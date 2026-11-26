-- Migração aditiva: sigilo de origem no histórico de vias físicas, variantes anteriores de nomes por estudante e transferência idempotente de anexos superados na Rodada 6

ALTER TABLE "PedagogicalMinutePhysicalProofHistory"
  ADD COLUMN IF NOT EXISTS "originIsConfidential" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "originAuthorId" TEXT,
  ADD COLUMN IF NOT EXISTS "originAuthorEmail" TEXT;

ALTER TABLE "PedagogicalMinutePhysicalProofHistory"
  ALTER COLUMN "supersededByRevision" DROP NOT NULL;

ALTER TABLE "PedagogicalMinuteStudent"
  ADD COLUMN IF NOT EXISTS "previousNameSnapshots" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Arquiva de forma transacional e idempotente anexos superados no formato da Rodada 6 cujo original ainda reside em PedagogicalMinute
WITH candidates AS (
  SELECT
    m."id" AS "minuteId",
    m."schoolId",
    m."physicalScanRevision",
    m."physicalScanStorageKey",
    m."physicalScanProvider",
    m."physicalScanMimeType",
    m."physicalScanSizeBytes",
    m."physicalScanSha256",
    m."physicalSignedScanData",
    m."physicalScanUploadedAt",
    m."physicalScanUploadedBy",
    m."govBrVerified",
    m."govBrProtocol",
    m."physicalScanSupersededAt"
  FROM "PedagogicalMinute" m
  WHERE m."physicalScanSupersededAt" IS NOT NULL
    AND (
      m."hasPhysicalScan" = true
      OR m."physicalSignedScanData" IS NOT NULL
      OR m."physicalScanStorageKey" IS NOT NULL
      OR m."physicalScanSha256" IS NOT NULL
      OR m."govBrVerified" = true
    )
),
inserted AS (
  INSERT INTO "PedagogicalMinutePhysicalProofHistory" (
    "id",
    "minuteId",
    "schoolId",
    "contentRevision",
    "originIsConfidential",
    "originAuthorId",
    "originAuthorEmail",
    "scanStorageKey",
    "scanProvider",
    "scanMimeType",
    "scanSizeBytes",
    "scanSha256",
    "scanFallbackData",
    "uploadedAt",
    "uploadedBy",
    "govBrVerified",
    "govBrProtocol",
    "supersededAt",
    "supersededByRevision",
    "supersededByEmail"
  )
  SELECT
    'r6-backfill-' || c."minuteId",
    c."minuteId",
    c."schoolId",
    c."physicalScanRevision",
    NULL,
    NULL,
    NULL,
    c."physicalScanStorageKey",
    c."physicalScanProvider",
    c."physicalScanMimeType",
    c."physicalScanSizeBytes",
    c."physicalScanSha256",
    c."physicalSignedScanData",
    c."physicalScanUploadedAt",
    c."physicalScanUploadedBy",
    c."govBrVerified",
    c."govBrProtocol",
    c."physicalScanSupersededAt",
    NULL,
    NULL
  FROM candidates c
  WHERE NOT EXISTS (
    SELECT 1
    FROM "PedagogicalMinutePhysicalProofHistory" h
    WHERE h."minuteId" = c."minuteId"
      AND h."supersededAt" = c."physicalScanSupersededAt"
      AND h."scanSha256" IS NOT DISTINCT FROM c."physicalScanSha256"
      AND h."scanStorageKey" IS NOT DISTINCT FROM c."physicalScanStorageKey"
  )
  ON CONFLICT ("id") DO NOTHING
  RETURNING "minuteId"
)
UPDATE "PedagogicalMinute" m
SET
  "hasPhysicalScan" = false,
  "physicalSignedScanData" = NULL,
  "physicalScanStorageKey" = NULL,
  "physicalScanProvider" = NULL,
  "physicalScanMimeType" = NULL,
  "physicalScanSizeBytes" = NULL,
  "physicalScanSha256" = NULL,
  "physicalScanUploadedAt" = NULL,
  "physicalScanUploadedBy" = NULL,
  "physicalScanRevision" = NULL,
  "govBrVerified" = false,
  "govBrProtocol" = NULL
FROM candidates c
WHERE m."id" = c."minuteId"
  AND (
    c."minuteId" IN (SELECT "minuteId" FROM inserted)
    OR EXISTS (
      SELECT 1
      FROM "PedagogicalMinutePhysicalProofHistory" h
      WHERE h."minuteId" = c."minuteId"
        AND h."supersededAt" = c."physicalScanSupersededAt"
        AND h."scanSha256" IS NOT DISTINCT FROM c."physicalScanSha256"
        AND h."scanStorageKey" IS NOT DISTINCT FROM c."physicalScanStorageKey"
    )
  );
