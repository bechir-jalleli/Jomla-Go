import { Module, Global } from '@nestjs/common';
import pg from 'pg';
import { PLATFORM_PG_POOL, RUNTIME_PG_POOL, PlatformDb } from './platform-db.js';
import { TenantDb } from './tenant-db.js';

const { Pool } = pg;

@Global()
@Module({
  providers: [
    {
      provide: RUNTIME_PG_POOL,
      useFactory: async () => {
        const connectionString =
          process.env['DATABASE_URL'] ?? process.env['DATABASE_TEST_URL'];
        if (!connectionString) {
          throw new Error('DATABASE_URL or DATABASE_TEST_URL is required for RUNTIME_PG_POOL');
        }
        const pool = new Pool({
          connectionString,
          max: 10,
        });

        pool.on('error', (err) => {
          // Log idle client errors without exiting node process
          console.error('[RUNTIME_PG_POOL] Unexpected error on idle client:', err);
        });

        // Verify connected role is strictly app_runtime
        const res = await pool.query<{ current_user: string }>('SELECT current_user;');
        const user = res.rows[0]?.current_user;
        if (user !== 'app_runtime') {
          await pool.end();
          throw new Error(
            `SECURITY VIOLATION: RUNTIME_PG_POOL must connect as 'app_runtime', but connected as '${user}'`,
          );
        }

        return pool;
      },
    },
    {
      provide: PLATFORM_PG_POOL,
      useFactory: async () => {
        const connectionString = process.env['DATABASE_PLATFORM_URL'];
        if (!connectionString) {
          throw new Error('DATABASE_PLATFORM_URL is strictly required for PLATFORM_PG_POOL (no fallback allowed)');
        }
        const pool = new Pool({
          connectionString,
          max: 5,
        });

        pool.on('error', (err) => {
          // Log idle client errors without exiting node process
          console.error('[PLATFORM_PG_POOL] Unexpected error on idle client:', err);
        });

        // Verify connected role is strictly app_platform
        const res = await pool.query<{ current_user: string }>('SELECT current_user;');
        const user = res.rows[0]?.current_user;
        if (user !== 'app_platform') {
          await pool.end();
          throw new Error(
            `SECURITY VIOLATION: PLATFORM_PG_POOL must connect as 'app_platform', but connected as '${user}'`,
          );
        }

        return pool;
      },
    },
    PlatformDb,
    TenantDb,
  ],
  exports: [PlatformDb, TenantDb],
})
export class DatabaseModule {}
