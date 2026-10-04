#!/bin/bash
set -e

echo "Creating roles..."

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE ROLE app_owner WITH LOGIN NOSUPERUSER NOCREATEROLE NOBYPASSRLS PASSWORD '$POSTGRES_OWNER_PASSWORD';
    CREATE ROLE app_runtime WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '$POSTGRES_RUNTIME_PASSWORD';
    CREATE ROLE app_platform WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '$POSTGRES_PLATFORM_PASSWORD';

    -- Make app_owner the owner of the database so it can create extensions without superuser
    ALTER DATABASE "$POSTGRES_DB" OWNER TO app_owner;
    GRANT CREATE ON DATABASE "$POSTGRES_DB" TO app_owner;
EOSQL

echo "Applying privileges..."
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f /docker-entrypoint-initdb.d/02-privileges.sql
