import { Injectable, Inject } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import * as schema from '@repo/db';
import { RUNTIME_PG_POOL } from './platform-db.js';
import { getRequiredTenantContext } from '../../tenancy/tenant-context.js';

@Injectable()
export class TenantDb {
  constructor(@Inject(RUNTIME_PG_POOL) private readonly pool: pg.Pool) {}

  /**
   * Executes operations within a transaction scoped strictly to the current tenant.
   * Sets `app.tenant_id` locally in the transaction so PostgreSQL RLS policies take effect.
   */
  async transaction<T>(
    callback: (tx: NodePgDatabase<typeof schema>) => Promise<T>,
  ): Promise<T> {
    const { tenantId } = getRequiredTenantContext();
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

      const txDb = drizzle(client, { schema });
      const result = await callback(txDb);

      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Executes a read/query operation scoped to the current tenant.
   * Delegates to `transaction` to guarantee fail-closed RLS context on every query.
   */
  async query<T>(
    callback: (db: NodePgDatabase<typeof schema>) => Promise<T>,
  ): Promise<T> {
    return this.transaction(callback);
  }
}
