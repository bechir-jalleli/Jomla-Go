# Database Tooling

This package configures Drizzle ORM and Postgres migrations for Jomla Go.

## Roles & Connections
- `app_owner`: Owns DB objects, used **ONLY by migrations**. Uses `DATABASE_MIGRATOR_URL`.
- `app_runtime`: Used by API at runtime (DML only). It does **NOT** own tables or create them. Uses `DATABASE_URL`.
- `app_platform`: Platform-level operations (CLI/scripts).

## Scripts
- `pnpm db:generate`: Generate migrations.
- `pnpm db:migrate`: Apply migrations.
- `pnpm db:reset`: Drop and recreate the whole database, then re-apply roles, privileges, and migrations. (Guarded to run only on localhost in non-production).

## Migrations Rule
Migrations are SQL files committed in the repo. They must be backward-compatible (expand/contract). No destructive changes without explicit flags.
