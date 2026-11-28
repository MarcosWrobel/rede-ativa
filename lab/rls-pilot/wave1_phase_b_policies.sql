-- Fase B (Etapa Ativação Explícita de Políticas RLS):
-- Deve ser executada por app_migrator em conexão direta na janela controlada após wave1_phase_b_schema.sql e wave1_phase_b_resolvers.sql.

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
