-- Fase B (Etapa Ativação Explícita de Políticas RLS e Resolvers Pré-Escola):
-- Deve ser executada por app_migrator em conexão direta após wave1_phase_b_schema.sql e implantação da App Onda 1.

-- 1. Privilégios mínimos de app_runtime e ativação de RLS fail-closed (ENABLE + FORCE)
REVOKE ALL ON public."ClassGroup" FROM PUBLIC;
REVOKE ALL ON public."Student" FROM PUBLIC;
REVOKE ALL ON public."MessageTemplate" FROM PUBLIC;
REVOKE ALL ON public."MessageLog" FROM PUBLIC;

GRANT SELECT ON public."School" TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public."ClassGroup",
  public."Student",
  public."MessageTemplate",
  public."MessageLog"
TO app_runtime;

ALTER TABLE public."ClassGroup" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ClassGroup" FORCE ROW LEVEL SECURITY;

ALTER TABLE public."Student" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Student" FORCE ROW LEVEL SECURITY;

ALTER TABLE public."MessageTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."MessageTemplate" FORCE ROW LEVEL SECURITY;

ALTER TABLE public."MessageLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."MessageLog" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS class_group_tenant_isolation_policy ON public."ClassGroup";
CREATE POLICY class_group_tenant_isolation_policy
  ON public."ClassGroup"
  FOR ALL
  TO app_runtime
  USING (
    NULLIF(current_setting('app.current_school_id', true), '') IS NOT NULL
    AND "schoolId" = NULLIF(current_setting('app.current_school_id', true), '')
  )
  WITH CHECK (
    NULLIF(current_setting('app.current_school_id', true), '') IS NOT NULL
    AND "schoolId" = NULLIF(current_setting('app.current_school_id', true), '')
  );

DROP POLICY IF EXISTS student_tenant_isolation_policy ON public."Student";
CREATE POLICY student_tenant_isolation_policy
  ON public."Student"
  FOR ALL
  TO app_runtime
  USING (
    NULLIF(current_setting('app.current_school_id', true), '') IS NOT NULL
    AND "schoolId" = NULLIF(current_setting('app.current_school_id', true), '')
  )
  WITH CHECK (
    NULLIF(current_setting('app.current_school_id', true), '') IS NOT NULL
    AND "schoolId" = NULLIF(current_setting('app.current_school_id', true), '')
  );

DROP POLICY IF EXISTS message_template_tenant_isolation_policy ON public."MessageTemplate";
CREATE POLICY message_template_tenant_isolation_policy
  ON public."MessageTemplate"
  FOR ALL
  TO app_runtime
  USING (
    NULLIF(current_setting('app.current_school_id', true), '') IS NOT NULL
    AND "schoolId" = NULLIF(current_setting('app.current_school_id', true), '')
  )
  WITH CHECK (
    NULLIF(current_setting('app.current_school_id', true), '') IS NOT NULL
    AND "schoolId" = NULLIF(current_setting('app.current_school_id', true), '')
  );

DROP POLICY IF EXISTS message_log_tenant_isolation_policy ON public."MessageLog";
CREATE POLICY message_log_tenant_isolation_policy
  ON public."MessageLog"
  FOR ALL
  TO app_runtime
  USING (
    NULLIF(current_setting('app.current_school_id', true), '') IS NOT NULL
    AND "schoolId" = NULLIF(current_setting('app.current_school_id', true), '')
  )
  WITH CHECK (
    NULLIF(current_setting('app.current_school_id', true), '') IS NOT NULL
    AND "schoolId" = NULLIF(current_setting('app.current_school_id', true), '')
  );

-- 2. Privilégios e funções SECURITY DEFINER mínimas para fluxos pré-escola da Onda 1
-- (O papel wave1_lookup_owner NOLOGIN NOBYPASSRLS e USAGE no schema public são provisionados em wave1_phase_b_roles_setup.sql.)
REVOKE ALL ON public."Student" FROM wave1_lookup_owner;
REVOKE ALL ON public."MessageLog" FROM wave1_lookup_owner;
GRANT SELECT ("id", "schoolId", "cgm") ON public."Student" TO wave1_lookup_owner;
GRANT SELECT ("id", "schoolId", "studentId", "phoneUsed", "sentAt") ON public."MessageLog" TO wave1_lookup_owner;

