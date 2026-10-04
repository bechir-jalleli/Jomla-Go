# AGENTS.md: Rules for AI Agents

**Read this file, then `progress/README.md` and the active sprint file, before any task.** Details live in `docs/TECHNICAL_BLUEPRINT.md` (referenced as `BP §n`). Do not paste the blueprint into your context: read only the section the task needs.

## 0. Project in 5 lines

- White-label **multi-tenant B2B ordering SaaS** for Tunisian distributors (Distributor → Attar/retailer). No factories, no marketplace, **no online payments**.
- Stack: Next.js (web) + NestJS/Fastify (api) + PostgreSQL + Drizzle. **Modular monolith**, pnpm monorepo.
- Tenant isolation is the #1 risk: shared DB + `tenant_id` + RLS + composite FKs (BP §4).
- Users: distributor staff (email login), attars (phone login, tenant-scoped identity), platform admin (CLI in pilot).
- Language: UI in Arabic (RTL) and French. Code, comments, commits, and docs in English.

## 1. Invariants (never break; ask the human before any exception)

1. **Blueprint is law.** Don't change stack, patterns, folder structure, or the security model without asking and getting explicit confirmation.
2. **DB access only through `TenantDb`** (tenant-scoped, RLS) or `PlatformDb` (platform modules only: `tenancy`, `auth`, `platform-admin`, `jobs`). Importing the raw pool outside `src/infra/db/` is forbidden (ESLint-enforced).
3. **Tenant comes from the Host, server-side only.** Never read `tenant_id`/`customer_id` from body, query, URL, or client headers. Only the proxy-set `X-Tenant-Host` is trusted.
4. **Every route has an explicit security decorator:** `@Public`, `@Customer`, `@Staff(permission)`, `@PlatformOnly`. Undecorated route = failing CI Route Scanner.
5. **Every tenant-owned table:** `tenant_id NOT NULL`, unique `(tenant_id, id)`, composite FKs for cross-table links, `ENABLE` + `FORCE` RLS, explicit policy. CI RLS Scanner must pass.
6. **Money = integer millimes (`bigint`)**; quantities = `numeric(12,3)`. Never `float`. Convert for display in the UI layer only.
7. **Fail closed.** Missing tenant context, missing permission, or unknown host returns nothing / 404 / 403, never "best effort".
8. **No secrets, no real customer data, no PII in logs, Sentry, tests, fixtures, or prompts.** Only `.env.example` is committed.
9. **No new dependencies without asking.** Allowed list: BP §3.
10. **Never claim something works unless you ran it.** Report real command output. State assumptions as **Assumption**, never as fact.

## 2. Design patterns (apply by default)

| Concern | Pattern | Rule |
|---|---|---|
| Layering | Controller → Service → Repository | Controllers: parse/auth/respond only. Services: use-cases and orchestration. Repositories: the only code that touches `TenantDb`. No business logic in controllers or repositories. |
| Domain logic | **Pure functions** | Pricing, totals, order state machine, stock math, invoice totals, phone normalization: no I/O, no framework imports, trivially unit-testable. |
| Module boundaries | Public API per module | Other modules import only a module's exported service (`index.ts`). No deep imports, no reading another module's tables, no circular deps (`dependency-cruiser` in CI). |
| Transactions | **Unit of Work** | One `TenantDb` transaction per use-case. Never open nested/parallel transactions inside a request. State change + history + stock movement + outbox job commit together or not at all. |
| Side effects | **Transactional Outbox** | Enqueue pg-boss jobs inside the same transaction as the change. Never send email/notifications inline. Jobs are idempotent. |
| Order lifecycle | **Explicit state machine** | One transition table in `orders/state-machine.ts`; any status change goes through it. Concurrency via compare-and-swap (`UPDATE … WHERE status = :from`). |
| Pricing | **Strategy/resolver** | All price reads go through `PricingService` (customer price list → base price). Never read `products.base_price` directly in cart/order code. Server always re-prices; never trust client prices. |
| History & audit | **Append-only ledgers** | `order_status_history`, `stock_movements`, `audit_logs`: INSERT only; UPDATE/DELETE revoked from `app_runtime`. Corrections are new rows. |
| Historical truth | **Snapshots** | Orders store price, product name, SKU, unit, VAT rate, and delivery address as they were. Invoices are immutable snapshots. |
| Retries / double-submit | **Idempotency keys** | `Idempotency-Key` required on order creation; unique `(tenant_id, client_request_id)`. |
| Validation | **Schema at the boundary** | Zod schemas live in `packages/contracts` (strict: no unknown keys) and are the single source of truth for API types. Validate on entry, trust types inside. |
| API shape | DTO mapping | Never return DB rows directly. Map to response DTOs per audience (`/store`, `/dashboard`, `/platform`). Attars see resolved prices only. |
| Errors | **Typed domain errors** | Throw domain errors (`NotFound`, `Conflict`, `RuleViolation`…); one global filter maps them to RFC 9457 `problem+json` with stable `code`. Return 404 (not 403) for invisible records. Never swallow errors. |
| Config | Validated env | Parse env once with Zod at startup; inject config. No `process.env` scattered in code. |
| Types | Branded primitives | Use branded types for `Millimes`, `TenantId`, `CustomerId`, etc., so they can't be mixed up. No `any`; TypeScript `strict`. |
| Abstraction | **YAGNI** | No abstraction until the third repetition. No speculative features, generic frameworks, or "future-proof" layers beyond the blueprint. |

