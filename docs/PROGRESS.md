# docs/PROGRESS.md

## Done (Phase 0 — Repo Foundation)

- [x] `git init` — branch: `main`
- [x] Root `package.json` (private monorepo, engines, packageManager fields)
- [x] `pnpm-workspace.yaml` (apps/*, packages/*, catalog, allowBuilds)
- [x] `.nvmrc` (Node 22 LTS)
- [x] `.gitignore`, `.editorconfig`, `.gitattributes` (LF enforcement)
- [x] `tsconfig.base.json` (shared TypeScript base config)
- [x] `.prettierrc.json`, `.prettierignore`
- [x] `eslint.config.mjs` (root flat ESLint config)
- [x] Root devDeps installed: typescript 7.0.2, eslint 10.11.0, prettier 3.9.9, typescript-eslint 8.71.0
- [x] Folder structure: `apps/web`, `apps/api`, `packages/contracts`, `packages/db`, `packages/config`, `infra`, `docs`
- [x] `apps/web` generated: Next.js 16.3.8 (App Router, TypeScript, Tailwind 4, ESLint, src-less, pnpm)
- [x] `apps/web` extras: @tanstack/react-query ^5, next-intl ^4, zod (catalog)
- [x] `apps/web` shadcn/ui initialized (shadcn 4.21.1, default settings)
- [x] `apps/web/next.config.ts` → `output: "standalone"`
- [x] `apps/api` generated: NestJS (TypeScript, pnpm) — scaffold kept
- [x] `apps/api` HTTP adapter: switched to Fastify (main.ts updated)
- [x] `apps/api` runtime deps: drizzle-orm, pg, zod, nestjs-cls, argon2, pg-boss, pino, nestjs-pino, @nestjs/throttler, @nestjs/config, sharp, exceljs
- [x] `apps/api` dev deps: drizzle-kit, @types/pg, vitest, supertest, @types/supertest, testcontainers
- [x] `apps/api` Vitest config + placeholder test
- [x] `apps/api` empty folders with .gitkeep: src/common, src/infra/db, src/infra/storage, src/infra/mail, src/infra/jobs, src/infra/config, src/tenancy, src/auth, src/modules, src/permissions
- [x] `packages/contracts`: package.json + tsconfig + stub index
- [x] `packages/db`: package.json + tsconfig + drizzle.config.ts skeleton + stub index
- [x] `packages/config`: package.json + dependency-cruiser starter config + tsconfig presets
- [x] Workspace wiring: @repo/contracts and @repo/db importable via workspace protocol
- [x] `infra/docker-compose.dev.yml` (PostgreSQL 17, named volume, healthcheck, env vars)
- [x] `infra/postgres/init/README.md` (roles and RLS note for Phase 1)
- [x] `.env.example` (DATABASE_URL, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, NODE_ENV)
- [x] `AGENTS.md` (10 rules for AI agents)
- [x] `docs/PROGRESS.md` (this file)
- [x] `.cursor/rules/project.mdc` (alwaysApply: true)
- [x] `README.md` (project description, prerequisites, setup commands, scripts)
- [x] `.github/workflows/ci.yml` (PR + main push: install, lint, typecheck, test, build)

---

## In Progress

- Nothing active

---

## Next (Phase 1 — Tenancy + DB Core)

Per blueprint §20.1 (ordered by risk):
1. Create DB roles: `app_owner`, `app_runtime`, `app_platform` (SQL init scripts)
2. Write first Drizzle tables: `tenants`, `tenant_domains`, `users`, `sessions`
3. Implement `TenantDb` (AsyncLocalStorage + RLS context setter)
4. Write `TenantMiddleware` (Host normalization + `tenant_domains` lookup)
5. Write first 6 isolation tests (RLS scanner, cross-tenant leakage)
6. Seed two test tenants

---

## Open Decisions

| ID | Decision | Status |
|----|----------|--------|
| **G1** | Hosting jurisdiction (Tunisia vs. Europe — INPDP compliance) | **UNRESOLVED** — Do not put real customer data in production until this is resolved |
| **G2** | `.tn` domain registrar: supports A/CNAME records? What are the conditions and cost? | **UNRESOLVED** — Affects Custom Domains phase (Phase 10) |
| **G3** | Developer stack confidence: TypeScript + NestJS + Drizzle proficiency confirmed? | **UNRESOLVED** — If Laravel/Django preferred, backend can be swapped without touching DB or frontend |

---

## Known Issues

- None at this stage.
