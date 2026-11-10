-- CreateTable
CREATE TABLE "EducationNetwork" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PR',
    "type" TEXT NOT NULL DEFAULT 'MUNICIPAL',
    "logoUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EducationNetwork_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserNetwork" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "networkId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'GESTAO_SECRETARIA',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserNetwork_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "School" (
    "id" TEXT NOT NULL,
    "inepCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL DEFAULT 'Ponta Grossa',
    "state" TEXT NOT NULL DEFAULT 'PR',
    "nre" TEXT NOT NULL DEFAULT 'Ponta Grossa',
    "network" TEXT NOT NULL DEFAULT 'ESTADUAL',
    "phone" TEXT,
    "email" TEXT,
    "logoUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "syncTokenHash" TEXT,
    "settingsJson" TEXT,
    "networkId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "School_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "image" TEXT,
    "role" TEXT NOT NULL DEFAULT 'PEDAGOGA',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "schoolId" TEXT,
    "signingPinHash" TEXT,
    "pinCreatedAt" TIMESTAMP(3),
    "pinAttempts" INTEGER NOT NULL DEFAULT 0,
    "pinLockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSchool" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'PEDAGOGA',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSchool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "segment" TEXT NOT NULL,
    "shift" TEXT NOT NULL DEFAULT 'MANHA',
    "schoolId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClassGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Student" (
    "id" TEXT NOT NULL,
    "cgm" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "guardianName" TEXT,
    "phone" TEXT NOT NULL,
    "classGroupId" TEXT NOT NULL,
    "schoolId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isExchangeStudent" BOOLEAN NOT NULL DEFAULT false,
    "isSpecialNeeds" BOOLEAN NOT NULL DEFAULT false,
    "age" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "segment" TEXT NOT NULL DEFAULT 'TODOS',
    "prefixText" TEXT NOT NULL,
    "suffixText" TEXT NOT NULL,
    "isAbsenceRelated" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "schoolId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageLog" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "templateId" TEXT,
    "reasonTitle" TEXT NOT NULL,
    "messageContent" TEXT NOT NULL,
    "phoneUsed" TEXT NOT NULL,
    "sentByUserId" TEXT,
    "sentByName" TEXT NOT NULL,
    "guardianReplied" BOOLEAN NOT NULL DEFAULT false,
    "replyNotes" TEXT,
    "replyCategory" TEXT,
    "repliedAt" TIMESTAMP(3),
    "repliedByUserId" TEXT,
    "deliveryStatus" TEXT NOT NULL DEFAULT 'SENT',
    "deliveryUpdatedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contentHash" TEXT,

    CONSTRAINT "MessageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LowAttendanceRecord" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "attendancePercent" DOUBLE PRECISION NOT NULL,
    "enrollmentDetail" TEXT,
    "actionsTaken" TEXT,
    "serpProtocol" TEXT,
    "serpStatus" TEXT,
    "serpOpenedAt" TIMESTAMP(3),
    "serpDetails" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LowAttendanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "userEmail" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "details" TEXT,
    "ipAddress" TEXT,
    "schoolId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceSnapshot" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "referenceWeek" TEXT NOT NULL,
    "attendancePercent" DOUBLE PRECISION NOT NULL,
    "weeklyPercent" DOUBLE PRECISION,
    "previousWeeklyPercent" DOUBLE PRECISION,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentContact" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kinship" TEXT NOT NULL DEFAULT 'RESPONSAVEL',
    "phone" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "whatsappValid" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AbsenceJustification" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'ATESTADO_MEDICO',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "cidCode" TEXT,
    "notes" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdByEmail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AbsenceJustification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InPersonAttendance" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "attendedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "guardianPresent" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "agreements" TEXT,
    "recordedByName" TEXT NOT NULL,
    "recordedByEmail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InPersonAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PedagogicalMinute" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "ataNumber" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "category" TEXT NOT NULL DEFAULT 'ACOMPANHAMENTO_PEDAGOGICO',
    "isConfidential" BOOLEAN NOT NULL DEFAULT false,
    "attendedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subject" TEXT NOT NULL,
    "rawNotes" TEXT,
    "summary" TEXT NOT NULL,
    "agreementsSummary" TEXT,
    "authorId" TEXT,
    "authorName" TEXT NOT NULL,
    "authorEmail" TEXT NOT NULL,
    "authorRole" TEXT NOT NULL DEFAULT 'PEDAGOGA',
    "authorIp" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "contentHash" TEXT,
    "verificationCode" TEXT,
    "pdfArchiveSha256" TEXT,
    "pdfArchiveGeneratedAt" TIMESTAMP(3),
    "physicalSignedScanData" TEXT,
    "physicalScanStorageKey" TEXT,
    "physicalScanProvider" TEXT,
    "physicalScanMimeType" TEXT,
    "physicalScanSizeBytes" INTEGER,
    "physicalScanSha256" TEXT,
    "physicalScanUploadedAt" TIMESTAMP(3),
    "physicalScanUploadedBy" TEXT,
    "govBrVerified" BOOLEAN NOT NULL DEFAULT false,
    "govBrProtocol" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedByName" TEXT,
    "voidedByEmail" TEXT,
    "voidReason" TEXT,
    "isExtemporaneous" BOOLEAN NOT NULL DEFAULT false,
    "extemporaneousReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PedagogicalMinute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PedagogicalMinuteStudent" (
    "id" TEXT NOT NULL,
    "minuteId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "studentNameSnapshot" TEXT NOT NULL,
    "classNameSnapshot" TEXT,
    "cgmSnapshot" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PedagogicalMinuteStudent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PedagogicalMinuteParticipant" (
    "id" TEXT NOT NULL,
    "minuteId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "studentId" TEXT,
    "name" TEXT NOT NULL,
    "kinship" TEXT,
    "documentType" TEXT,
    "documentNumber" TEXT,
    "documentVerifiedByStaff" BOOLEAN NOT NULL DEFAULT false,
    "phone" TEXT,
    "signatureMode" TEXT NOT NULL DEFAULT 'PENDING',
    "signatureData" TEXT,
    "signedAt" TIMESTAMP(3),
    "signerIp" TEXT,
    "signerUserAgent" TEXT,
    "biometricStrokeData" TEXT,
    "clientTimestampIso" TEXT,
    "refusalReason" TEXT,
    "witnessName" TEXT,
    "mobileSignToken" TEXT,
    "mobileSignExpiresAt" TIMESTAMP(3),
    "biometricVerified" BOOLEAN NOT NULL DEFAULT false,
    "biometricDeviceType" TEXT,
    "biometricAuthTime" TIMESTAMP(3),
    "expectedEmail" TEXT,
    "verifiedEmail" TEXT,
    "verifiedGoogleSub" TEXT,
    "verifiedGoogleName" TEXT,
    "emailVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PedagogicalMinuteParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PedagogicalMinuteAddendum" (
    "id" TEXT NOT NULL,
    "minuteId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorEmail" TEXT NOT NULL,
    "authorIp" TEXT,
    "previousHash" TEXT NOT NULL,
    "addendumHash" TEXT NOT NULL,
    "participantSignatureData" TEXT,
    "participantSignerName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PedagogicalMinuteAddendum_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PedagogicalActionItem" (
    "id" TEXT NOT NULL,
    "minuteId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "responsible" TEXT NOT NULL DEFAULT 'FAMILIA',
    "dueDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "completedAt" TIMESTAMP(3),
    "completedByName" TEXT,
    "completionNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PedagogicalActionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "windowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "EducationNetwork_city_state_idx" ON "EducationNetwork"("city", "state");

-- CreateIndex
CREATE INDEX "EducationNetwork_active_idx" ON "EducationNetwork"("active");

-- CreateIndex
CREATE INDEX "UserNetwork_userId_idx" ON "UserNetwork"("userId");

-- CreateIndex
CREATE INDEX "UserNetwork_networkId_idx" ON "UserNetwork"("networkId");

-- CreateIndex
CREATE UNIQUE INDEX "UserNetwork_userId_networkId_key" ON "UserNetwork"("userId", "networkId");

-- CreateIndex
CREATE UNIQUE INDEX "School_inepCode_key" ON "School"("inepCode");

-- CreateIndex
CREATE INDEX "School_active_idx" ON "School"("active");

-- CreateIndex
CREATE INDEX "School_networkId_idx" ON "School"("networkId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_schoolId_idx" ON "User"("schoolId");

-- CreateIndex
CREATE INDEX "UserSchool_userId_idx" ON "UserSchool"("userId");

-- CreateIndex
CREATE INDEX "UserSchool_schoolId_idx" ON "UserSchool"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "UserSchool_userId_schoolId_key" ON "UserSchool"("userId", "schoolId");

-- CreateIndex
CREATE INDEX "ClassGroup_segment_shift_idx" ON "ClassGroup"("segment", "shift");

-- CreateIndex
CREATE INDEX "ClassGroup_schoolId_idx" ON "ClassGroup"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "ClassGroup_schoolId_name_key" ON "ClassGroup"("schoolId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Student_cgm_key" ON "Student"("cgm");

-- CreateIndex
CREATE INDEX "Student_classGroupId_active_idx" ON "Student"("classGroupId", "active");

-- CreateIndex
CREATE INDEX "Student_name_idx" ON "Student"("name");

-- CreateIndex
CREATE INDEX "Student_schoolId_idx" ON "Student"("schoolId");

-- CreateIndex
CREATE INDEX "Student_schoolId_active_idx" ON "Student"("schoolId", "active");

-- CreateIndex
CREATE INDEX "Student_email_idx" ON "Student"("email");

-- CreateIndex
CREATE INDEX "MessageTemplate_active_segment_idx" ON "MessageTemplate"("active", "segment");

-- CreateIndex
CREATE INDEX "MessageTemplate_isAbsenceRelated_idx" ON "MessageTemplate"("isAbsenceRelated");

-- CreateIndex
CREATE INDEX "MessageTemplate_schoolId_idx" ON "MessageTemplate"("schoolId");

-- CreateIndex
CREATE INDEX "MessageLog_sentAt_idx" ON "MessageLog"("sentAt" DESC);

-- CreateIndex
CREATE INDEX "MessageLog_studentId_sentAt_idx" ON "MessageLog"("studentId", "sentAt" DESC);

-- CreateIndex
CREATE INDEX "MessageLog_studentId_sentAt_deliveryStatus_idx" ON "MessageLog"("studentId", "sentAt" DESC, "deliveryStatus");

-- CreateIndex
CREATE INDEX "MessageLog_guardianReplied_idx" ON "MessageLog"("guardianReplied");

-- CreateIndex
CREATE INDEX "MessageLog_sentByName_idx" ON "MessageLog"("sentByName");

-- CreateIndex
CREATE INDEX "MessageLog_reasonTitle_idx" ON "MessageLog"("reasonTitle");

-- CreateIndex
CREATE INDEX "MessageLog_deliveryStatus_idx" ON "MessageLog"("deliveryStatus");

-- CreateIndex
CREATE INDEX "MessageLog_replyCategory_idx" ON "MessageLog"("replyCategory");

-- CreateIndex
CREATE INDEX "MessageLog_contentHash_idx" ON "MessageLog"("contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "LowAttendanceRecord_studentId_key" ON "LowAttendanceRecord"("studentId");

-- CreateIndex
CREATE INDEX "LowAttendanceRecord_attendancePercent_idx" ON "LowAttendanceRecord"("attendancePercent");

-- CreateIndex
CREATE INDEX "LowAttendanceRecord_studentId_attendancePercent_idx" ON "LowAttendanceRecord"("studentId", "attendancePercent");

-- CreateIndex
CREATE INDEX "LowAttendanceRecord_serpStatus_idx" ON "LowAttendanceRecord"("serpStatus");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_schoolId_idx" ON "AuditLog"("schoolId");

-- CreateIndex
CREATE INDEX "AuditLog_schoolId_createdAt_idx" ON "AuditLog"("schoolId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AttendanceSnapshot_studentId_recordedAt_idx" ON "AttendanceSnapshot"("studentId", "recordedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceSnapshot_studentId_referenceWeek_key" ON "AttendanceSnapshot"("studentId", "referenceWeek");

-- CreateIndex
CREATE INDEX "StudentContact_studentId_isPrimary_idx" ON "StudentContact"("studentId", "isPrimary");

-- CreateIndex
CREATE INDEX "AbsenceJustification_studentId_endDate_idx" ON "AbsenceJustification"("studentId", "endDate" DESC);

-- CreateIndex
CREATE INDEX "AbsenceJustification_startDate_endDate_idx" ON "AbsenceJustification"("startDate", "endDate");

-- CreateIndex
CREATE INDEX "InPersonAttendance_studentId_attendedAt_idx" ON "InPersonAttendance"("studentId", "attendedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "PedagogicalMinute_verificationCode_key" ON "PedagogicalMinute"("verificationCode");

-- CreateIndex
CREATE INDEX "PedagogicalMinute_schoolId_year_status_idx" ON "PedagogicalMinute"("schoolId", "year", "status");

-- CreateIndex
CREATE INDEX "PedagogicalMinute_schoolId_attendedAt_idx" ON "PedagogicalMinute"("schoolId", "attendedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "PedagogicalMinute_schoolId_year_ataNumber_key" ON "PedagogicalMinute"("schoolId", "year", "ataNumber");

-- CreateIndex
CREATE INDEX "PedagogicalMinuteStudent_studentId_createdAt_idx" ON "PedagogicalMinuteStudent"("studentId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "PedagogicalMinuteStudent_minuteId_idx" ON "PedagogicalMinuteStudent"("minuteId");

-- CreateIndex
CREATE UNIQUE INDEX "PedagogicalMinuteStudent_minuteId_studentId_key" ON "PedagogicalMinuteStudent"("minuteId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "PedagogicalMinuteParticipant_mobileSignToken_key" ON "PedagogicalMinuteParticipant"("mobileSignToken");

-- CreateIndex
CREATE INDEX "PedagogicalMinuteParticipant_minuteId_idx" ON "PedagogicalMinuteParticipant"("minuteId");

-- CreateIndex
CREATE INDEX "PedagogicalMinuteParticipant_verifiedEmail_idx" ON "PedagogicalMinuteParticipant"("verifiedEmail");

-- CreateIndex
CREATE INDEX "PedagogicalMinuteAddendum_minuteId_createdAt_idx" ON "PedagogicalMinuteAddendum"("minuteId", "createdAt" ASC);

-- CreateIndex
CREATE INDEX "PedagogicalActionItem_minuteId_idx" ON "PedagogicalActionItem"("minuteId");

-- CreateIndex
CREATE INDEX "PedagogicalActionItem_status_dueDate_idx" ON "PedagogicalActionItem"("status", "dueDate");

-- CreateIndex
CREATE INDEX "RateLimitBucket_expiresAt_idx" ON "RateLimitBucket"("expiresAt");

-- AddForeignKey
ALTER TABLE "UserNetwork" ADD CONSTRAINT "UserNetwork_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserNetwork" ADD CONSTRAINT "UserNetwork_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "EducationNetwork"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "School" ADD CONSTRAINT "School_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "EducationNetwork"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSchool" ADD CONSTRAINT "UserSchool_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSchool" ADD CONSTRAINT "UserSchool_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassGroup" ADD CONSTRAINT "ClassGroup_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_classGroupId_fkey" FOREIGN KEY ("classGroupId") REFERENCES "ClassGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageTemplate" ADD CONSTRAINT "MessageTemplate_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageLog" ADD CONSTRAINT "MessageLog_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageLog" ADD CONSTRAINT "MessageLog_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MessageTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageLog" ADD CONSTRAINT "MessageLog_sentByUserId_fkey" FOREIGN KEY ("sentByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageLog" ADD CONSTRAINT "MessageLog_repliedByUserId_fkey" FOREIGN KEY ("repliedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LowAttendanceRecord" ADD CONSTRAINT "LowAttendanceRecord_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceSnapshot" ADD CONSTRAINT "AttendanceSnapshot_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentContact" ADD CONSTRAINT "StudentContact_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbsenceJustification" ADD CONSTRAINT "AbsenceJustification_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InPersonAttendance" ADD CONSTRAINT "InPersonAttendance_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PedagogicalMinute" ADD CONSTRAINT "PedagogicalMinute_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PedagogicalMinuteStudent" ADD CONSTRAINT "PedagogicalMinuteStudent_minuteId_fkey" FOREIGN KEY ("minuteId") REFERENCES "PedagogicalMinute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PedagogicalMinuteStudent" ADD CONSTRAINT "PedagogicalMinuteStudent_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PedagogicalMinuteParticipant" ADD CONSTRAINT "PedagogicalMinuteParticipant_minuteId_fkey" FOREIGN KEY ("minuteId") REFERENCES "PedagogicalMinute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PedagogicalMinuteAddendum" ADD CONSTRAINT "PedagogicalMinuteAddendum_minuteId_fkey" FOREIGN KEY ("minuteId") REFERENCES "PedagogicalMinute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PedagogicalActionItem" ADD CONSTRAINT "PedagogicalActionItem_minuteId_fkey" FOREIGN KEY ("minuteId") REFERENCES "PedagogicalMinute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

