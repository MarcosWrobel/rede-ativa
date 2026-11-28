-- Laboratório local: resolução pública de Atas por código com app_runtime sob FORCE RLS.
-- Uso exclusivo em banco sintético isolado (não aplicar em migrations de aplicação/produção).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime LOGIN PASSWORD 'rls_lab_runtime_pass'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  ELSE
    ALTER ROLE app_runtime WITH LOGIN PASSWORD 'rls_lab_runtime_pass'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_other_consumer') THEN
    CREATE ROLE app_other_consumer LOGIN PASSWORD 'rls_lab_other_pass'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  ELSE
    ALTER ROLE app_other_consumer WITH LOGIN PASSWORD 'rls_lab_other_pass'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ata_public_lookup_owner') THEN
    CREATE ROLE ata_public_lookup_owner NOLOGIN
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  ELSE
    ALTER ROLE ata_public_lookup_owner WITH NOLOGIN
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO app_runtime, app_other_consumer, ata_public_lookup_owner;

REVOKE ALL ON public."PedagogicalMinute" FROM PUBLIC, app_runtime, app_other_consumer, ata_public_lookup_owner;
REVOKE ALL ON public."PedagogicalMinuteStudent" FROM PUBLIC, app_runtime, app_other_consumer, ata_public_lookup_owner;
REVOKE ALL ON public."PedagogicalMinuteParticipant" FROM PUBLIC, app_runtime, app_other_consumer, ata_public_lookup_owner;
REVOKE ALL ON public."PedagogicalActionItem" FROM PUBLIC, app_runtime, app_other_consumer, ata_public_lookup_owner;
REVOKE ALL ON public."PedagogicalMinuteAddendum" FROM PUBLIC, app_runtime, app_other_consumer, ata_public_lookup_owner;

GRANT SELECT ON public."School" TO app_runtime;
GRANT SELECT ON
  public."PedagogicalMinute",
  public."PedagogicalMinuteStudent",
  public."PedagogicalMinuteParticipant",
  public."PedagogicalActionItem",
  public."PedagogicalMinuteAddendum"
TO app_runtime;

-- Privilégio mínimo por coluna para a role proprietária da função SECURITY DEFINER
GRANT SELECT ("id", "schoolId", "verificationCode")
  ON public."PedagogicalMinute"
  TO ata_public_lookup_owner;

ALTER TABLE public."PedagogicalMinute" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PedagogicalMinute" FORCE ROW LEVEL SECURITY;

ALTER TABLE public."PedagogicalMinuteStudent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PedagogicalMinuteStudent" FORCE ROW LEVEL SECURITY;

ALTER TABLE public."PedagogicalMinuteParticipant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PedagogicalMinuteParticipant" FORCE ROW LEVEL SECURITY;

ALTER TABLE public."PedagogicalActionItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PedagogicalActionItem" FORCE ROW LEVEL SECURITY;

ALTER TABLE public."PedagogicalMinuteAddendum" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PedagogicalMinuteAddendum" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pedagogical_minute_public_lookup_policy ON public."PedagogicalMinute";
CREATE POLICY pedagogical_minute_public_lookup_policy
  ON public."PedagogicalMinute"
  FOR SELECT
  TO ata_public_lookup_owner
  USING ("verificationCode" IS NOT NULL);

DROP POLICY IF EXISTS pedagogical_minute_tenant_isolation_policy ON public."PedagogicalMinute";
CREATE POLICY pedagogical_minute_tenant_isolation_policy
  ON public."PedagogicalMinute"
  FOR SELECT
  TO app_runtime
  USING (
    NULLIF(current_setting('app.current_school_id', true), '') IS NOT NULL
    AND "schoolId" = NULLIF(current_setting('app.current_school_id', true), '')
  );

DROP POLICY IF EXISTS pedagogical_minute_student_tenant_isolation_policy ON public."PedagogicalMinuteStudent";
CREATE POLICY pedagogical_minute_student_tenant_isolation_policy
  ON public."PedagogicalMinuteStudent"
  FOR SELECT
  TO app_runtime
  USING (
    NULLIF(current_setting('app.current_school_id', true), '') IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public."PedagogicalMinute" pm
      WHERE pm."id" = "minuteId"
        AND pm."schoolId" = NULLIF(current_setting('app.current_school_id', true), '')
    )
  );

DROP POLICY IF EXISTS pedagogical_minute_participant_tenant_isolation_policy ON public."PedagogicalMinuteParticipant";
CREATE POLICY pedagogical_minute_participant_tenant_isolation_policy
  ON public."PedagogicalMinuteParticipant"
  FOR SELECT
  TO app_runtime
  USING (
    NULLIF(current_setting('app.current_school_id', true), '') IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public."PedagogicalMinute" pm
      WHERE pm."id" = "minuteId"
        AND pm."schoolId" = NULLIF(current_setting('app.current_school_id', true), '')
    )
  );

DROP POLICY IF EXISTS pedagogical_action_item_tenant_isolation_policy ON public."PedagogicalActionItem";
CREATE POLICY pedagogical_action_item_tenant_isolation_policy
  ON public."PedagogicalActionItem"
  FOR SELECT
  TO app_runtime
  USING (
    NULLIF(current_setting('app.current_school_id', true), '') IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public."PedagogicalMinute" pm
      WHERE pm."id" = "minuteId"
        AND pm."schoolId" = NULLIF(current_setting('app.current_school_id', true), '')
    )
  );

DROP POLICY IF EXISTS pedagogical_minute_addendum_tenant_isolation_policy ON public."PedagogicalMinuteAddendum";
CREATE POLICY pedagogical_minute_addendum_tenant_isolation_policy
  ON public."PedagogicalMinuteAddendum"
  FOR SELECT
  TO app_runtime
  USING (
    NULLIF(current_setting('app.current_school_id', true), '') IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public."PedagogicalMinute" pm
      WHERE pm."id" = "minuteId"
        AND pm."schoolId" = NULLIF(current_setting('app.current_school_id', true), '')
    )
  );

CREATE OR REPLACE FUNCTION public.resolve_public_ata_by_code(p_code text)
RETURNS TABLE ("id" text, "schoolId" text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT pm."id", pm."schoolId"
  FROM public."PedagogicalMinute" AS pm
  WHERE p_code IS NOT NULL
    AND btrim(p_code) <> ''
    AND pm."verificationCode" = p_code
  LIMIT 1;
$$;

ALTER FUNCTION public.resolve_public_ata_by_code(text)
  OWNER TO ata_public_lookup_owner;

REVOKE ALL ON FUNCTION public.resolve_public_ata_by_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_public_ata_by_code(text) TO app_runtime;
