-- Piloto Técnico Isolado de RLS Multi-Tenant (Onda 1)
-- Executado exclusivamente em banco sintético isolado (NUNCA em prisma/migrations/).
-- Pré-requisito: schema aplicado previamente via `prisma db push --skip-generate`.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime
      LOGIN
      PASSWORD 'rls_pilot_runtime_pass'
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOBYPASSRLS;
  ELSE
    ALTER ROLE app_runtime
      WITH LOGIN PASSWORD 'rls_pilot_runtime_pass' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO app_runtime;
GRANT SELECT ON TABLE "School" TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ClassGroup", "Student", "MessageTemplate", "MessageLog" TO app_runtime;

-- Materializa schoolId em MessageLog exclusivamente no laboratório isolado do piloto
-- usando DEFAULT de transação local para preservar compatibilidade com Prisma Client atual.
ALTER TABLE "MessageLog"
  ADD COLUMN IF NOT EXISTS "schoolId" TEXT;

UPDATE "MessageLog" ml
SET "schoolId" = st."schoolId"
FROM "Student" st
WHERE ml."studentId" = st."id" AND ml."schoolId" IS NULL;

ALTER TABLE "MessageLog"
  ALTER COLUMN "schoolId" SET DEFAULT NULLIF(current_setting('app.current_school_id', true), '');

ALTER TABLE "MessageLog"
  ALTER COLUMN "schoolId" SET NOT NULL;

-- Unicidades compostas para chaves estrangeiras compostas por tenant
ALTER TABLE "ClassGroup"
  DROP CONSTRAINT IF EXISTS "ClassGroup_schoolId_id_key";
ALTER TABLE "ClassGroup"
  ADD CONSTRAINT "ClassGroup_schoolId_id_key" UNIQUE ("schoolId", "id");

ALTER TABLE "Student"
  DROP CONSTRAINT IF EXISTS "Student_schoolId_id_key";
ALTER TABLE "Student"
  ADD CONSTRAINT "Student_schoolId_id_key" UNIQUE ("schoolId", "id");

ALTER TABLE "MessageTemplate"
  DROP CONSTRAINT IF EXISTS "MessageTemplate_schoolId_id_key";
ALTER TABLE "MessageTemplate"
  ADD CONSTRAINT "MessageTemplate_schoolId_id_key" UNIQUE ("schoolId", "id");

-- FKs compostas anti-vínculo cruzado entre escolas
ALTER TABLE "Student"
  DROP CONSTRAINT IF EXISTS "Student_schoolId_classGroupId_fkey";
ALTER TABLE "Student"
  ADD CONSTRAINT "Student_schoolId_classGroupId_fkey"
  FOREIGN KEY ("schoolId", "classGroupId")
  REFERENCES "ClassGroup" ("schoolId", "id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "MessageLog"
  DROP CONSTRAINT IF EXISTS "MessageLog_schoolId_studentId_fkey";
ALTER TABLE "MessageLog"
  ADD CONSTRAINT "MessageLog_schoolId_studentId_fkey"
  FOREIGN KEY ("schoolId", "studentId")
  REFERENCES "Student" ("schoolId", "id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

-- Sintaxe PostgreSQL 15+/16: anula exclusivamente templateId sem zerar schoolId!
ALTER TABLE "MessageLog"
  DROP CONSTRAINT IF EXISTS "MessageLog_schoolId_templateId_fkey";
ALTER TABLE "MessageLog"
  ADD CONSTRAINT "MessageLog_schoolId_templateId_fkey"
  FOREIGN KEY ("schoolId", "templateId")
  REFERENCES "MessageTemplate" ("schoolId", "id")
  ON DELETE SET NULL ("templateId")
  ON UPDATE CASCADE;

-- Políticas Fail-Closed de Row-Level Security nas 4 tabelas do piloto
ALTER TABLE "ClassGroup" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClassGroup" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_class_group_tenant_isolation ON "ClassGroup";
CREATE POLICY rls_class_group_tenant_isolation ON "ClassGroup"
  AS RESTRICTIVE
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

-- É necessário ao menos uma política PERMISSIVE para habilitar acesso ao contexto autorizado,
-- mantida estritamente condicionada à mesma regra fail-closed.
DROP POLICY IF EXISTS rls_class_group_permissive ON "ClassGroup";
CREATE POLICY rls_class_group_permissive ON "ClassGroup"
  AS PERMISSIVE
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

ALTER TABLE "Student" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Student" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_student_tenant_isolation ON "Student";
CREATE POLICY rls_student_tenant_isolation ON "Student"
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

ALTER TABLE "MessageTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MessageTemplate" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_template_tenant_isolation ON "MessageTemplate";
CREATE POLICY rls_template_tenant_isolation ON "MessageTemplate"
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

ALTER TABLE "MessageLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MessageLog" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_message_log_tenant_isolation ON "MessageLog";
CREATE POLICY rls_message_log_tenant_isolation ON "MessageLog"
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
