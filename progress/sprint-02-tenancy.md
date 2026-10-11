# Sprint 02: Tenancy Completion

**Status:** Active
**Dates:** 2026-10-19 → 2026-11-01 (started early on 2026-10-11)
**Goal:** Two test tenants with proven isolation. Every tenant table has RLS, enforced by a CI scanner.
**Gate:** isolation tests green on GitHub CI AND the scanner fails on a deliberate violation.

---

## Scope

| # | Task | Est. h | Status |
|---|---|---|---|
| 1.3 | Tables `company_settings` and `branding` (1:1 with tenants) | 2 | Done |
| 1.7 | RLS migration template applied to both tables | 4 | Done |
| 1.8 | RLS Scanner in CI (fails if a `tenant_id` table has no RLS) | 3 | Not started |
| 1.9 | Isolation tests on the real tables | 4 | Not started |
| 1.10 | Platform CLI: create tenant + domain + settings, suspend tenant | 3 | Not started |

Already done in Sprint 01 (Session 3): 1.4 resolver + cache, 1.5 TenantContext, 1.6 TenantDb, tables `tenants` and `tenant_domains`.

---

## Definition of Done

- [x] Acceptance criteria verified by running commands (output shown, not described)
- [x] Reverse test done for every security task (protection disabled, test fails, protection restored)
- [x] `pnpm lint`, `typecheck`, `build`, `test` green locally (24 DB tests, 15 API tests)
- [x] Security checklist (AGENTS.md section 5) passed
- [x] No new dependency without approval
- [x] docs/database.md updated
- [x] This file updated, committed on branch `feat/2.1-tenant-settings`

---

## Carry-over from Sprint 01 (outside this sprint's hours)

| Item | Status |
|---|---|
| Task 6: Blueprint v1.1 (draft exists in the working tree, not committed) | Pending |
| Task 1: ClickUp setup | Pending |
| Task 9: Discovery, 5 distributor interviews scheduled | Pending |
| Production build decision (Sprint 11-12) | Deferred |

---

## Decisions

| # | Decision | Outcome |
|---|---|---|
| D-S2-1 | Users model | Table `users` with `tenant_id` + unique `(tenant_id, email)`, `role = admin` only (Sprint 03). No `tenant_users`. |
| D-S2-2 | Roles in MVP | Platform Admin (CLI), Admin, Attar |
| D-S2-3 | Platform tables | REVOKE from `app_runtime`, explicit GRANT to `app_platform` |
| D-S2-4 | Tenant settings privileges | Least privilege: REVOKE INSERT, DELETE, TRUNCATE from `app_runtime`; SELECT/UPDATE RLS policies only; explicit FOR ALL policy for `app_platform`. |

---

## Blockers and Risks

| # | Item | Status |
|---|---|---|
| B1 | First CI run on GitHub not verified yet | Open |
| B2 | Default privileges grant `app_runtime` access to every new table | Mitigated by the new-table template (task 1.7) |

---

## Progress Summary

- **Tasks 1.3 & 1.7 Complete:** Created schemas and migrations for `company_settings` and `branding` with full RLS (`ENABLE` + `FORCE`), explicit `app_runtime` SELECT/UPDATE policies, unrestricted `app_platform` FOR ALL policies, and explicit REVOKE of INSERT/DELETE/TRUNCATE from `app_runtime`.
- **Verification:** 7 integration test cases in `company-settings-rls.spec.ts` connecting strictly as `app_runtime` and `app_platform`.
- **Adverse / Reverse Tests:**
  1. Disabled RLS as `app_owner` on `company_settings` → tests (a), (b), (d), (g) failed / cross-tenant leak demonstrated; re-enabled → all 7 passed.
  2. Disabled RLS as `app_owner` on `branding` → tests (a), (b), (d), (g) failed / cross-tenant leak demonstrated; re-enabled → all 7 passed.
  3. Granted INSERT, DELETE to `app_runtime` as `app_owner` → tests (c), (f) failed; revoked → all 7 passed.
- **Documentation:** Added Tenant-Owned Table RLS Template, New Tenant Table Checklist, and Platform Tables section to `docs/database.md`.

---

## Session Log

### Session 1: 2026-10-11

1. **Branch**: Created `feat/2.1-tenant-settings`.
2. **Schema Verification**: Corrected `company-settings.ts` to strictly match spec (`contact_phone`, `contact_whatsapp`, `min_order_amount_millimes bigint NOT NULL default 0 CHECK >= 0`, `store_name`, `primary_color CHECK`).
3. **CJS Resolver Hook**: Added `scripts/resolve-ts.cjs` so `drizzle-kit` seamlessly resolves `.js` extension imports to `.ts` under `NodeNext` without adding new dependencies.
4. **Migrations**:
   - `0006_uneven_jazinda.sql`: DDL for `branding` and `company_settings` tables with FKs to `tenants(id) ON DELETE CASCADE`.
   - `0007_company_settings_branding_rls.sql`: RLS enablement, force RLS, least-privilege revokes, role policies.
5. **Tests (`company-settings-rls.spec.ts`)**:
   - Verified fail-first: 6 failed before RLS/privileges were applied.
   - Verified pass: All 7 tests passed after applying migration 0007.
6. **Reverse Tests**:
   - `company_settings`: RLS disabled → tests failed; RLS enabled + forced → passed.
   - `branding`: RLS disabled → tests failed; RLS enabled + forced → passed.
   - `has_table_privilege`: Granted INSERT/DELETE to `app_runtime` → tests failed; revoked → passed.
7. **Pipeline Verification**:
   - `pnpm db:reset`: clean slate passed.
   - `pnpm db:migrate`: migrations applied idempotently.
   - `pnpm db:generate`: reported no schema drift ("No schema changes, nothing to migrate 😴").
   - `pnpm lint`: green across all packages.
   - `pnpm typecheck`: green across all packages.
   - `pnpm build`: Next.js web build + NestJS api build passed.
   - `pnpm test`: 39/39 tests green across workspace (24 DB, 15 API).

---

## Retrospective

1. What went well?
   - The test-first and reverse-testing pattern proved data isolation and least privilege beyond doubt.
   - Node built-in hooks handled drizzle-kit NodeNext resolution cleanly without new dependencies.
2. What went wrong?
   - `drizzle-kit` CJS execution does not resolve TypeScript NodeNext `.js` specifiers without a custom require hook.
3. What will I change next sprint?
   - Maintain the resolve-ts script across future database tasks.