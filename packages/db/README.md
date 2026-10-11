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

## TypeScript Resolution Hook (`scripts/resolve-ts.cjs`)
- **Problem Solved**: Under TypeScript `NodeNext` resolution (`moduleResolution: "NodeNext"`), ECMAScript imports require explicit file extensions (e.g. `import { tenants } from './tenants.js'`). However, `drizzle-kit` runs as CommonJS (`bin.cjs`) and registers an in-memory TypeScript loader via `esbuild-register` that does not remap `.js` specifiers back to `.ts` on disk, causing Node to throw `MODULE_NOT_FOUND: Cannot find module './<file>.js'`.
- **Scripts Using It**: Preloaded via `node --require ./scripts/resolve-ts.cjs` in:
  - `pnpm db:generate`
  - `pnpm db:generate:custom`
- **Zero New Dependencies**: Implemented strictly using Node.js built-in `node:module` (`Module._resolveFilename`). Adds no npm packages or runtime dependencies.

