# packages/config

Shared tooling configuration: TypeScript presets, ESLint config, and dependency-cruiser rules.

## Purpose
- Provides consistent TypeScript and ESLint configuration across all workspaces
- Enforces module boundary rules via `dependency-cruiser` in CI
- Imported as `@repo/config` by all packages and apps

## Rules (from blueprint)
- Module boundaries are STRICT: each NestJS module exposes only its public Service — no direct import of another module's repository or internal files
- `dependency-cruiser` runs in CI and will FAIL the build if boundaries are violated
- `PlatformDb` imports are restricted to: `tenancy`, `auth`, `platform-admin`, `jobs`
- Raw DB pool imports are forbidden outside `src/infra/db/`
