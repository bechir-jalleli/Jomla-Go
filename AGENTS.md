# AGENTS.md — Project Rules for AI Agents

Every agent working on this repository **must read this file before starting any task**.
Also read `docs/PROGRESS.md` for current status and open decisions.

## Rules

1. **Follow the blueprint.** All architectural decisions are in `docs/TECHNICAL_BLUEPRINT.md`.
   Do not change any decision (stack, patterns, folder structure, security model) without
   explicitly asking the human first and getting confirmation.

2. **Never access the DB directly.** All database access must go through `TenantDb`
   (to be built in Phase 1). `TenantDb` sets `app.tenant_id` for RLS before every query.
   Importing the raw PostgreSQL pool outside `src/infra/db/` is forbidden and enforced by ESLint.

3. **Never accept `tenant_id` from the client.** The tenant is always resolved server-side
   from the `Host` header via the `tenant_domains` table. Never read `tenant_id` from
   request Body, Query, Headers (other than the system-set `X-Tenant-Host`), or URL params.

4. **Every route must have an explicit security decorator.** Allowed decorators:
   `@Public`, `@Customer`, `@Staff(permission)`, `@PlatformOnly`.
   A route with no decorator must fail the CI Route Scanner test.

5. **Every tenant-owned table needs `tenant_id`, composite FKs, and RLS.**
   - `tenant_id NOT NULL` on every tenant-scoped table.
   - Composite unique key `(tenant_id, id)` to enable composite foreign keys.
   - `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` + explicit policy for `app_runtime`.
   - Composite FKs on all cross-table joins (e.g. `orders(tenant_id, customer_id) → customers(tenant_id, id)`).

6. **Money is integer millimes, never floats.** All monetary values are stored as `bigint`
   in millimes (1 TND = 1000 millimes). Quantities use `numeric(12,3)`. Never use `float`
   or `decimal` for money. Display conversion happens in the presentation layer only.

7. **Write tests first for isolation and security.** The 16 critical tests in
   `docs/TECHNICAL_BLUEPRINT.md §14` are non-negotiable. Cross-tenant leakage tests must
   be written before the feature, not after.

8. **One small task per session. Show a plan before editing.**
   Before making any code changes, output a brief plan: what you will change and why.
   Get confirmation before proceeding. Keep each PR/commit focused on one logical change.

9. **Never commit secrets or real customer data.**
   - `.env` is gitignored; only `.env.example` (with placeholders) is committed.
   - Never log or include PII (phone numbers, emails, addresses) in Sentry or logs.
   - Run `gitleaks` before committing if in doubt.

10. **No new dependencies without asking.**
    The allowed dependency list is defined in `docs/TECHNICAL_BLUEPRINT.md §3`.
    If you believe a new dependency is needed, stop and ask — do not add it silently.
