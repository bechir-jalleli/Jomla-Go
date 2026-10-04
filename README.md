# Jomla Go — B2B Distribution Platform

A white-label, multi-tenant B2B ordering platform for Tunisian distributors and their clients (attars/retailers). Built as a Modular Monolith with TypeScript, it lets each distributor run their own branded ordering portal under their own domain.

**Stack:** Next.js 16 (App Router) + NestJS (Fastify) + PostgreSQL (Row-Level Security) + Drizzle ORM + pg-boss + pnpm workspaces.
See `docs/TECHNICAL_BLUEPRINT.md` for full architecture decisions.

---

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | ≥ 22 (use `.nvmrc`: `nvm use`) |
| pnpm | ≥ 12 (`npm i -g pnpm`) |
| Docker + Docker Compose | latest |

---

## Setup

```bash
# 1. Clone and enter
git clone <repo-url>
cd jomla-go

# 2. Copy env file and fill in values
cp .env.example .env
# Edit .env with your local credentials

# 3. Install all dependencies
pnpm install

# 4. Start the local database
docker compose -f infra/docker-compose.dev.yml up -d

# 5. Run database migrations (Phase 1 — not yet available)
# pnpm --filter @repo/db db:migrate

# 6. Start development servers
pnpm dev
```

---

## Main Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start all apps in dev mode (web + api) |
| `pnpm build` | Build all apps for production |
| `pnpm lint` | Run ESLint across all workspaces |
| `pnpm typecheck` | Run TypeScript type checking across all workspaces |
| `pnpm test` | Run all tests (Vitest for api, placeholder for web) |
| `pnpm format` | Format all files with Prettier |

### Per-app commands

```bash
# Next.js web
pnpm --filter @repo/web dev
pnpm --filter @repo/web build

# NestJS API
pnpm --filter @repo/api start:dev
pnpm --filter @repo/api build
pnpm --filter @repo/api test

# Database (packages/db)
pnpm --filter @repo/db db:generate   # Generate migration files
pnpm --filter @repo/db db:migrate    # Apply migrations
```

### Local infrastructure

```bash
# Start PostgreSQL
docker compose -f infra/docker-compose.dev.yml up -d

# Check health
docker compose -f infra/docker-compose.dev.yml ps

# Stop
docker compose -f infra/docker-compose.dev.yml down
```

---

## Important: Read Before Coding

- **`AGENTS.md`** — 10 non-negotiable rules (for humans and AI agents)
- **`progress/README.md`** — current status and open decisions
- **`docs/TECHNICAL_BLUEPRINT.md`** — full architecture reference
