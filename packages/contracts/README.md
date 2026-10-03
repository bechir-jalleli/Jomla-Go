# packages/contracts

Shared Zod schemas and TypeScript types used by both `apps/web` and `apps/api`.

## Purpose
- Single source of truth for API request/response shapes
- Eliminates duplication between frontend and backend validation
- Imported as `@repo/contracts` by all workspaces

## Rules (from blueprint)
- All schemas use `z.object(...).strict()` — no extra fields allowed
- Money fields are always integers (millimes), never floats
- This package must not import from `apps/` or other `packages/` except `zod`
- No business logic here — schemas only
