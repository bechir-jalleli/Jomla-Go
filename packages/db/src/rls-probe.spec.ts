import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import crypto from 'node:crypto';

const { Pool } = pg;

const connectionString = process.env['DATABASE_TEST_URL'];
if (!connectionString) {
  throw new Error('DATABASE_TEST_URL environment variable is required for tests');
}

describe('RLS Isolation on rls_probe table', () => {
  let pool: pg.Pool;
  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();

  beforeAll(async () => {
    // Single-connection pool to guarantee connection reuse for test e
    pool = new Pool({
      connectionString,
      max: 1,
    });

    // Guard: Verify connection is strictly app_runtime
    const res = await pool.query<{ current_user: string }>('SELECT current_user;');
    const currentUser = res.rows[0]?.current_user;
    if (currentUser !== 'app_runtime') {
      throw new Error(
        `SECURITY VIOLATION: Tests must connect as app_runtime, but connected as '${currentUser}'`,
      );
    }

    // Seed test data for Tenant A and Tenant B using app_runtime transactions
    const client = await pool.connect();
    try {
      // Seed Tenant A row
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      await client.query(
        'INSERT INTO rls_probe (tenant_id, name) VALUES ($1, $2)',
        [tenantA, 'Probe A'],
      );
      await client.query('COMMIT');

      // Seed Tenant B row
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantB]);
      await client.query(
        'INSERT INTO rls_probe (tenant_id, name) VALUES ($1, $2)',
        [tenantB, 'Probe B'],
      );
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    // Cleanup test data using app_runtime within tenant context
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      await client.query('DELETE FROM rls_probe WHERE tenant_id = $1', [tenantA]);
      await client.query('COMMIT');

      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantB]);
      await client.query('DELETE FROM rls_probe WHERE tenant_id = $1', [tenantB]);
      await client.query('COMMIT');
    } finally {
      client.release();
      await pool.end();
    }
  });

  // Case a: Without app.tenant_id, SELECT returns 0 rows
  it('(a) without app.tenant_id: SELECT returns 0 rows', async () => {
    const client = await pool.connect();
    try {
      const res = await client.query('SELECT * FROM rls_probe;');
      expect(res.rows.length).toBe(0);
    } finally {
      client.release();
    }
  });

  // Case b: With Tenant A: sees Tenant A rows only, cannot see B
  it('(b) with Tenant A: sees Tenant A rows only, cannot see Tenant B', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      const res = await client.query<{ tenant_id: string; name: string }>(
        'SELECT * FROM rls_probe;',
      );
      expect(res.rows.length).toBe(1);
      expect(res.rows[0]?.tenant_id).toBe(tenantA);
      expect(res.rows[0]?.name).toBe('Probe A');
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });

  // Case c: Inserting Tenant B row while in context of Tenant A fails WITH CHECK
  it('(c) inserting row with tenant_id=B in context of A: fails WITH CHECK (code 42501)', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      let errorThrown: (Error & { code?: string }) | null = null;
      try {
        await client.query(
          'INSERT INTO rls_probe (tenant_id, name) VALUES ($1, $2)',
          [tenantB, 'Malicious B from A'],
        );
      } catch (err) {
        errorThrown = err as Error & { code?: string };
      }
      expect(errorThrown).not.toBeNull();
      expect(
        errorThrown?.code === '42501' ||
          /row-level security/i.test(errorThrown?.message ?? ''),
      ).toBe(true);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  // Case d: UPDATE and DELETE of row B while in context of A affects 0 rows, and row B remains untouched
  it('(d) UPDATE and DELETE of row B in context of A: affects 0 rows, row B remains unchanged', async () => {
    const client = await pool.connect();
    try {
      // Step 1: Attempt UPDATE and DELETE under Tenant A context
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);

      const updateRes = await client.query(
        "UPDATE rls_probe SET name = 'Hijacked' WHERE tenant_id = $1",
        [tenantB],
      );
      expect(updateRes.rowCount).toBe(0);

      const deleteRes = await client.query(
        'DELETE FROM rls_probe WHERE tenant_id = $1',
        [tenantB],
      );
      expect(deleteRes.rowCount).toBe(0);

      await client.query('COMMIT');

      // Step 2: Verify in context of Tenant B that row B is intact
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantB]);
      const resB = await client.query<{ tenant_id: string; name: string }>(
        'SELECT tenant_id, name FROM rls_probe WHERE tenant_id = $1;',
        [tenantB],
      );
      expect(resB.rows.length).toBe(1);
      expect(resB.rows[0]?.tenant_id).toBe(tenantB);
      expect(resB.rows[0]?.name).toBe('Probe B');
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });

  // Case e: Transaction-local context check via Pool (max=1 connection)
  it('(e) context is transaction-local: after COMMIT, reusing the exact same pool connection returns 0 rows', async () => {
    // Step 1: Open transaction with Tenant A
    const client1 = await pool.connect();
    try {
      await client1.query('BEGIN');
      await client1.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      const resInTx = await client1.query('SELECT * FROM rls_probe;');
      expect(resInTx.rows.length).toBe(1);
      await client1.query('COMMIT');
    } finally {
      client1.release();
    }

    // Step 2: Acquire connection from the same pool (max=1 guarantees same physical connection)
    const client2 = await pool.connect();
    try {
      const resAfterTx = await client2.query('SELECT * FROM rls_probe;');
      expect(resAfterTx.rows.length).toBe(0);
    } finally {
      client2.release();
    }
  });

  // Case f: pg_tables check: tableowner is app_owner
  it('(f) pg_tables check: tableowner is app_owner', async () => {
    const client = await pool.connect();
    try {
      const tableRes = await client.query<{ tableowner: string }>(
        "SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'rls_probe';",
      );
      expect(tableRes.rows[0]?.tableowner).toBe('app_owner');
    } finally {
      client.release();
    }
  });

  // Case g: relrowsecurity and relforcerowsecurity enabled on rls_probe
  it('(g) pg_class check: rls_probe has relrowsecurity=true and relforcerowsecurity=true', async () => {
    const client = await pool.connect();
    try {
      const res = await client.query<{
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(
        "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'public.rls_probe'::regclass;",
      );
      expect(res.rows[0]?.relrowsecurity).toBe(true);
      expect(res.rows[0]?.relforcerowsecurity).toBe(true);
    } finally {
      client.release();
    }
  });
});
