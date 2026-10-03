# infra

Infrastructure configuration for local development and production.

## Contents
- `docker-compose.dev.yml` — local development stack (PostgreSQL only for now)
- `postgres/init/` — placeholder for DB role and RLS setup scripts (Phase 1)
- Future: `Caddyfile`, `docker-compose.prod.yml`, deploy scripts, backup scripts

## Rules (from blueprint §11)
- Production: DigitalOcean FRA1, Droplet + Managed PostgreSQL (conditional on G1 decision)
- Staging: separate Droplet with PostgreSQL in a container, synthetic data ONLY
- Never copy production data to staging or development
- Only ports 80 and 443 are exposed externally in production
- Local development uses Docker Compose with PostgreSQL only (no Redis, no external services)
