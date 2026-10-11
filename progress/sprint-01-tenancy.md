# Sprint 01: Tenancy + DB Core

**Status:** Planned (Sprint 00 still Active)
**Goal:** Local DB roles, extensions, migration tooling, baseline migration; then tenants/RLS.

---

## Scope

| # | Task | Status |
|---|---|---|
| 1 | Local DB roles, extensions, migration tooling, baseline migration | Done |
| 2 | Tenants table, TenantDb context, Tenant Resolver, Middleware | Done |

---

## Definition of Done

- [ ] Tests written and passing (isolation tests once tenant tables exist)
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build` green
- [ ] Security checklist (AGENTS.md §5) passed
- [ ] No new dependency without approval
- [ ] Active sprint file updated
- [ ] Committed with Conventional Commits

---

## Progress Summary

**Task 1 — DB infrastructure:** Setup complete and verified. Not yet committed.

**Files created/changed:**
- `infra/postgres/init/01-roles.sh` — creates 3 roles, makes app_owner DB owner
- `infra/postgres/init/02-privileges.sql` — re-runnable privileges (used by init AND db:reset)
- `infra/docker-compose.dev.yml` — passes role passwords; port 5433:5432
- `.env.example` — all connection string placeholders, no secrets
- `.env` — dev credentials (not committed); uses 127.0.0.1:5433
- `packages/db/drizzle.config.ts` — uses DATABASE_MIGRATOR_URL (app_owner)
- `packages/db/package.json` — db:generate, db:migrate, db:reset via node --env-file
- `packages/db/scripts/db-reset.js` — drops/recreates DB, re-applies privileges, runs migrations; guarded to localhost + non-production
- `packages/db/migrations/0000_worried_raider.sql` — baseline: 4 CREATE EXTENSION IF NOT EXISTS
- `packages/db/src/schema/index.ts` — empty placeholder (required by drizzle-kit)
- `packages/db/README.md` — roles, connections, scripts, expand/contract rule
- `package.json` (root) — added db:generate, db:migrate, db:reset
- `.gitattributes` — added `infra/postgres/init/*.sh text eol=lf`

---

## Session Log

### Session 1 — 2026-10-04

**A. Corrections applied:**
1. Removed TRUNCATE from app_platform in 02-privileges.sql. No runtime role may TRUNCATE (bypasses RLS).
2. Ran `git add infra/postgres/init/01-roles.sh` — confirmed 17 real lines, not empty blob.
3. .gitattributes already has `* text=auto eol=lf`; added explicit `infra/postgres/init/*.sh text eol=lf` too.
4. Enforced LF endings in-place on .sh and .sql before container restart.
5. Port 5432 was in use locally; compose now exposes 5433:5432.

**B. Verification — real command output:**

**B1. Docker healthy:**
```
Container jomla_postgres_dev  Started
Up 14 seconds (healthy)   0.0.0.0:5433->5432/tcp
```

**B2. Roles (\du) — all three: no Superuser, no Bypass RLS:**
```
  Role name   |                         Attributes
--------------+------------------------------------------------------------
 app_owner    |
 app_platform |
 app_runtime  |
 postgres     | Superuser, Create role, Create DB, Replication, Bypass RLS
```
No attributes on the three app roles = NOSUPERUSER, NOBYPASSRLS. PASS

Database owner (\l jomla_dev):
```
   Name    |   Owner   | Access privileges
-----------+-----------+-------------------------
 jomla_dev | app_owner | =Tc/app_owner
           |           | app_owner=CTc/app_owner
```
app_owner owns the database. PASS

**B3. \dx after first migration:**
```
   Name    | Version |   Schema
-----------+---------+------------
 btree_gin | 1.3     | public
 citext    | 1.6     | public
 pg_trgm   | 1.6     | public
 plpgsql   | 1.0     | pg_catalog
 unaccent  | 1.1     | public
```
All 4 required extensions present. PASS

**B4. Privilege tests (app_owner creates TABLE test):**

| Operation | Role | Result |
|---|---|---|
| SELECT * FROM test | app_runtime | (0 rows) PASS |
| INSERT INTO test VALUES (1) | app_runtime | INSERT 0 1 PASS |
| TRUNCATE test | app_runtime | ERROR: permission denied PASS |
| CREATE TABLE test2 | app_runtime | ERROR: permission denied for schema public PASS |
| DROP TABLE test | app_runtime | ERROR: must be owner of table test PASS |
| TRUNCATE test | app_platform | ERROR: permission denied PASS |
| DROP TABLE test | app_owner | DROP TABLE PASS |

**B5. pnpm db:migrate (run 1):** `[✓] migrations applied successfully!`
**pnpm db:migrate (run 2 — idempotency):** `[✓] migrations applied successfully!`

Drizzle migrations table:
```
 id |               hash                               |  created_at
----+--------------------------------------------------+---------------
  1 | 143eba645a9c2058125137fbd2a20a833d3fe2a4aae092d1756f1ab566fe4566 | 1791152704372
```
PASS

**B6. pnpm db:reset:**
```
Dropping and recreating database jomla_dev...
Applying privileges...
Running migrations...
[✓] migrations applied successfully!
Reset complete.
```
pnpm db:migrate after reset: `[✓] migrations applied successfully!`
Privileges after reset: TRUNCATE denied for app_runtime and app_platform, INSERT/SELECT work. PASS

**B7. pnpm lint:** all packages Done PASS
**pnpm typecheck:** all packages Done PASS
**pnpm build:** Next.js compiled successfully in 17.7s; nest build PASS
**pnpm test:** 1 KNOWN FAILURE — AppController (pre-existing NestJS DI issue, not caused by this task)

### Session 2 — 2026-10-11

1. **RLS Verification Suite (`rls-probe.spec.ts`)**:
   - 7 test cases covering isolation, zero rows without tenant context, WITH CHECK (42501), transaction boundary isolation, table ownership (`app_owner`), and `relrowsecurity` + `relforcerowsecurity` via `'public.rls_probe'::regclass`.
   - Seeding moved to `beforeAll`, avoiding inter-test order dependency.
   - Fixed NestJS DI `import type` issue in `app.controller.ts`, making `apps/api` test green.
2. **Adverse Test (Inverted RLS Check)**:
   - Disabled RLS via `psql` as `app_owner`: cases (a), (b), (c), (d), (e), and (g) failed as expected.
   - Re-enabled and forced RLS: all 7 tests passed green.
3. **Clean Slate Verification**:
   - `docker compose down -v`, rebuild, `db:migrate`, `pnpm test`: all green from zero.
4. **CI & Docs**:
   - Documented CI role separation in `docs/database.md` and verified `.github/workflows/ci.yml`.
   - Full workspace `lint`, `typecheck`, and `build` passing green.

### Session 3 — 2026-10-11

1. **Task 2 — Tenancy Core (Schema + API Layer)**:
   - Created `tenants` and `tenant_domains` tables (migration 0003), with citext hostname uniqueness, slug uniqueness, FK cascade, and status/locale defaults.
   - Added Zod schemas in `packages/contracts/src/tenancy/tenant.schema.ts` for `Tenant`, `TenantDomain`, and `TenantContext`.
   - Implemented `TenantContext` (AsyncLocalStorage), `TenantDb` (transaction-local `app.tenant_id`), `PlatformDb`, `TenantResolverService` (host→tenant with LRU cache), and `TenantMiddleware` (fail-closed 404).
   - Registered `DatabaseModule` (Global) and `TenancyModule` in `AppModule`.
   - Fixed `noEmit` in `packages/db` and `packages/contracts` tsconfig to prevent emitted `.js` files polluting `src/`.
   - Fixed `tsconfig.build.json` for `nest build` to support workspace package resolution.
   - Fixed `apps/api` test script to load `.env` via `node --env-file`.
2. **Tests**: 26 total tests passing (12 in `packages/db`, 14 in `apps/api` including 13 tenancy tests).
3. **Full pipeline green**: `lint`, `typecheck`, `build`, `test` all passing.

---

## Decisions

| # | Decision | Outcome |
|---|---|---|
| D-DB-1 | Port conflict on local 5432 | Compose exposes 5433:5432; documented in .env.example |
| D-DB-2 | No TRUNCATE for any runtime role | app_runtime AND app_platform denied TRUNCATE |
| D-DB-3 | Env loading without new dep | node --env-file=../../.env (Node built-in, works) |

---

## Blockers and Risks

| # | Item | Status |
|---|---|---|
| B1 | AppController test failure | Fixed (eslint-disable for DI import) |
| B2 | progress/_TEMPLATE-sprint.md does not exist | No template; sprint-01 created manually with agreed structure |
| B3 | progress/sprint-00-foundations.md does not exist | Sprint-00 content file missing; row kept in progress/README.md |
| B4 | `tsc` emits `.js`/`.d.ts` into `src/` in packages/db and packages/contracts | Fixed with `noEmit: true` in both tsconfig.json |

---

## Carry-over & Deferred Tasks

- **Production build (Sprint 11-12):** Resolve API production build (`nest build`) when monorepo packages export `.ts` source and API has `"type": "module"`.
  - **Option 1 (Bundler: `tsup` / `esbuild`):** Bundle API with monorepo packages into single ESM bundle `dist/main.js`. Fast, clean, but requires devDependency.
  - **Option 2 (Pre-build packages to dist):** Add `build` script to `@repo/contracts` and `@repo/db` outputting `.js` + `.d.ts` to `dist/`, consumed by standard `nest build`. Clean monorepo structure, but requires multi-package build step.
  - **Option 3 (Runtime runner: `tsx` / `@swc/cli`):** Run in production using `tsx` or Nest SWC loader. Low config, but runs TS at runtime.
  - *Decision pending founder confirmation.*
- All Task 1 and Task 2 changes are ready for commit (user handles commits).
- Next: Sprint 02 or Task 3 — Auth module (Admin login, sessions).

---

## Retrospective

*(to be filled at sprint close)*
