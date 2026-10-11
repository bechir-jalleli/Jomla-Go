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

describe('Company Settings & Branding RLS and Permissions', () => {
  let runtimePool: pg.Pool;
  let platformPool: pg.Pool;

  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();
  const slugA = `test-a-${crypto.randomBytes(4).toString('hex')}`;
  const slugB = `test-b-${crypto.randomBytes(4).toString('hex')}`;

  beforeAll(async () => {
    runtimePool = new Pool({
      connectionString: runtimeConnectionString,
      max: 2,
    });
    platformPool = new Pool({
      connectionString: platformConnectionString,
      max: 2,
    });

    // Guard: runtimePool must connect as app_runtime
    const runtimeUserRes = await runtimePool.query<{ current_user: string }>('SELECT current_user;');
    const runtimeUser = runtimeUserRes.rows[0]?.current_user;
    if (runtimeUser !== 'app_runtime') {
      throw new Error(`SECURITY VIOLATION: runtimePool must connect as app_runtime, but connected as '${runtimeUser}'`);
    }

    // Guard: platformPool must connect as app_platform
    const platformUserRes = await platformPool.query<{ current_user: string }>('SELECT current_user;');
    const platformUser = platformUserRes.rows[0]?.current_user;
    if (platformUser !== 'app_platform') {
      throw new Error(`SECURITY VIOLATION: platformPool must connect as app_platform, but connected as '${platformUser}'`);
    }

    // Seed test tenants, company_settings, and branding via app_platform
    const client = await platformPool.connect();
    try {
      await client.query('BEGIN');
      // Create tenants
      await client.query(
        'INSERT INTO tenants (id, slug, name, status, default_locale) VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10)',
        [tenantA, slugA, 'Tenant A', 'active', 'ar', tenantB, slugB, 'Tenant B', 'active', 'fr'],
      );

      // Seed company_settings for A and B
      await client.query(
        'INSERT INTO company_settings (tenant_id, contact_phone, contact_whatsapp, min_order_amount_millimes) VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)',
        [tenantA, '+21611111111', '+21611111111', 50000n, tenantB, '+21622222222', '+21622222222', 100000n],
      );

      // Seed branding for A and B
      await client.query(
        'INSERT INTO branding (tenant_id, store_name, primary_color, welcome_message) VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)',
        [tenantA, 'Store A', '#112233', 'Welcome A', tenantB, 'Store B', '#445566', 'Welcome B'],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    // Cleanup seeded data via app_platform
    const client = await platformPool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM company_settings WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
      await client.query('DELETE FROM branding WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
      await client.query('DELETE FROM tenants WHERE id IN ($1, $2)', [tenantA, tenantB]);
      await client.query('COMMIT');
    } catch {
      await client.query('ROLLBACK');
    } finally {
      client.release();
      await runtimePool.end();
      await platformPool.end();
    }
  });

  // (a) app_runtime without app.tenant_id: 0 rows on both tables
  it('(a) app_runtime without app.tenant_id: returns 0 rows on company_settings and branding', async () => {
    const client = await runtimePool.connect();
    try {
      const resSettings = await client.query('SELECT * FROM company_settings;');
      expect(resSettings.rows.length).toBe(0);

      const resBranding = await client.query('SELECT * FROM branding;');
      expect(resBranding.rows.length).toBe(0);
    } finally {
      client.release();
    }
  });

  // (b) context A sees only A's row; context B only B's row
  it('(b) context A sees only A row, context B sees only B row', async () => {
    const client = await runtimePool.connect();
    try {
      // Context A
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      const resSettingsA = await client.query<{ tenant_id: string; contact_phone: string }>(
        'SELECT tenant_id, contact_phone FROM company_settings;',
      );
      expect(resSettingsA.rows.length).toBe(1);
      expect(resSettingsA.rows[0]?.tenant_id).toBe(tenantA);

      const resBrandingA = await client.query<{ tenant_id: string; store_name: string }>(
        'SELECT tenant_id, store_name FROM branding;',
      );
      expect(resBrandingA.rows.length).toBe(1);
      expect(resBrandingA.rows[0]?.tenant_id).toBe(tenantA);
      await client.query('COMMIT');

      // Context B
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantB]);
      const resSettingsB = await client.query<{ tenant_id: string; contact_phone: string }>(
        'SELECT tenant_id, contact_phone FROM company_settings;',
      );
      expect(resSettingsB.rows.length).toBe(1);
      expect(resSettingsB.rows[0]?.tenant_id).toBe(tenantB);

      const resBrandingB = await client.query<{ tenant_id: string; store_name: string }>(
        'SELECT tenant_id, store_name FROM branding;',
      );
      expect(resBrandingB.rows.length).toBe(1);
      expect(resBrandingB.rows[0]?.tenant_id).toBe(tenantB);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });

  // (c) app_runtime INSERT and DELETE on both tables fail with permission denied (42501)
  it('(c) app_runtime INSERT and DELETE on both tables fail with permission denied (code 42501)', async () => {
    const runInTenantContext = async (queryText: string, params: unknown[] = []) => {
      const client = await runtimePool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
        let caughtErr: (Error & { code?: string }) | null = null;
        try {
          await client.query(queryText, params);
        } catch (err) {
          caughtErr = err as Error & { code?: string };
        }
        await client.query('ROLLBACK');
        return caughtErr;
      } finally {
        client.release();
      }
    };

    // INSERT on company_settings denied
    const insertSettingsErr = await runInTenantContext(
      'INSERT INTO company_settings (tenant_id, contact_phone) VALUES ($1, $2)',
      [tenantA, '+21699999999'],
    );
    expect(insertSettingsErr).not.toBeNull();
    expect(insertSettingsErr?.code).toBe('42501');

    // DELETE on company_settings denied
    const deleteSettingsErr = await runInTenantContext(
      'DELETE FROM company_settings WHERE tenant_id = $1',
      [tenantA],
    );
    expect(deleteSettingsErr).not.toBeNull();
    expect(deleteSettingsErr?.code).toBe('42501');

    // INSERT on branding denied
    const insertBrandingErr = await runInTenantContext(
      'INSERT INTO branding (tenant_id, store_name) VALUES ($1, $2)',
      [tenantA, 'Illegal Store'],
    );
    expect(insertBrandingErr).not.toBeNull();
    expect(insertBrandingErr?.code).toBe('42501');

    // DELETE on branding denied
    const deleteBrandingErr = await runInTenantContext(
      'DELETE FROM branding WHERE tenant_id = $1',
      [tenantA],
    );
    expect(deleteBrandingErr).not.toBeNull();
    expect(deleteBrandingErr?.code).toBe('42501');
  });

  // (d) context A: UPDATE own row works; UPDATE B row by id affects 0 rows and B unchanged; UPDATE setting tenant_id to B rejected
  it('(d) context A: UPDATE own row works; UPDATE B row affects 0 rows; changing tenant_id rejected', async () => {
    const client = await runtimePool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);

      // 1. UPDATE own row works
      const updateOwnSettings = await client.query(
        "UPDATE company_settings SET contact_phone = '+21611119999' WHERE tenant_id = $1",
        [tenantA],
      );
      expect(updateOwnSettings.rowCount).toBe(1);

      const updateOwnBranding = await client.query(
        "UPDATE branding SET store_name = 'Updated Store A' WHERE tenant_id = $1",
        [tenantA],
      );
      expect(updateOwnBranding.rowCount).toBe(1);

      // 2. UPDATE B's row by id affects 0 rows
      const updateBSettings = await client.query(
        "UPDATE company_settings SET contact_phone = '+21699999999' WHERE tenant_id = $1",
        [tenantB],
      );
      expect(updateBSettings.rowCount).toBe(0);

      const updateBBranding = await client.query(
        "UPDATE branding SET store_name = 'Hijacked Store B' WHERE tenant_id = $1",
        [tenantB],
      );
      expect(updateBBranding.rowCount).toBe(0);

      // 3. Attempt to update own row setting tenant_id to B is rejected (WITH CHECK violation 42501)
      await client.query('SAVEPOINT sp_tenant_change');
      let changeTenantIdErr: (Error & { code?: string }) | null = null;
      try {
        await client.query(
          'UPDATE company_settings SET tenant_id = $1 WHERE tenant_id = $2',
          [tenantB, tenantA],
        );
      } catch (err) {
        changeTenantIdErr = err as Error & { code?: string };
      }
      expect(changeTenantIdErr).not.toBeNull();
      expect(
        changeTenantIdErr?.code === '42501' || /row-level security/i.test(changeTenantIdErr?.message ?? ''),
      ).toBe(true);
      await client.query('ROLLBACK TO SAVEPOINT sp_tenant_change');

      await client.query('ROLLBACK');

      // 4. Verify via app_platform that Tenant B's data is untouched
      const checkPlatformSettings = await platformPool.query<{ contact_phone: string }>(
        'SELECT contact_phone FROM company_settings WHERE tenant_id = $1',
        [tenantB],
      );
      expect(checkPlatformSettings.rows[0]?.contact_phone).toBe('+21622222222');

      const checkPlatformBranding = await platformPool.query<{ store_name: string }>(
        'SELECT store_name FROM branding WHERE tenant_id = $1',
        [tenantB],
      );
      expect(checkPlatformBranding.rows[0]?.store_name).toBe('Store B');
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
  });

  // (e) app_platform can SELECT and INSERT rows for both tenants
  it('(e) app_platform can SELECT and INSERT rows for both tenants', async () => {
    const tempTenant = crypto.randomUUID();
    const tempSlug = `temp-${crypto.randomBytes(4).toString('hex')}`;
    const client = await platformPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO tenants (id, slug, name, status, default_locale) VALUES ($1, $2, $3, $4, $5)',
        [tempTenant, tempSlug, 'Temp Tenant', 'active', 'ar'],
      );

      // INSERT company_settings via app_platform
      await client.query(
        'INSERT INTO company_settings (tenant_id, contact_phone, min_order_amount_millimes) VALUES ($1, $2, $3)',
        [tempTenant, '+21677777777', 0n],
      );

      // INSERT branding via app_platform
      await client.query(
        'INSERT INTO branding (tenant_id, store_name, primary_color) VALUES ($1, $2, $3)',
        [tempTenant, 'Temp Store', '#ABCDEF'],
      );

      // SELECT both
      const settingsRes = await client.query<{ tenant_id: string }>(
        'SELECT tenant_id FROM company_settings WHERE tenant_id = $1',
        [tempTenant],
      );
      expect(settingsRes.rows.length).toBe(1);

      const brandingRes = await client.query<{ tenant_id: string }>(
        'SELECT tenant_id FROM branding WHERE tenant_id = $1',
        [tempTenant],
      );
      expect(brandingRes.rows.length).toBe(1);

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  // (f) has_table_privilege checks: app_runtime: SELECT/UPDATE true, INSERT/DELETE/TRUNCATE false; app_platform: no TRUNCATE
  it('(f) has_table_privilege: app_runtime has SELECT/UPDATE only, app_platform has no TRUNCATE', async () => {
    const client = await platformPool.query<{
      table_name: string;
      runtime_select: boolean;
      runtime_update: boolean;
      runtime_insert: boolean;
      runtime_delete: boolean;
      runtime_truncate: boolean;
      platform_truncate: boolean;
    }>(`
      SELECT 
        t.tablename AS table_name,
        has_table_privilege('app_runtime', 'public.' || t.tablename, 'SELECT') AS runtime_select,
        has_table_privilege('app_runtime', 'public.' || t.tablename, 'UPDATE') AS runtime_update,
        has_table_privilege('app_runtime', 'public.' || t.tablename, 'INSERT') AS runtime_insert,
        has_table_privilege('app_runtime', 'public.' || t.tablename, 'DELETE') AS runtime_delete,
        has_table_privilege('app_runtime', 'public.' || t.tablename, 'TRUNCATE') AS runtime_truncate,
        has_table_privilege('app_platform', 'public.' || t.tablename, 'TRUNCATE') AS platform_truncate
      FROM pg_tables t
      WHERE t.schemaname = 'public' AND t.tablename IN ('company_settings', 'branding');
    `);

    expect(client.rows.length).toBe(2);
    for (const row of client.rows) {
      expect(row.runtime_select).toBe(true);
      expect(row.runtime_update).toBe(true);
      expect(row.runtime_insert).toBe(false);
      expect(row.runtime_delete).toBe(false);
      expect(row.runtime_truncate).toBe(false);
      expect(row.platform_truncate).toBe(false);
    }
  });

  // (g) relrowsecurity and relforcerowsecurity true, at least one policy for app_runtime and one for app_platform, table owner app_owner
  it('(g) relrowsecurity and relforcerowsecurity true, policies exist for runtime and platform, tableowner is app_owner', async () => {
    // Check pg_class and pg_tables
    const tableRes = await platformPool.query<{
      tablename: string;
      tableowner: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(`
      SELECT 
        t.tablename,
        t.tableowner,
        c.relrowsecurity,
        c.relforcerowsecurity
      FROM pg_tables t
      JOIN pg_class c ON c.relname = t.tablename AND c.relnamespace = 'public'::regnamespace
      WHERE t.schemaname = 'public' AND t.tablename IN ('company_settings', 'branding');
    `);

    expect(tableRes.rows.length).toBe(2);
    for (const row of tableRes.rows) {
      expect(row.tableowner).toBe('app_owner');
      expect(row.relrowsecurity).toBe(true);
      expect(row.relforcerowsecurity).toBe(true);
    }

    // Check pg_policies
    const policyRes = await platformPool.query<{
      tablename: string;
      policyname: string;
      roles: string[];
      cmd: string;
    }>(`
      SELECT tablename, policyname, roles::text[] AS roles, cmd
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename IN ('company_settings', 'branding');
    `);

    for (const tbl of ['company_settings', 'branding']) {
      const tblPolicies = policyRes.rows.filter((p) => p.tablename === tbl);
      const runtimePolicies = tblPolicies.filter((p) => p.roles.includes('app_runtime'));
      const platformPolicies = tblPolicies.filter((p) => p.roles.includes('app_platform'));

      expect(runtimePolicies.length).toBeGreaterThanOrEqual(1);
      expect(platformPolicies.length).toBeGreaterThanOrEqual(1);
    }
  });
});
