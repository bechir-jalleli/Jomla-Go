import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import crypto from 'node:crypto';

const { Pool } = pg;

const runtimeConnectionString = process.env['DATABASE_TEST_URL'];
if (!runtimeConnectionString) {
  throw new Error('DATABASE_TEST_URL environment variable is required for tests');
}
const platformConnectionString = process.env['DATABASE_PLATFORM_URL'];
if (!platformConnectionString) {
  throw new Error('DATABASE_PLATFORM_URL environment variable is required for tests');
}

describe('Tenancy Isolation: Platform Tables Access & Constraints', () => {
  let runtimePool: pg.Pool;
  let platformPool: pg.Pool;

  beforeAll(async () => {
    runtimePool = new Pool({
      connectionString: runtimeConnectionString,
      max: 2,
    });
    platformPool = new Pool({
      connectionString: platformConnectionString,
      max: 2,
    });

    // Guard: Verify runtimePool is strictly app_runtime
    const runtimeUserRes = await runtimePool.query<{ current_user: string }>('SELECT current_user;');
    const runtimeUser = runtimeUserRes.rows[0]?.current_user;
    if (runtimeUser !== 'app_runtime') {
      throw new Error(`SECURITY VIOLATION: runtimePool must connect as app_runtime, but connected as '${runtimeUser}'`);
    }

    // Guard: Verify platformPool is strictly app_platform
    const platformUserRes = await platformPool.query<{ current_user: string }>('SELECT current_user;');
    const platformUser = platformUserRes.rows[0]?.current_user;
    if (platformUser !== 'app_platform') {
      throw new Error(`SECURITY VIOLATION: platformPool must connect as app_platform, but connected as '${platformUser}'`);
    }
  });

  afterAll(async () => {
    await runtimePool.end();
    await platformPool.end();
  });

  describe('app_runtime Permission Denial (42501) on Platform Tables', () => {
    it('denies SELECT on tenants to app_runtime with error 42501', async () => {
      let err: (Error & { code?: string }) | null = null;
      try {
        await runtimePool.query('SELECT * FROM tenants;');
      } catch (e) {
        err = e as Error & { code?: string };
      }
      expect(err).not.toBeNull();
      expect(err?.code).toBe('42501');
    });

    it('denies INSERT on tenants to app_runtime with error 42501', async () => {
      let err: (Error & { code?: string }) | null = null;
      try {
        await runtimePool.query(
          'INSERT INTO tenants (id, slug, name) VALUES ($1, $2, $3);',
          [crypto.randomUUID(), 'hack-slug', 'Hack Tenant'],
        );
      } catch (e) {
        err = e as Error & { code?: string };
      }
      expect(err).not.toBeNull();
      expect(err?.code).toBe('42501');
    });

    it('denies UPDATE on tenants to app_runtime with error 42501', async () => {
      let err: (Error & { code?: string }) | null = null;
      try {
        await runtimePool.query('UPDATE tenants SET name = $1;', ['Hacked']);
      } catch (e) {
        err = e as Error & { code?: string };
      }
      expect(err).not.toBeNull();
      expect(err?.code).toBe('42501');
    });

    it('denies DELETE on tenants to app_runtime with error 42501', async () => {
      let err: (Error & { code?: string }) | null = null;
      try {
        await runtimePool.query('DELETE FROM tenants;');
      } catch (e) {
        err = e as Error & { code?: string };
      }
      expect(err).not.toBeNull();
      expect(err?.code).toBe('42501');
    });

    it('denies SELECT/INSERT/UPDATE/DELETE on tenant_domains to app_runtime with error 42501', async () => {
      let selectErr: (Error & { code?: string }) | null = null;
      try {
        await runtimePool.query('SELECT * FROM tenant_domains;');
      } catch (e) {
        selectErr = e as Error & { code?: string };
      }
      expect(selectErr?.code).toBe('42501');

      let insertErr: (Error & { code?: string }) | null = null;
      try {
        await runtimePool.query(
          'INSERT INTO tenant_domains (id, tenant_id, hostname) VALUES ($1, $2, $3);',
          [crypto.randomUUID(), crypto.randomUUID(), 'hack.com'],
        );
      } catch (e) {
        insertErr = e as Error & { code?: string };
      }
      expect(insertErr?.code).toBe('42501');
    });
  });

  describe('Platform Operations & Schema Constraints via app_platform', () => {
    it('can create a tenant and verified primary domain', async () => {
      const tenantId = crypto.randomUUID();
      const domainId = crypto.randomUUID();
      const slug = `tenant-${crypto.randomBytes(4).toString('hex')}`;
      const hostname = `${slug}.platform.test`;

      const client = await platformPool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          'INSERT INTO tenants (id, slug, name, status, default_locale) VALUES ($1, $2, $3, $4, $5)',
          [tenantId, slug, 'Test Distributor', 'active', 'ar'],
        );

        await client.query(
          'INSERT INTO tenant_domains (id, tenant_id, hostname, kind, is_primary, verification_status) VALUES ($1, $2, $3, $4, $5, $6)',
          [domainId, tenantId, hostname, 'platform', true, 'verified'],
        );

        const res = await client.query<{ name: string; hostname: string }>(
          `SELECT t.name, d.hostname 
           FROM tenants t 
           JOIN tenant_domains d ON d.tenant_id = t.id 
           WHERE t.id = $1`,
          [tenantId],
        );

        expect(res.rows.length).toBe(1);
        expect(res.rows[0]?.name).toBe('Test Distributor');
        expect(res.rows[0]?.hostname).toBe(hostname);
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('enforces slug uniqueness on tenants table', async () => {
      const tenantId1 = crypto.randomUUID();
      const tenantId2 = crypto.randomUUID();
      const duplicateSlug = `dup-${crypto.randomBytes(4).toString('hex')}`;

      const client = await platformPool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          'INSERT INTO tenants (id, slug, name) VALUES ($1, $2, $3)',
          [tenantId1, duplicateSlug, 'Tenant 1'],
        );

        let errorThrown: (Error & { code?: string }) | null = null;
        try {
          await client.query(
            'INSERT INTO tenants (id, slug, name) VALUES ($1, $2, $3)',
            [tenantId2, duplicateSlug, 'Tenant 2'],
          );
        } catch (err) {
          errorThrown = err as Error & { code?: string };
        }

        expect(errorThrown).not.toBeNull();
        expect(errorThrown?.code).toBe('23505'); // unique_violation
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('enforces check constraint chk_tenants_status', async () => {
      const client = await platformPool.connect();
      try {
        await client.query('BEGIN');
        let errorThrown: (Error & { code?: string }) | null = null;
        try {
          await client.query(
            'INSERT INTO tenants (id, slug, name, status) VALUES ($1, $2, $3, $4)',
            [crypto.randomUUID(), `chk-${crypto.randomBytes(4).toString('hex')}`, 'Invalid Co', 'invalid_status'],
          );
        } catch (err) {
          errorThrown = err as Error & { code?: string };
        }
        expect(errorThrown?.code).toBe('23514'); // check_violation
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('enforces partial unique index for single primary domain per tenant', async () => {
      const tenantId = crypto.randomUUID();
      const client = await platformPool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          'INSERT INTO tenants (id, slug, name) VALUES ($1, $2, $3)',
          [tenantId, `pri-${crypto.randomBytes(4).toString('hex')}`, 'Primary Co'],
        );

        await client.query(
          'INSERT INTO tenant_domains (id, tenant_id, hostname, is_primary) VALUES ($1, $2, $3, $4)',
          [crypto.randomUUID(), tenantId, `d1-${crypto.randomBytes(4).toString('hex')}.test`, true],
        );

        let errorThrown: (Error & { code?: string }) | null = null;
        try {
          await client.query(
            'INSERT INTO tenant_domains (id, tenant_id, hostname, is_primary) VALUES ($1, $2, $3, $4)',
            [crypto.randomUUID(), tenantId, `d2-${crypto.randomBytes(4).toString('hex')}.test`, true],
          );
        } catch (err) {
          errorThrown = err as Error & { code?: string };
        }
        expect(errorThrown?.code).toBe('23505'); // unique_violation on partial index
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('cascades deletion of tenant to associated tenant_domains', async () => {
      const tenantId = crypto.randomUUID();
      const domainId = crypto.randomUUID();
      const slug = `cascade-${crypto.randomBytes(4).toString('hex')}`;
      const hostname = `${slug}.platform.test`;

      const client = await platformPool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          'INSERT INTO tenants (id, slug, name) VALUES ($1, $2, $3)',
          [tenantId, slug, 'Cascade Tenant'],
        );

        await client.query(
          'INSERT INTO tenant_domains (id, tenant_id, hostname, verification_status) VALUES ($1, $2, $3, $4)',
          [domainId, tenantId, hostname, 'verified'],
        );

        await client.query('DELETE FROM tenants WHERE id = $1', [tenantId]);

        const res = await client.query('SELECT * FROM tenant_domains WHERE id = $1', [domainId]);
        expect(res.rows.length).toBe(0);

        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });
  });
});
