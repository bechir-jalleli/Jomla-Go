# packages/db

Drizzle ORM schema, migrations, and RLS policy definitions.

## Purpose
- Central database schema definition using Drizzle
- SQL migration files (reviewed, run with `drizzle-kit`)
- RLS policy helpers (Phase 1)
- Imported as `@repo/db` by `apps/api`

## Rules (from blueprint)
- Every tenant-owned table **must** have `tenant_id NOT NULL` with a composite unique key `(tenant_id, id)`
- Every tenant-owned table **must** have RLS enabled (`ENABLE + FORCE`) with a policy for `app_runtime`
- `app_owner` role is used only for migrations — never in the running application
- `app_runtime` is the application user — DML only, RLS applies
- `app_platform` is used only for platform-level operations (jobs, platform-admin)
- Money columns are `bigint` (millimes), quantity columns are `numeric(12,3)`
- All timestamps use `timestamptz`
- UUIDs are UUIDv7, generated in application code
- No DB schema files yet — they will be created in Phase 1
