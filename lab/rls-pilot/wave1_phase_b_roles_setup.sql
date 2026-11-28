-- Laboratório local: provisionamento de papéis app_migrator e app_runtime para Fase B da Onda 1.
-- Uso exclusivo em banco sintético isolado (credenciais sintéticas de laboratório).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_migrator') THEN
    CREATE ROLE app_migrator LOGIN PASSWORD 'rls_lab_migrator_pass'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  ELSE
    ALTER ROLE app_migrator WITH LOGIN PASSWORD 'rls_lab_migrator_pass'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime LOGIN PASSWORD 'rls_lab_runtime_pass'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  ELSE
    ALTER ROLE app_runtime WITH LOGIN PASSWORD 'rls_lab_runtime_pass'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO app_migrator, app_runtime;
GRANT CREATE ON SCHEMA public TO app_migrator;

ALTER TABLE public."School" OWNER TO app_migrator;
ALTER TABLE public."ClassGroup" OWNER TO app_migrator;
ALTER TABLE public."Student" OWNER TO app_migrator;
ALTER TABLE public."MessageTemplate" OWNER TO app_migrator;
ALTER TABLE public."MessageLog" OWNER TO app_migrator;
