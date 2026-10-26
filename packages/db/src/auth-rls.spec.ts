import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import crypto from 'node:crypto';

const { Pool } = pg;

const runtimeConnectionString = process.env['DATABASE_TEST_URL'];
const platformConnectionString = process.env['DATABASE_PLATFORM_URL'];

if (!runtimeConnectionString || !platformConnectionString) {
  throw new Error('DATABASE_TEST_URL and DATABASE_PLATFORM_URL are required for tests');
}

describe('Auth Tables RLS Enforcement & Tenant Isolation (users, sessions, auth_tokens)', () => {
  let runtimePool: pg.Pool;
  let platformPool: pg.Pool;

  const tenantAId = crypto.randomUUID();
  const tenantBId = crypto.randomUUID();
  const userAId = crypto.randomUUID();
  const userBId = crypto.randomUUID();

  beforeAll(async () => {
    runtimePool = new Pool({
      connectionString: runtimeConnectionString,
      max: 2,
    });
    platformPool = new Pool({
      connectionString: platformConnectionString,
      max: 2,
    });

    // Guard: Verify connections are properly isolated
    const rRes = await runtimePool.query<{ current_user: string }>('SELECT current_user;');
    expect(rRes.rows[0]?.current_user).toBe('app_runtime');

    const pRes = await platformPool.query<{ current_user: string }>('SELECT current_user;');
    expect(pRes.rows[0]?.current_user).toBe('app_platform');

    // Seed test tenants via app_platform
    await platformPool.query(
      `INSERT INTO tenants (id, slug, name, status) VALUES 
        ($1, $2, 'Tenant A Auth Test', 'active'),
        ($3, $4, 'Tenant B Auth Test', 'active');`,
      [tenantAId, `tenant-a-auth-${crypto.randomBytes(3).toString('hex')}`, tenantBId, `tenant-b-auth-${crypto.randomBytes(3).toString('hex')}`],
    );

    // Seed users via app_platform
    await platformPool.query(
      `INSERT INTO users (id, tenant_id, email, password_hash, name, status, role) VALUES
        ($1, $2, 'admin@tenant-a.com', 'argon2id_hash_a', 'Admin A', 'active', 'admin'),
        ($3, $4, 'admin@tenant-b.com', 'argon2id_hash_b', 'Admin B', 'active', 'admin');`,
      [userAId, tenantAId, userBId, tenantBId],
    );
  });

  afterAll(async () => {
    // Cleanup seeded tenants (cascades to users, sessions, auth_tokens)
    await platformPool.query('DELETE FROM tenants WHERE id IN ($1, $2);', [tenantAId, tenantBId]);
    await runtimePool.end();
    await platformPool.end();
  });

  describe('Table RLS Flags Verification', () => {
    it('verifies users, sessions, and auth_tokens have both relrowsecurity and relforcerowsecurity enabled', async () => {
      const res = await platformPool.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(`
        SELECT relname, relrowsecurity, relforcerowsecurity
        FROM pg_class
        JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
        WHERE pg_namespace.nspname = 'public'
          AND relname IN ('users', 'sessions', 'auth_tokens');
      `);

      expect(res.rows).toHaveLength(3);
      for (const row of res.rows) {
        expect(row.relrowsecurity).toBe(true);
        expect(row.relforcerowsecurity).toBe(true);
      }
    });
  });

  describe('users Isolation & Least-Privilege', () => {
    it('denies INSERT on users to app_runtime with error 42501', async () => {
      let err: (Error & { code?: string }) | null = null;
      try {
        await runtimePool.query(
          `INSERT INTO users (id, tenant_id, email, password_hash, name) VALUES ($1, $2, 'bad@user.com', 'hash', 'Bad');`,
          [crypto.randomUUID(), tenantAId],
        );
      } catch (e) {
        err = e as Error & { code?: string };
      }
      expect(err?.code).toBe('42501');
    });

    it('denies DELETE on users to app_runtime with error 42501', async () => {
      let err: (Error & { code?: string }) | null = null;
      try {
        await runtimePool.query('DELETE FROM users WHERE id = $1;', [userAId]);
      } catch (e) {
        err = e as Error & { code?: string };
      }
      expect(err?.code).toBe('42501');
    });

    it('returns empty result when app_runtime selects users without app.tenant_id set', async () => {
      const client = await runtimePool.connect();
      try {
        await client.query('BEGIN;');
        const res = await client.query('SELECT * FROM users;');
        expect(res.rows).toHaveLength(0);
        await client.query('ROLLBACK;');
      } finally {
        client.release();
      }
    });

    it('returns only Tenant A users when app.tenant_id is set to Tenant A', async () => {
      const client = await runtimePool.connect();
      try {
        await client.query('BEGIN;');
        await client.query(`SELECT set_config('app.tenant_id', $1, true);`, [tenantAId]);

        const res = await client.query<{ id: string; email: string }>('SELECT id, email FROM users;');
        expect(res.rows).toHaveLength(1);
        expect(res.rows[0]?.id).toBe(userAId);
        expect(res.rows[0]?.email).toBe('admin@tenant-a.com');

        await client.query('ROLLBACK;');
      } finally {
        client.release();
      }
    });

    it('enforces single admin per tenant unique constraint', async () => {
      let err: (Error & { code?: string }) | null = null;
      try {
        await platformPool.query(
          `INSERT INTO users (id, tenant_id, email, password_hash, name, role) VALUES ($1, $2, 'second_admin@tenant-a.com', 'hash', 'Admin 2', 'admin');`,
          [crypto.randomUUID(), tenantAId],
        );
      } catch (e) {
        err = e as Error & { code?: string };
      }
      expect(err?.code).toBe('23505'); // unique violation
    });
  });

  describe('sessions Isolation & CRUD Lifecycle', () => {
    it('allows app_runtime to insert, read, and delete sessions within own tenant context', async () => {
      const client = await runtimePool.connect();
      const sessionId = crypto.randomUUID();
      const tokenHash = crypto.randomBytes(32).toString('hex');

      try {
        await client.query('BEGIN;');
        await client.query(`SELECT set_config('app.tenant_id', $1, true);`, [tenantAId]);

        // Insert session for user A in tenant A
        await client.query(
          `INSERT INTO sessions (id, tenant_id, token_hash, realm, user_id, expires_at)
           VALUES ($1, $2, $3, 'admin', $4, NOW() + INTERVAL '1 day');`,
          [sessionId, tenantAId, tokenHash, userAId],
        );

        // Read session
        const readRes = await client.query<{ id: string }>('SELECT id FROM sessions WHERE id = $1;', [sessionId]);
        expect(readRes.rows).toHaveLength(1);
        expect(readRes.rows[0]?.id).toBe(sessionId);

        // Delete session (logout)
        await client.query('DELETE FROM sessions WHERE id = $1;', [sessionId]);
        const checkRes = await client.query('SELECT id FROM sessions WHERE id = $1;', [sessionId]);
        expect(checkRes.rows).toHaveLength(0);

        await client.query('COMMIT;');
      } catch (err) {
        await client.query('ROLLBACK;');
        throw err;
      } finally {
        client.release();
      }
    });

    it('strictly isolates sessions across tenants: Tenant B cannot see Tenant A session', async () => {
      const sessionIdA = crypto.randomUUID();
      const tokenHashA = crypto.randomBytes(32).toString('hex');

      // Create session for Tenant A via platformPool
      await platformPool.query(
        `INSERT INTO sessions (id, tenant_id, token_hash, realm, user_id, expires_at)
         VALUES ($1, $2, $3, 'admin', $4, NOW() + INTERVAL '1 day');`,
        [sessionIdA, tenantAId, tokenHashA, userAId],
      );

      const client = await runtimePool.connect();
      try {
        await client.query('BEGIN;');
        // Set context to Tenant B
        await client.query(`SELECT set_config('app.tenant_id', $1, true);`, [tenantBId]);

        // Query all sessions or specific session
        const resAll = await client.query('SELECT * FROM sessions;');
        expect(resAll.rows).toHaveLength(0);

        const resSpecific = await client.query('SELECT * FROM sessions WHERE id = $1;', [sessionIdA]);
        expect(resSpecific.rows).toHaveLength(0);

        // Attempting to delete Tenant A session from Tenant B context affects 0 rows
        const delRes = await client.query('DELETE FROM sessions WHERE id = $1;', [sessionIdA]);
        expect(delRes.rowCount).toBe(0);

        await client.query('ROLLBACK;');
      } finally {
        client.release();
        await platformPool.query('DELETE FROM sessions WHERE id = $1;', [sessionIdA]);
      }
    });

    it('rejects inserting session with mismatched tenant_id via WITH CHECK violation', async () => {
      const client = await runtimePool.connect();
      try {
        await client.query('BEGIN;');
        // Context is Tenant A
        await client.query(`SELECT set_config('app.tenant_id', $1, true);`, [tenantAId]);

        let err: (Error & { code?: string }) | null = null;
        try {
          // Attempting to insert a row stating tenant_id = Tenant B
          await client.query(
            `INSERT INTO sessions (id, tenant_id, token_hash, realm, user_id, expires_at)
             VALUES ($1, $2, $3, 'admin', $4, NOW() + INTERVAL '1 day');`,
            [crypto.randomUUID(), tenantBId, crypto.randomBytes(32).toString('hex'), userBId],
          );
        } catch (e) {
          err = e as Error & { code?: string };
        }

        // RLS WITH CHECK policy violation or 42501 / 44000
        expect(err).not.toBeNull();

        await client.query('ROLLBACK;');
      } finally {
        client.release();
      }
    });
  });

  describe('auth_tokens Isolation', () => {
    it('isolates single-use auth tokens per tenant', async () => {
      const tokenIdA = crypto.randomUUID();
      const tokenHashA = crypto.randomBytes(32).toString('hex');

      await platformPool.query(
        `INSERT INTO auth_tokens (id, tenant_id, token_hash, type, user_id, expires_at)
         VALUES ($1, $2, $3, 'password_reset', $4, NOW() + INTERVAL '30 minutes');`,
        [tokenIdA, tenantAId, tokenHashA, userAId],
      );

      const client = await runtimePool.connect();
      try {
        await client.query('BEGIN;');
        await client.query(`SELECT set_config('app.tenant_id', $1, true);`, [tenantBId]);

        const res = await client.query('SELECT * FROM auth_tokens WHERE id = $1;', [tokenIdA]);
        expect(res.rows).toHaveLength(0);

        await client.query('ROLLBACK;');
      } finally {
        client.release();
        await platformPool.query('DELETE FROM auth_tokens WHERE id = $1;', [tokenIdA]);
      }
    });
  });
});
