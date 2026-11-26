-- Migração aditiva exclusiva para guarda histórica de vias físicas e registros Gov.br superados em reaberturas
CREATE TABLE IF NOT EXISTS "PedagogicalMinutePhysicalProofHistory" (
    "id" TEXT NOT NULL,
    "minuteId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "contentRevision" INTEGER,
    "scanStorageKey" TEXT,
    "scanProvider" TEXT,
    "scanMimeType" TEXT,
    "scanSizeBytes" INTEGER,
    "scanSha256" TEXT,
    "scanFallbackData" TEXT,
    "uploadedAt" TIMESTAMP(3),
    "uploadedBy" TEXT,
    "govBrVerified" BOOLEAN NOT NULL DEFAULT false,
    "govBrProtocol" TEXT,
    "supersededAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededByRevision" INTEGER NOT NULL,
    "supersededByEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PedagogicalMinutePhysicalProofHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PedagogicalMinutePhysicalProofHistory_minuteId_supersededAt_idx"
    ON "PedagogicalMinutePhysicalProofHistory"("minuteId", "supersededAt");

CREATE INDEX IF NOT EXISTS "PedagogicalMinutePhysicalProofHistory_schoolId_minuteId_idx"
    ON "PedagogicalMinutePhysicalProofHistory"("schoolId", "minuteId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'PedagogicalMinutePhysicalProofHistory_minuteId_fkey'
    ) THEN
        ALTER TABLE "PedagogicalMinutePhysicalProofHistory"
            ADD CONSTRAINT "PedagogicalMinutePhysicalProofHistory_minuteId_fkey"
            FOREIGN KEY ("minuteId") REFERENCES "PedagogicalMinute"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
