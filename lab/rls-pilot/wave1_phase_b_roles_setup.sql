-- Laboratório local: provisionamento de papéis app_migrator e app_runtime para Fase B da Onda 1.
-- Uso exclusivo em banco sintético isolado.
-- As senhas DEVEM ser injetadas de forma efêmera em tempo de execução (placeholders __APP_MIGRATOR_PASSWORD__ e __APP_RUNTIME_PASSWORD__).

DO $$
DECLARE
  v_migrator_pw text := '__APP_MIGRATOR_PASSWORD__';
  v_runtime_pw text := '__APP_RUNTIME_PASSWORD__';
BEGIN
  IF v_migrator_pw = ('__APP_' || 'MIGRATOR_PASSWORD__') OR length(trim(v_migrator_pw)) < 16 THEN
    RAISE EXCEPTION 'ROLE_SETUP_ERROR: senha efêmera de app_migrator não injetada.';
  END IF;
  IF v_runtime_pw = ('__APP_' || 'RUNTIME_PASSWORD__') OR length(trim(v_runtime_pw)) < 16 THEN
    RAISE EXCEPTION 'ROLE_SETUP_ERROR: senha efêmera de app_runtime não injetada.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_migrator') THEN
    EXECUTE format(
      'CREATE ROLE app_migrator LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS',
      v_migrator_pw
    );
  ELSE
    EXECUTE format(
      'ALTER ROLE app_migrator WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS',
      v_migrator_pw
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    EXECUTE format(
      'CREATE ROLE app_runtime LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS',
      v_runtime_pw
    );
  ELSE
    EXECUTE format(
      'ALTER ROLE app_runtime WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS',
      v_runtime_pw
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wave1_lookup_owner') THEN
    CREATE ROLE wave1_lookup_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  ELSE
    ALTER ROLE wave1_lookup_owner WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

GRANT wave1_lookup_owner TO app_migrator;

GRANT USAGE ON SCHEMA public TO app_migrator, app_runtime, wave1_lookup_owner;
GRANT CREATE ON SCHEMA public TO app_migrator, wave1_lookup_owner;

ALTER TABLE public."School" OWNER TO app_migrator;
ALTER TABLE public."ClassGroup" OWNER TO app_migrator;
ALTER TABLE public."Student" OWNER TO app_migrator;
ALTER TABLE public."MessageTemplate" OWNER TO app_migrator;
ALTER TABLE public."MessageLog" OWNER TO app_migrator;
