import type { Config } from 'drizzle-kit';

// Schema files will be added in Phase 1.
// DATABASE_URL must be set in the environment (see .env.example at repo root).
const config: Config = {
  dialect: 'postgresql',
  // schema: './src/schema/index.ts', // uncomment in Phase 1
  out: './migrations',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? (() => { throw new Error('DATABASE_URL is required'); })(),
  },
  // Verbose logging during development
  verbose: true,
  strict: true,
};

export default config;
