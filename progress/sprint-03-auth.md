# Sprint 03: Auth + Users (Admin & Attar)

**Status:** Planned
**Dates:** 2026-10-26 → 2026-11-08
**Goal:** Complete custom session authentication system with two realms (`admin` and `attar`), tenant-scoped identities, Argon2id password hashing, and RLS enforcement on user and session data.
**Gate:** Admin and Attar login/logout suites passing with proven isolation across tenants; zero cross-tenant session leaks.

---

## 1. Context & Architectural Decisions (from Technical Blueprint §9 & ADR-006)

- **Two Realms:**
  1. `admin`: Distributor staff/owner (email + password login). Tenant-scoped in `users`.
  2. `attar`: Retailer/customer (phone E.164 + password login). Tenant-scoped in `customers`.
- **Platform Admin:** CLI only on the server with `app_platform` role (no web login, no realm).
- **Session Auth:**
  - Cryptographically secure 256-bit random session token.
  - Stored only as SHA-256 hash in `sessions` table.
  - Delivered to client via `HttpOnly; Secure; SameSite=Lax; Path=/` cookie:
    - Cookie `__Host-admin` for `admin` realm.
    - Cookie `__Host-store` for `attar` realm.
  - Instant revocation on logout or status change.
- **Passwords:** `argon2id` hashing (memory: 64MB, time: 3, parallelism: 4 via `argon2` package).
- **Tenant Scope & RLS:**
  - `users`: `tenant_id`, `email` (citext), `password_hash`, `name`, `status`. Unique `(tenant_id, email)`. One admin per tenant in MVP.
  - `sessions`: `tenant_id`, `token_hash` (unique), `realm`, `user_id` (nullable), `customer_id` (nullable), `expires_at`, `last_seen_at`.

---

## 2. Scope & Tasks

| # | Task | Est. h | Status |
|---|---|---|---|
| 3.1 | **DB Schema & RLS:** Create `users`, `sessions`, `auth_tokens` tables with composite keys and RLS policies | 3 | Not started |
| 3.2 | **Password Hashing & Validation:** Argon2id service and Zod boundary schemas for email, phone, and passwords | 2 | Not started |
| 3.3 | **Session Service & Guards:** Token generation, SHA-256 hashing, session creation/validation, `@Public`, `@Staff`, `@Customer` guards | 4 | Not started |
| 3.4 | **Admin Auth Endpoints:** `POST /api/auth/admin/login`, `POST /api/auth/admin/logout`, `GET /api/auth/admin/me` | 3 | Not started |
| 3.5 | **Attar Auth Endpoints:** `POST /api/auth/attar/login`, `POST /api/auth/attar/logout`, `GET /api/auth/attar/me` | 3 | Not started |
| 3.6 | **Isolation & Security Test Suite:** Cross-tenant login rejection, session token replay prevention, reverse security tests | 4 | Not started |
| 3.7 | **Platform CLI Admin Provisioning:** Add `create-admin` command to Platform CLI | 2 | Not started |

---

## 3. Definition of Done

- [ ] Acceptance criteria verified by running real commands (output shown, not described)
- [ ] Reverse test done for security gates (expired session, wrong tenant host, revoked session)
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` green across monorepo
- [ ] Security checklist (AGENTS.md section 5) passed
- [ ] `docs/database.md` updated with new tables and RLS policies
- [ ] `progress/sprint-03-auth.md` updated with session logs