## 3. Domain rules

**Decided:**
- Order statuses: `PENDING → CONFIRMED → PREPARING → SHIPPED → DELIVERED`, plus `CANCELLED(reason)`. Skipping forward is allowed; going back is Owner/Admin only with a mandatory note. Every change writes history.
- Order items hold three quantities: ordered / confirmed / delivered. The final amount is computed from delivered.
- No online payments. Payment terms (cash on delivery / credit) are fields and warnings only; no balance computation in the MVP.
- Attar identity is per-tenant; never link attar accounts across tenants.
- Stock: per-product `track_stock`, `stock_qty`, optional low-stock threshold (company default available). Every change is a `stock_movements` row with a reason. Low-stock alert is sent once per crossing, not repeatedly. Attars see available / limited / out, not exact numbers.
- Invoices: one per order, built from delivered quantities and snapshot prices. After issuing, never edit or delete. Corrections: cancel with a reason (Owner only), then issue a new one. Gapless numbering per tenant per year.

**Pending human confirmation (ask; don't assume):**
- When stock is deducted (leaning: at CONFIRMED, using confirmed quantity).
- Behavior when stock is insufficient at confirmation (leaning: warn, don't block).
- Invoice issuance: manual button after delivery vs. automatic.
- Invoice legal fields and whether an *Avoir* is required (needs an accountant's confirmation).

## 4. Testing rules

- **Test first** for isolation, auth, and stock/invoice math. The 16 critical tests in BP §14 are non-negotiable.
- Integration tests use a real Postgres (Testcontainers) and **connect as `app_runtime`, never the owner**; otherwise RLS is bypassed and tests lie.
- Pyramid: many unit tests on pure domain logic, integration tests per repository/service, API tests per route, few E2E on critical flows (mobile viewport).
- Each bug fix starts with a failing test that reproduces it.
- Tests are deterministic: no real time, network, or randomness without injection.

## 5. Security checklist (run mentally for every change)

- [ ] Route decorated and permission checked in the backend (frontend checks are UX only)?
- [ ] Tenant from Host, not from input? Query goes through `TenantDb`?
- [ ] Object-level access checked (customer sees only own data)? 404 for invisible records?
- [ ] Input validated by a strict Zod schema? No mass assignment?
- [ ] Prices/totals computed server-side? Idempotent and race-safe?
- [ ] No PII in logs? No secrets in code?
- [ ] New table has `tenant_id`, composite FKs, and RLS?
- [ ] New page is dynamic (no shared cache across tenants)?
- [ ] Uploads: size-limited, magic-byte checked, re-encoded?

## 6. Code conventions

- Files `kebab-case`; classes `PascalCase`; variables/functions `camelCase`; DB `snake_case`; routes plural `kebab-case`; env `UPPER_SNAKE`.
- IDs UUIDv7; timestamps `timestamptz` in UTC; display in `Africa/Tunis`.
- Small functions, early returns, no deep nesting, explicit return types on public functions.
- Comments explain *why*, not *what*. Delete dead code; don't leave commented-out code.
- Migrations: reviewed SQL, backward-compatible (expand/contract), `lock_timeout` set, indexes `CONCURRENTLY`, no destructive change without an explicit flag.
- Don't reformat or touch unrelated files. Keep diffs minimal.

## 7. Workflow (every session)

1. Read this file, `progress/README.md` and the active sprint file. Pick **one** small task from "Next".
2. Read only the needed blueprint section and the files you will change.
3. **Post a plan first** (files, approach, tests, risks). **Wait for approval** before editing.
4. Write/extend tests first, implement, then run: `pnpm lint && pnpm typecheck && pnpm test` (plus `pnpm build` if relevant). Fix failures.
5. Show the diff summary and the real command results. Flag anything uncertain.
6. Commit (Conventional Commits: `feat:`, `fix:`, `test:`, `refactor:`, `chore:`, `docs:`), one logical change per commit.
7. Update the active sprint file (task status, progress summary, session log) and its row in `progress/README.md`. Stop. Don't start the next task unprompted.

**If blocked or ambiguous:** stop and ask one precise question. Don't guess, don't work around a failing command silently, don't add a dependency to "make it work."

## 8. Definition of Done

A task is done only when: tests written and passing (including isolation tests if tenant data is touched) · lint, typecheck, build green · security checklist (§5) passed · no new dependency or blueprint deviation (or approved) · active sprint file updated · committed.

## 9. Context economy (free-tier friendly)

- One task per session; start fresh sessions rather than extending long ones.
- Reference files by path instead of pasting content. Ask for diffs, not full-file rewrites.
- Keep answers concise: plan, diff, results, open questions.