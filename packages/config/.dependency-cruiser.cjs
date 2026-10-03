/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    /**
     * PLACEHOLDER — Module boundary rules will be added in Phase 1.
     *
     * Planned rules:
     * 1. Cross-module imports: each NestJS module may only import the PUBLIC
     *    Service of another module — never its repositories, DTOs, or internals.
     *
     * 2. PlatformDb restriction: imports of PlatformDb are only allowed in:
     *    - src/tenancy/**
     *    - src/auth/**
     *    - src/modules/platform-admin/**
     *    - src/infra/jobs/**
     *
     * 3. Raw DB pool restriction: direct pool imports forbidden outside
     *    src/infra/db/**
     *
     * 4. Circular imports: always forbidden.
     *
     * See: docs/TECHNICAL_BLUEPRINT.md §7.1 and §4.3 (L3)
     */
    {
      name: 'no-circular',
      comment: 'Circular imports are always forbidden.',
      severity: 'error',
      from: {},
      to: {
        circular: true,
      },
    },
  ],

  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    moduleSystems: ['es6', 'cjs'],
    tsPreCompilationDeps: true,
    reporterOptions: {
      text: {
        highlightFocused: true,
      },
    },
  },
};
