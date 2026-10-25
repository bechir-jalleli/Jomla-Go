import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import crypto from 'node:crypto';
import { PlatformTenantManager } from './platform-tenant-manager.js';
import * as schema from './schema/index.js';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';

const { Pool } = pg;

const runtimeConnectionString = process.env['DATABASE_TEST_URL'];
const platformConnectionString = process.env['DATABASE_PLATFORM_URL'];

if (!runtimeConnectionString || !platformConnectionString) {
  throw new Error('DATABASE_TEST_URL and DATABASE_PLATFORM_URL are required for tests');
}

describe('Platform Tenant Manager & CLI Operations', () => {
  let platformPool: pg.Pool;
  let runtimePool: pg.Pool;
  let manager: PlatformTenantManager;
  let platformDb: ReturnType<typeof drizzle<typeof schema>>;

  const createdTenantIds: string[] = [];

  beforeAll(async () => {
    platformPool = new Pool({
      connectionString: platformConnectionString,
      max: 2,
    });
    runtimePool = new Pool({
      connectionString: runtimeConnectionString,
      max: 2,
    });

    // Guard: Verify connections are strictly separated
    const pRes = await platformPool.query<{ current_user: string }>('SELECT current_user;');
    expect(pRes.rows[0]?.current_user).toBe('app_platform');

    const rRes = await runtimePool.query<{ current_user: string }>('SELECT current_user;');
    expect(rRes.rows[0]?.current_user).toBe('app_runtime');

    manager = new PlatformTenantManager(platformPool);
    platformDb = drizzle(platformPool, { schema });
  });

  afterAll(async () => {
    // Cleanup created test tenants
    for (const tid of createdTenantIds) {
      try {
        await platformPool.query('DELETE FROM tenants WHERE id = $1;', [tid]);
      } catch {
        // ignore
      }
    }
    await platformPool.end();
    await runtimePool.end();
  });

  it('atomically creates a tenant, primary domain, company settings, and branding', async () => {
    const slug = `cli-test-${crypto.randomBytes(4).toString('hex')}`;
    const domain = `${slug}.jomla.local`;

    const result = await manager.createTenant({
      slug,
      name: 'CLI Test Enterprise',
      primaryHostname: domain,
      contactPhone: '+21671000111',
      contactWhatsapp: '+21698000111',
      minOrderAmountMillimes: 50000n,
      storeName: 'CLI Test Store',
      primaryColor: '#10b981',
      welcomeMessage: 'Welcome from CLI test',
    });

    expect(result.tenantId).toBeDefined();
    expect(result.slug).toBe(slug);
    expect(result.name).toBe('CLI Test Enterprise');
    expect(result.status).toBe('active');
    expect(result.primaryHostname).toBe(domain);

    createdTenantIds.push(result.tenantId);

    // Verify in DB via platformDb
    const tenantRow = await platformDb.query.tenants.findFirst({
      where: eq(schema.tenants.id, result.tenantId),
    });
    expect(tenantRow).toBeDefined();
    expect(tenantRow?.status).toBe('active');
    expect(tenantRow?.defaultLocale).toBe('ar');

    const domainRow = await platformDb.query.tenantDomains.findFirst({
      where: eq(schema.tenantDomains.tenantId, result.tenantId),
    });
    expect(domainRow).toBeDefined();
    expect(domainRow?.hostname).toBe(domain);
    expect(domainRow?.isPrimary).toBe(true);
    expect(domainRow?.verificationStatus).toBe('verified');

    const settingsRow = await platformDb.query.companySettings.findFirst({
      where: eq(schema.companySettings.tenantId, result.tenantId),
    });
    expect(settingsRow).toBeDefined();
    expect(settingsRow?.contactPhone).toBe('+21671000111');
    expect(settingsRow?.minOrderAmountMillimes).toBe(50000n);

    const brandingRow = await platformDb.query.branding.findFirst({
      where: eq(schema.branding.tenantId, result.tenantId),
    });
    expect(brandingRow).toBeDefined();
    expect(brandingRow?.storeName).toBe('CLI Test Store');
    expect(brandingRow?.primaryColor).toBe('#10b981');
  });

  it('adds an additional custom domain and handles primary domain switching', async () => {
    const slug = `cli-dom-${crypto.randomBytes(4).toString('hex')}`;
    const primaryDomain = `${slug}.jomla.local`;
    const customDomain = `orders.${slug}.tn`;

    const tenant = await manager.createTenant({
      slug,
      name: 'Multi Domain Tenant',
      primaryHostname: primaryDomain,
    });
    createdTenantIds.push(tenant.tenantId);

    // Add secondary custom domain
    const secondary = await manager.addDomain({
      tenantId: tenant.tenantId,
      hostname: customDomain,
      kind: 'custom',
      isPrimary: false,
    });
    expect(secondary.hostname).toBe(customDomain);
    expect(secondary.isPrimary).toBe(false);

    // Check both domains exist
    const domains = await platformDb.query.tenantDomains.findMany({
      where: eq(schema.tenantDomains.tenantId, tenant.tenantId),
    });
    expect(domains).toHaveLength(2);

    // Add a new primary domain
    const newPrimaryDomain = `shop.${slug}.tn`;
    await manager.addDomain({
      tenantId: tenant.tenantId,
      hostname: newPrimaryDomain,
      kind: 'custom',
      isPrimary: true,
    });

    const updatedDomains = await platformDb.query.tenantDomains.findMany({
      where: eq(schema.tenantDomains.tenantId, tenant.tenantId),
    });
    const primaries = updatedDomains.filter((d) => d.isPrimary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0]?.hostname).toBe(newPrimaryDomain);
  });

  it('suspends and reactivates a tenant by slug or UUID', async () => {
    const slug = `cli-susp-${crypto.randomBytes(4).toString('hex')}`;
    const domain = `${slug}.jomla.local`;

    const tenant = await manager.createTenant({
      slug,
      name: 'Suspension Test',
      primaryHostname: domain,
    });
    createdTenantIds.push(tenant.tenantId);

    // Suspend by slug
    const suspended = await manager.suspendTenant(slug);
    expect(suspended.status).toBe('suspended');

    const checkSusp = await platformDb.query.tenants.findFirst({
      where: eq(schema.tenants.id, tenant.tenantId),
    });
    expect(checkSusp?.status).toBe('suspended');

    // Reactivate by UUID
    const reactivated = await manager.activateTenant(tenant.tenantId);
    expect(reactivated.status).toBe('active');

    const checkAct = await platformDb.query.tenants.findFirst({
      where: eq(schema.tenants.id, tenant.tenantId),
    });
    expect(checkAct?.status).toBe('active');
  });

  it('denies app_runtime from performing tenant manager operations (42501)', async () => {
    // Attempting to run manager with runtimePool must fail due to permission denial on tenants
    const unauthorizedManager = new PlatformTenantManager(runtimePool);

    await expect(
      unauthorizedManager.createTenant({
        slug: 'unauth-tenant',
        name: 'Unauthorized',
        primaryHostname: 'unauth.jomla.local',
      }),
    ).rejects.toThrow();
  });
});
