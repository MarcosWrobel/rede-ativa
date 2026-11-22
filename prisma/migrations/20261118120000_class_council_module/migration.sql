-- CreateTable (idempotente — Módulo Conselho de Classe e Pós-Conselho)
CREATE TABLE IF NOT EXISTS "ClassCouncilBoard" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "classGroupId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "peerLeaderStudentId" TEXT,
    "peerLeaderName" TEXT,
    "teacherLeaderStudentId" TEXT,
    "teacherLeaderName" TEXT,
    "externalEvalEd1Percent" DOUBLE PRECISION,
    "externalEvalEd2Percent" DOUBLE PRECISION,
    "externalEvalEd3Percent" DOUBLE PRECISION,
    "seatingMapMode" TEXT NOT NULL DEFAULT 'REVEZAMENTO_MENSAL',
    "seatingMapNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClassCouncilBoard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ClassCouncilSubject" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "teacherName" TEXT,
    "teacherEmail" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClassCouncilSubject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ClassCouncilTrimester" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "trimester" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "positivePoints" TEXT,
    "attentionPoints" TEXT,
    "plannedActions" TEXT,
    "postCouncilHeldAt" TIMESTAMP(3),
    "postCouncilAdvances" TEXT,
    "postCouncilWhatWorked" TEXT,
    "postCouncilRecognizedAttitudes" TEXT,
    "postCouncilCriticalSubjects" TEXT,
    "postCouncilPerformanceFactors" TEXT,
    "postCouncilBehaviorAttendance" TEXT,
    "postCouncilWhatToImprove" TEXT,
    "postCouncilHowTeachersCanHelp" TEXT,
    "postCouncilCommitments" TEXT,
    "postCouncilActionItemsJson" TEXT,
    "linkedMinuteId" TEXT,
    "updatedByName" TEXT,
    "updatedByEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClassCouncilTrimester_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "StudentCouncilCard" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "enrollmentStatus" TEXT NOT NULL DEFAULT 'ATIVO',
    "externalEvalEd1Percent" DOUBLE PRECISION,
    "externalEvalEd2Percent" DOUBLE PRECISION,
    "externalEvalEd3Percent" DOUBLE PRECISION,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "hasSensitiveHealthTag" BOOLEAN NOT NULL DEFAULT false,
    "trimester1Opinion" TEXT,
    "trimester2Opinion" TEXT,
    "trimester3Opinion" TEXT,
    "trimester1BelowAvgJson" TEXT,
    "trimester2BelowAvgJson" TEXT,
    "trimester3BelowAvgJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentCouncilCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "StudentCouncilSubjectEntry" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "trimester" INTEGER NOT NULL,
    "descriptorCodes" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "grade" DOUBLE PRECISION,
    "updatedByEmail" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentCouncilSubjectEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ClassCouncilBoard_schoolId_classGroupId_year_key" ON "ClassCouncilBoard"("schoolId", "classGroupId", "year");
CREATE INDEX IF NOT EXISTS "ClassCouncilBoard_schoolId_year_idx" ON "ClassCouncilBoard"("schoolId", "year");
CREATE INDEX IF NOT EXISTS "ClassCouncilBoard_classGroupId_year_idx" ON "ClassCouncilBoard"("classGroupId", "year");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ClassCouncilSubject_boardId_name_key" ON "ClassCouncilSubject"("boardId", "name");
CREATE INDEX IF NOT EXISTS "ClassCouncilSubject_schoolId_boardId_displayOrder_idx" ON "ClassCouncilSubject"("schoolId", "boardId", "displayOrder");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ClassCouncilTrimester_boardId_trimester_key" ON "ClassCouncilTrimester"("boardId", "trimester");
CREATE INDEX IF NOT EXISTS "ClassCouncilTrimester_schoolId_trimester_idx" ON "ClassCouncilTrimester"("schoolId", "trimester");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "StudentCouncilCard_boardId_studentId_key" ON "StudentCouncilCard"("boardId", "studentId");
CREATE INDEX IF NOT EXISTS "StudentCouncilCard_schoolId_studentId_idx" ON "StudentCouncilCard"("schoolId", "studentId");
CREATE INDEX IF NOT EXISTS "StudentCouncilCard_boardId_enrollmentStatus_idx" ON "StudentCouncilCard"("boardId", "enrollmentStatus");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "StudentCouncilSubjectEntry_cardId_subjectId_trimester_key" ON "StudentCouncilSubjectEntry"("cardId", "subjectId", "trimester");
CREATE INDEX IF NOT EXISTS "StudentCouncilSubjectEntry_schoolId_subjectId_trimester_idx" ON "StudentCouncilSubjectEntry"("schoolId", "subjectId", "trimester");
CREATE INDEX IF NOT EXISTS "StudentCouncilSubjectEntry_cardId_trimester_idx" ON "StudentCouncilSubjectEntry"("cardId", "trimester");

-- AddForeignKey (idempotente)
DO $$
BEGIN
  ALTER TABLE "ClassCouncilBoard" ADD CONSTRAINT "ClassCouncilBoard_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "ClassCouncilBoard" ADD CONSTRAINT "ClassCouncilBoard_classGroupId_fkey" FOREIGN KEY ("classGroupId") REFERENCES "ClassGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "ClassCouncilSubject" ADD CONSTRAINT "ClassCouncilSubject_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "ClassCouncilSubject" ADD CONSTRAINT "ClassCouncilSubject_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "ClassCouncilBoard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "ClassCouncilTrimester" ADD CONSTRAINT "ClassCouncilTrimester_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "ClassCouncilTrimester" ADD CONSTRAINT "ClassCouncilTrimester_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "ClassCouncilBoard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "StudentCouncilCard" ADD CONSTRAINT "StudentCouncilCard_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "StudentCouncilCard" ADD CONSTRAINT "StudentCouncilCard_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "ClassCouncilBoard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "StudentCouncilCard" ADD CONSTRAINT "StudentCouncilCard_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "StudentCouncilSubjectEntry" ADD CONSTRAINT "StudentCouncilSubjectEntry_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "StudentCouncilSubjectEntry" ADD CONSTRAINT "StudentCouncilSubjectEntry_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "StudentCouncilCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "StudentCouncilSubjectEntry" ADD CONSTRAINT "StudentCouncilSubjectEntry_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "ClassCouncilSubject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
