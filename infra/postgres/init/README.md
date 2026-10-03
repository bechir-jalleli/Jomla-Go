# infra/postgres/init

This directory will hold PostgreSQL initialization scripts for local development.

## What goes here (Phase 1)

The following will be created in Phase 1:

1. **DB Roles**: `app_owner`, `app_runtime`, `app_platform`
   - `app_owner`: Used only for schema migrations (Drizzle). Has full DDL rights.
   - `app_runtime`: Used by the running application (DML only). RLS applies — cannot bypass.
   - `app_platform`: Used for platform-level jobs and admin operations. Has explicit permissive RLS policies.

2. **RLS Setup**: Row-Level Security will be enabled (`ENABLE + FORCE`) on every tenant-owned table.

## Rules
- No SQL files yet. Do NOT create schema or seed data here during Phase 0.
- In production, the Managed PostgreSQL on DigitalOcean does not grant SUPERUSER or BYPASSRLS — RLS policies must be explicit for `app_platform`.
- Never use `app_owner` in the running application.