DROP POLICY IF EXISTS student_wave1_lookup_owner_policy ON public."Student";
CREATE POLICY student_wave1_lookup_owner_policy
  ON public."Student"
  FOR SELECT
  TO wave1_lookup_owner
  USING (true);

DROP POLICY IF EXISTS message_log_wave1_lookup_owner_policy ON public."MessageLog";
CREATE POLICY message_log_wave1_lookup_owner_policy
  ON public."MessageLog"
  FOR SELECT
  TO wave1_lookup_owner
  USING (true);

-- 2a. Checagem global mínima de CGMs ocupados (sem id, schoolId ou dados pessoais)
CREATE OR REPLACE FUNCTION public.resolve_taken_cgms(p_cgms text[])
RETURNS TABLE("cgm" text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT DISTINCT st."cgm"
  FROM public."Student" st
  WHERE st."cgm" = ANY(p_cgms)
    AND st."cgm" IS NOT NULL;
$$;

ALTER FUNCTION public.resolve_taken_cgms(text[]) OWNER TO wave1_lookup_owner;
REVOKE ALL ON FUNCTION public.resolve_taken_cgms(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_taken_cgms(text[]) TO app_runtime;

-- 2b. Resolução pré-escola mínima do webhook WhatsApp por ID explícito de log
CREATE OR REPLACE FUNCTION public.resolve_whatsapp_webhook_by_log_id(p_log_id text)
RETURNS TABLE(
  "id" text,
  "schoolId" text,
  "studentId" text,
  "phoneUsed" text,
  "studentSchoolId" text,
  "studentCgm" text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    ml."id",
    ml."schoolId",
    ml."studentId",
    ml."phoneUsed",
    st."schoolId" AS "studentSchoolId",
    st."cgm" AS "studentCgm"
  FROM public."MessageLog" ml
  LEFT JOIN public."Student" st ON st."id" = ml."studentId"
  WHERE ml."id" = p_log_id
  LIMIT 1;
$$;

ALTER FUNCTION public.resolve_whatsapp_webhook_by_log_id(text) OWNER TO wave1_lookup_owner;
REVOKE ALL ON FUNCTION public.resolve_whatsapp_webhook_by_log_id(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_whatsapp_webhook_by_log_id(text) TO app_runtime;

-- 2c. Resolução pré-escola mínima do webhook WhatsApp por sufixo de telefone (sem conteúdo ou nome)
CREATE OR REPLACE FUNCTION public.resolve_whatsapp_webhook_by_phone(
  p_phone_suffix text,
  p_cutoff timestamptz,
  p_student_id text DEFAULT NULL,
  p_cgm text DEFAULT NULL
)
RETURNS TABLE(
  "id" text,
  "schoolId" text,
  "studentId" text,
  "studentSchoolId" text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    ml."id",
    ml."schoolId",
    ml."studentId",
    st."schoolId" AS "studentSchoolId"
  FROM public."MessageLog" ml
  LEFT JOIN public."Student" st ON st."id" = ml."studentId"
  WHERE ml."phoneUsed" LIKE '%' || p_phone_suffix
    AND ml."sentAt" >= p_cutoff
    AND (p_student_id IS NULL OR ml."studentId" = p_student_id)
    AND (p_cgm IS NULL OR st."cgm" = p_cgm);
$$;

ALTER FUNCTION public.resolve_whatsapp_webhook_by_phone(text, timestamptz, text, text) OWNER TO wave1_lookup_owner;
REVOKE ALL ON FUNCTION public.resolve_whatsapp_webhook_by_phone(text, timestamptz, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_whatsapp_webhook_by_phone(text, timestamptz, text, text) TO app_runtime;
