-- Fase B (Etapa Schema): Pré-flight bloqueante, NOT NULL, índices e FKs compostas.
-- Deve ser executada por app_migrator em conexão direta, em transação única, antes da ativação explícita de políticas RLS.

-- 1. Validação atômica pré-condição (aborta transação sem alterações parciais se houver divergências)
DO $$
DECLARE
  v_null_school_templates bigint;
  v_null_school_logs bigint;
  v_cross_student_cg bigint;
  v_cross_log_student bigint;
  v_cross_log_template bigint;
BEGIN
  SELECT COUNT(*) INTO v_null_school_templates
  FROM public."MessageTemplate"
  WHERE "schoolId" IS NULL;
  IF v_null_school_templates > 0 THEN
    RAISE EXCEPTION 'PREFLIGHT_BLOCKED_PHASE_B: MessageTemplate possui % modelo(s) com schoolId NULL (sem uso, uso cruzado ou pendente de materializacao).', v_null_school_templates;
  END IF;

  SELECT COUNT(*) INTO v_null_school_logs
  FROM public."MessageLog"
  WHERE "schoolId" IS NULL;
  IF v_null_school_logs > 0 THEN
    RAISE EXCEPTION 'PREFLIGHT_BLOCKED_PHASE_B: MessageLog possui % registro(s) com schoolId NULL.', v_null_school_logs;
  END IF;

  SELECT COUNT(*) INTO v_cross_student_cg
  FROM public."Student" st
  INNER JOIN public."ClassGroup" cg ON cg."id" = st."classGroupId"
  WHERE st."schoolId" IS DISTINCT FROM cg."schoolId";
  IF v_cross_student_cg > 0 THEN
    RAISE EXCEPTION 'PREFLIGHT_BLOCKED_PHASE_B: Student -> ClassGroup possui % vínculo(s) entre escolas.', v_cross_student_cg;
  END IF;

  SELECT COUNT(*) INTO v_cross_log_student
  FROM public."MessageLog" ml
  INNER JOIN public."Student" st ON st."id" = ml."studentId"
  WHERE ml."schoolId" IS DISTINCT FROM st."schoolId";
  IF v_cross_log_student > 0 THEN
    RAISE EXCEPTION 'PREFLIGHT_BLOCKED_PHASE_B: MessageLog -> Student possui % vínculo(s) divergente(s).', v_cross_log_student;
  END IF;

  SELECT COUNT(*) INTO v_cross_log_template
  FROM public."MessageLog" ml
  INNER JOIN public."MessageTemplate" tpl ON tpl."id" = ml."templateId"
  WHERE ml."templateId" IS NOT NULL
    AND ml."schoolId" IS DISTINCT FROM tpl."schoolId";
  IF v_cross_log_template > 0 THEN
    RAISE EXCEPTION 'PREFLIGHT_BLOCKED_PHASE_B: MessageLog -> MessageTemplate possui % vínculo(s) divergente(s) ou globais não materializados.', v_cross_log_template;
  END IF;
END
$$;

-- 2. Endurecimento de MessageLog.schoolId e MessageTemplate.schoolId para NOT NULL e índice composto
ALTER TABLE public."MessageTemplate"
  ALTER COLUMN "schoolId" SET NOT NULL;

ALTER TABLE public."MessageLog"
  ALTER COLUMN "schoolId" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "MessageLog_schoolId_sentAt_idx"
  ON public."MessageLog"("schoolId", "sentAt" DESC);

-- 3. Chaves únicas compostas ("schoolId", "id") nas tabelas-alvo
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ClassGroup_schoolId_id_key') THEN
    ALTER TABLE public."ClassGroup"
      ADD CONSTRAINT "ClassGroup_schoolId_id_key" UNIQUE ("schoolId", "id");
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Student_schoolId_id_key') THEN
    ALTER TABLE public."Student"
      ADD CONSTRAINT "Student_schoolId_id_key" UNIQUE ("schoolId", "id");
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MessageTemplate_schoolId_id_key') THEN
    ALTER TABLE public."MessageTemplate"
      ADD CONSTRAINT "MessageTemplate_schoolId_id_key" UNIQUE ("schoolId", "id");
  END IF;
END
$$;

-- 4. Chaves estrangeiras compostas (Student -> ClassGroup, MessageLog -> Student/MessageTemplate)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Student_schoolId_classGroupId_fkey') THEN
    ALTER TABLE public."Student"
      ADD CONSTRAINT "Student_schoolId_classGroupId_fkey"
      FOREIGN KEY ("schoolId", "classGroupId")
      REFERENCES public."ClassGroup"("schoolId", "id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MessageLog_schoolId_studentId_fkey') THEN
    ALTER TABLE public."MessageLog"
      ADD CONSTRAINT "MessageLog_schoolId_studentId_fkey"
      FOREIGN KEY ("schoolId", "studentId")
      REFERENCES public."Student"("schoolId", "id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MessageLog_schoolId_templateId_fkey') THEN
    ALTER TABLE public."MessageLog"
      ADD CONSTRAINT "MessageLog_schoolId_templateId_fkey"
      FOREIGN KEY ("schoolId", "templateId")
      REFERENCES public."MessageTemplate"("schoolId", "id")
      ON DELETE SET NULL ("templateId")
      ON UPDATE CASCADE;
  END IF;
END
$$;
