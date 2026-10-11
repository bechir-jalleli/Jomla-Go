import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/coverage/**'],
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['apps/api/src/**/*.ts'],
    ignores: ['apps/api/src/infra/db/**', 'apps/api/src/**/*.spec.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'pg',
              message: 'Raw pg pool access is forbidden outside apps/api/src/infra/db/. Use TenantDb or PlatformDb.',
            },
          ],
          patterns: [
            {
              group: ['**/infra/db/platform-db*'],
              importNames: ['PLATFORM_PG_POOL', 'RUNTIME_PG_POOL'],
              message: 'Direct injection of PG pool tokens is forbidden outside infra/db.',
            },
          ],
        },
      ],
    },
  },
);
