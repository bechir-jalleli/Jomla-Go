import type { Config } from 'drizzle-kit';

const config: Config = {
  dialect: 'postgresql',
  schema: './src/schema/rls-probe.ts',
  out: './migrations',
  dbCredentials: {
    url: process.env['DATABASE_MIGRATOR_URL'] ?? (() => { throw new Error('DATABASE_MIGRATOR_URL is required'); })(),
  },
  verbose: true,
  strict: true,
};

export default config;
