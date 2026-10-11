# Database & Migrations Workflow

This document defines the rules and operational procedures for database migrations and schema management in Jomla Go.

---

## 1. Roles & Connection Policy

| Role | Purpose | Env Variable | Notes |
|---|---|---|---|
| `app_owner` | Owns DB objects, runs migrations only | `DATABASE_MIGRATOR_URL` | Never used by application or tests |
| `app_runtime` | API at runtime, integration tests | `DATABASE_URL` / `DATABASE_TEST_URL` | Tenant-scoped access only, NOSUPERUSER, NOBYPASSRLS, not table owner |
| `app_platform` | Platform-level operations (tenancy, auth, jobs) | `DATABASE_PLATFORM_URL` | Direct access to platform tables only |
| `postgres` | Superuser, container init only | *(not exported)* | **Never used by application code, tests, or migrations** |

**Strict rule:** Any test or application code that connects as `postgres` or `app_owner` is a bug. Tests guard this with a `SELECT current_user` check at startup.

### Platform Tables Isolation & In-Memory Cache
- **Mandatory REVOKE on Platform Tables:** Default privileges grant `app_runtime` DML permissions on newly created tables. Every new platform table (e.g. `tenants`, `tenant_domains`) **must** have an explicit forward migration executing `REVOKE ALL ON TABLE <name> FROM app_runtime` and `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE <name> TO app_platform`.
- **Tenant Status & Cache Invalidation:** The `TenantResolverService` caches positive resolutions in memory for 60 seconds (BP §17). Consequently, tenant suspensions or domain updates may take up to 60 seconds to take effect across the cluster until cache expires (a future enhancement will allow CLI cache purging via Pub/Sub or RPC).
- **Reverse Proxy Header Security (`TRUST_TENANT_HOST_HEADER`):** Setting `TRUST_TENANT_HOST_HEADER=true` is secure **strictly and only if** the API container is not published or reachable outside the internal Docker network (i.e. only the Caddy reverse proxy can reach the API and Caddy unconditionally sanitizes and overwrites `X-Tenant-Host`). If the API port is exposed directly to clients or untrusted networks, `TRUST_TENANT_HOST_HEADER` must remain `false` to prevent host spoofing vulnerabilities.

---

## 2. Migration Immutability & Git Rules
- **Reviewed and Committed**: Every migration SQL file is reviewed, validated against schema snapshots, and committed to Git.
- **Never Modify Merged Migrations**: Once a migration is merged into `main`, its SQL file and corresponding snapshot in `packages/db/migrations/meta/` are strictly immutable. Never edit, reorder, or delete existing migration files.
- **No `drizzle-kit push`**: Schema push is strictly forbidden. All schema changes must go through versioned migrations (`pnpm db:generate` / `pnpm db:generate:custom` and `pnpm db:migrate`).

---

## 3. No Automatic Rollback
- Drizzle ORM does not support automatic rollbacks (`down` migrations).
- Migrations are strictly forward-only.

---

## 4. Local Development Recovery
- When local schema diverges or needs a clean slate during development:
  1. Tear down volumes and rebuild:
     ```bash
     docker compose -f infra/docker-compose.dev.yml down -v
     docker compose -f infra/docker-compose.dev.yml --env-file .env up -d
     pnpm db:migrate
     ```
  2. Or use the guarded local reset script:
     ```bash
     pnpm db:reset
     ```

---

## 5. Production Bug Fixes & Schema Corrections
- In production (or shared environments), never alter applied migrations or database history manually.
- If a migration contains a defect or needs adjustment, create a **new forward migration** that corrects the state:
  - Generate a new migration (`pnpm db:generate` or `pnpm db:generate:custom`).
  - Review the new migration SQL.
  - Apply forward via `pnpm db:migrate`.

---

## 6. Non-Destructive Changes Policy (Expand / Contract)
- **No Destructive Changes Without Explicit Human Approval**: Dropping columns, dropping tables, or altering column types that may lose data requires prior explicit approval.
- Follow the **Expand / Contract** pattern for schema evolutions:
  1. **Expand**: Add new columns/tables (nullable or with defaults) alongside existing ones.
  2. **Transition**: Update application code to write to both, read from the new.
  3. **Contract**: Backfill existing rows, switch reads entirely, and only after validation drop deprecated elements with explicit approval.

---

## 7. CI Pipeline Database Workflow

The CI pipeline (`.github/workflows/ci.yml`) strictly enforces role separation:

1. **Role Provisioning**:
   - PostgreSQL service starts in CI.
   - `infra/postgres/init/01-roles.sh` runs using the superuser `postgres` to create `app_owner`, `app_runtime`, and `app_platform`, set ownership, and apply baseline privileges (`02-privileges.sql`).
2. **Schema Migration Execution**:
   - `pnpm db:migrate` runs strictly using `DATABASE_MIGRATOR_URL` as `app_owner`.
   - The superuser `postgres` is **never** used to execute migrations.
3. **Automated Test Execution**:
   - `pnpm test` runs strictly using `DATABASE_TEST_URL` as `app_runtime`.
   - Tests verify that connection identity is `app_runtime` and assert tenant isolation under RLS.

