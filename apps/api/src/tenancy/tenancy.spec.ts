import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import pg from 'pg';
import crypto from 'node:crypto';
import { Controller, Get, Patch, Body } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  getTenantContext,
  getRequiredTenantContext,
  runWithTenantContext,
  TenantContextMissingException,
} from './tenant-context.js';
import { TenantResolverService } from './tenant-resolver.service.js';
import { PlatformDb, PLATFORM_PG_POOL, RUNTIME_PG_POOL } from '../infra/db/platform-db.js';
import { TenantDb } from '../infra/db/tenant-db.js';
import { TenancyModule } from './tenancy.module.js';
import { TenantMiddleware } from './tenant.middleware.js';
import { rlsProbe, companySettings, branding } from '@repo/db';
import { eq } from 'drizzle-orm';

const { Pool } = pg;

const runtimeConnectionString = process.env['DATABASE_TEST_URL'];
if (!runtimeConnectionString) {
  throw new Error('DATABASE_TEST_URL environment variable is required for tests');
}
const platformConnectionString = process.env['DATABASE_PLATFORM_URL'];
if (!platformConnectionString) {
  throw new Error('DATABASE_PLATFORM_URL environment variable is required for tests');
}

@Controller('test-tenant')
class TestTenantController {
  constructor(private readonly tenantDb: TenantDb) {}

  @Get('info')
  getTenantInfo() {
    const context = getRequiredTenantContext();
    return { tenantId: context.tenantId, slug: context.slug };
  }

  @Get('settings')
  async getSettings() {
    return this.tenantDb.query(async (db) => {
      const res = await db.select().from(companySettings);
      const row = res[0];
      if (!row) return null;
      return {
        ...row,
        minOrderAmountMillimes: row.minOrderAmountMillimes.toString(),
      };
    });
  }

  @Get('branding')
  async getBranding() {
    return this.tenantDb.query(async (db) => {
      const res = await db.select().from(branding);
      return res[0] ?? null;
    });
  }

  @Patch('settings')
  async updateSettings(@Body() body: { contactPhone?: string }) {
    const context = getRequiredTenantContext();
    return this.tenantDb.transaction(async (tx) => {
      await tx
        .update(companySettings)
        .set({ contactPhone: body.contactPhone })
        .where(eq(companySettings.tenantId, context.tenantId));
      const res = await tx
        .select()
        .from(companySettings)
        .where(eq(companySettings.tenantId, context.tenantId));
      const row = res[0];
      if (!row) return null;
      return {
        ...row,
        minOrderAmountMillimes: row.minOrderAmountMillimes.toString(),
      };
    });
  }

  @Get('concurrent-read')
  async concurrentRead() {
    return this.tenantDb.transaction(async (tx) => {
      // Simulate real I/O delay inside the tenant transaction
      await new Promise((resolve) => setTimeout(resolve, 25));
      const s = await tx.select().from(companySettings);
      const b = await tx.select().from(branding);
      return {
        tenantId: s[0]?.tenantId,
        contactPhone: s[0]?.contactPhone,
        storeName: b[0]?.storeName,
      };
    });
  }
}

describe('Tenancy Core: Context, Resolver, Middleware, TenantDb & HTTP Integration', () => {
  let runtimePool: pg.Pool;
  let platformPool: pg.Pool;
  let platformDb: PlatformDb;
  let tenantDb: TenantDb;
  let tenantResolver: TenantResolverService;
  let app: NestFastifyApplication;

  const tenantAId = crypto.randomUUID();
  const tenantASlug = `tenant-a-${crypto.randomBytes(4).toString('hex')}`;
  const tenantAHost = `${tenantASlug}.platform.test`;

  const tenantBId = crypto.randomUUID();
  const tenantBSlug = `tenant-b-${crypto.randomBytes(4).toString('hex')}`;
  const tenantBHost = `${tenantBSlug}.platform.test`;

  const pendingTenantId = crypto.randomUUID();
  const pendingSlug = `pending-${crypto.randomBytes(4).toString('hex')}`;
  const pendingHost = `${pendingSlug}.platform.test`;

  beforeAll(async () => {
    runtimePool = new Pool({
      connectionString: runtimeConnectionString,
      max: 5,
    });
    platformPool = new Pool({
      connectionString: platformConnectionString,
      max: 5,
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

    platformDb = new PlatformDb(platformPool);
    tenantDb = new TenantDb(runtimePool);
    tenantResolver = new TenantResolverService(platformDb);
    // TenantMiddleware is exercised via the NestJS app.inject integration tests below

    // Initial seeding performed strictly using app_platform
    const client = await platformPool.connect();
    try {
      // Seed Tenant A (verified)
      await client.query(
        'INSERT INTO tenants (id, slug, name, status, default_locale) VALUES ($1, $2, $3, $4, $5)',
        [tenantAId, tenantASlug, 'Company A', 'active', 'ar'],
      );
      await client.query(
        'INSERT INTO tenant_domains (id, tenant_id, hostname, kind, is_primary, verification_status) VALUES ($1, $2, $3, $4, $5, $6)',
        [crypto.randomUUID(), tenantAId, tenantAHost, 'platform', true, 'verified'],
      );

      // Seed Tenant B (verified)
      await client.query(
        'INSERT INTO tenants (id, slug, name, status, default_locale) VALUES ($1, $2, $3, $4, $5)',
        [tenantBId, tenantBSlug, 'Company B', 'active', 'ar'],
      );
      await client.query(
        'INSERT INTO tenant_domains (id, tenant_id, hostname, kind, is_primary, verification_status) VALUES ($1, $2, $3, $4, $5, $6)',
        [crypto.randomUUID(), tenantBId, tenantBHost, 'platform', true, 'verified'],
      );

      // Seed Pending Tenant
      await client.query(
        'INSERT INTO tenants (id, slug, name, status, default_locale) VALUES ($1, $2, $3, $4, $5)',
        [pendingTenantId, pendingSlug, 'Pending Co', 'active', 'ar'],
      );
      await client.query(
        'INSERT INTO tenant_domains (id, tenant_id, hostname, kind, is_primary, verification_status) VALUES ($1, $2, $3, $4, $5, $6)',
        [crypto.randomUUID(), pendingTenantId, pendingHost, 'platform', true, 'pending'],
      );

      // Seed real tenant tables (company_settings and branding) for Tenant A and Tenant B via app_platform
      await client.query(
        'INSERT INTO company_settings (tenant_id, contact_phone, contact_whatsapp, min_order_amount_millimes) VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)',
        [tenantAId, '+21671000001', '+21671000001', 50000n, tenantBId, '+21671000002', '+21671000002', 100000n],
      );
      await client.query(
        'INSERT INTO branding (tenant_id, store_name, primary_color, welcome_message) VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)',
        [tenantAId, 'Store A', '#112233', 'Welcome to Store A', tenantBId, 'Store B', '#445566', 'Welcome to Store B'],
      );
    } finally {
      client.release();
    }

    // Build Fastify Nest application for real HTTP integration tests
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TenancyModule],
      controllers: [TestTenantController],
    })
      .overrideProvider(PLATFORM_PG_POOL)
      .useValue(platformPool)
      .overrideProvider(RUNTIME_PG_POOL)
      .useValue(runtimePool)
      .compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    tenantResolver = moduleFixture.get(TenantResolverService);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    // Cleanup seeded tenants using platformPool
    const client = await platformPool.connect();
    try {
      await client.query('DELETE FROM tenants WHERE id IN ($1, $2, $3)', [
        tenantAId,
        tenantBId,
        pendingTenantId,
      ]);
    } finally {
      client.release();
      await app.close();
      await runtimePool.end();
      await platformPool.end();
    }
  });

  describe('TenantContext (AsyncLocalStorage)', () => {
    it('returns undefined when no context is active', () => {
      expect(getTenantContext()).toBeUndefined();
    });

    it('throws TenantContextMissingException when required context is missing', () => {
      expect(() => getRequiredTenantContext()).toThrow(TenantContextMissingException);
    });

    it('provides context within runWithTenantContext and isolates concurrent calls', async () => {
      const contextA = {
        tenantId: tenantAId,
        slug: tenantASlug,
        name: 'A',
        status: 'active' as const,
        defaultLocale: 'ar' as const,
      };

      const contextB = {
        tenantId: tenantBId,
        slug: tenantBSlug,
        name: 'B',
        status: 'active' as const,
        defaultLocale: 'fr' as const,
      };

      await Promise.all([
        runWithTenantContext(contextA, async () => {
          await new Promise((r) => setTimeout(r, 10));
          expect(getRequiredTenantContext().tenantId).toBe(tenantAId);
          expect(getRequiredTenantContext().slug).toBe(tenantASlug);
        }),
        runWithTenantContext(contextB, async () => {
          await new Promise((r) => setTimeout(r, 10));
          expect(getRequiredTenantContext().tenantId).toBe(tenantBId);
          expect(getRequiredTenantContext().slug).toBe(tenantBSlug);
        }),
      ]);

      expect(getTenantContext()).toBeUndefined();
    });
  });

  describe('TenantResolverService & Cache Limits', () => {
    it('normalizes raw hostnames by lowercasing and stripping port and dots', () => {
      expect(tenantResolver.normalizeHost('  STORE-1.Platform.Test:8080/  ')).toBe(
        'store-1.platform.test',
      );
    });

    it('resolves active verified tenant by host and caches it', async () => {
      tenantResolver.clearCache();
      const resolved = await tenantResolver.resolveByHost(tenantAHost.toUpperCase());

      expect(resolved).not.toBeNull();
      expect(resolved?.tenantId).toBe(tenantAId);
      expect(resolved?.slug).toBe(tenantASlug);
      expect(resolved?.status).toBe('active');

      const cached = await tenantResolver.resolveByHost(tenantAHost);
      expect(cached?.tenantId).toBe(tenantAId);
    });

    it('fails closed (returns null) for pending domains and activates upon verification', async () => {
      tenantResolver.clearCache();
      const pendingRes = await tenantResolver.resolveByHost(pendingHost);
      expect(pendingRes).toBeNull();

      // Verify domain using app_platform
      const client = await platformPool.connect();
      try {
        await client.query(
          "UPDATE tenant_domains SET verification_status = 'verified' WHERE tenant_id = $1",
          [pendingTenantId],
        );
      } finally {
        client.release();
      }

      // After cache clear, resolver activates the tenant
      tenantResolver.clearCache();
      const activeRes = await tenantResolver.resolveByHost(pendingHost);
      expect(activeRes).not.toBeNull();
      expect(activeRes?.tenantId).toBe(pendingTenantId);
    });

    it('enforces max 1000 cache entries and evicts the oldest entry on insertion', async () => {
      tenantResolver.clearCache();
      // Insert 1001 distinct negative entries
      for (let i = 1; i <= 1001; i++) {
        await tenantResolver.resolveByHost(`dummy-host-${i}.test`);
      }
      expect(tenantResolver.getCacheSize()).toBe(1000);
    });
  });

  describe('TenantDb Isolation with rls_probe', () => {
    it('throws TenantContextMissingException when invoked outside a tenant context', async () => {
      await expect(tenantDb.transaction(async () => {})).rejects.toThrow(
        TenantContextMissingException,
      );
    });

    it('isolates rows in rls_probe so tenant A sees only rows of tenant A', async () => {
      const probeNameA = `Probe-A-${crypto.randomBytes(4).toString('hex')}`;
      const probeNameB = `Probe-B-${crypto.randomBytes(4).toString('hex')}`;

      const contextA = {
        tenantId: tenantAId,
        slug: tenantASlug,
        name: 'Company A',
        status: 'active' as const,
        defaultLocale: 'ar' as const,
      };

      const contextB = {
        tenantId: tenantBId,
        slug: tenantBSlug,
        name: 'Company B',
        status: 'active' as const,
        defaultLocale: 'ar' as const,
      };

      // Insert row under context A
      await runWithTenantContext(contextA, async () => {
        await tenantDb.transaction(async (tx) => {
          await tx.insert(rlsProbe).values({
            id: crypto.randomUUID(),
            tenantId: tenantAId,
            name: probeNameA,
          });
        });
      });

      // Insert row under context B
      await runWithTenantContext(contextB, async () => {
        await tenantDb.transaction(async (tx) => {
          await tx.insert(rlsProbe).values({
            id: crypto.randomUUID(),
            tenantId: tenantBId,
            name: probeNameB,
          });
        });
      });

      // Query under context A: must see probeNameA and NEVER probeNameB
      await runWithTenantContext(contextA, async () => {
        await tenantDb.query(async (db) => {
          const rows = await db.select().from(rlsProbe);
          const names = rows.map((r) => r.name);
          expect(names).toContain(probeNameA);
          expect(names).not.toContain(probeNameB);
        });
      });
    });

    it('isolates real tables (company_settings & branding) via TenantDb queries', async () => {
      const contextA = {
        tenantId: tenantAId,
        slug: tenantASlug,
        name: 'Company A',
        status: 'active' as const,
        defaultLocale: 'ar' as const,
      };

      const contextB = {
        tenantId: tenantBId,
        slug: tenantBSlug,
        name: 'Company B',
        status: 'active' as const,
        defaultLocale: 'ar' as const,
      };

      // 1. Context A sees only tenant A settings and branding
      await runWithTenantContext(contextA, async () => {
        await tenantDb.query(async (db) => {
          const settings = await db.select().from(companySettings);
          expect(settings.length).toBe(1);
          expect(settings[0]?.tenantId).toBe(tenantAId);
          expect(settings[0]?.contactPhone).toBe('+21671000001');

          const brands = await db.select().from(branding);
          expect(brands.length).toBe(1);
          expect(brands[0]?.tenantId).toBe(tenantAId);
          expect(brands[0]?.storeName).toBe('Store A');

          // Explicit filter on tenant B returns 0 rows (fail-closed RLS)
          const leakSettings = await db
            .select()
            .from(companySettings)
            .where(eq(companySettings.tenantId, tenantBId));
          expect(leakSettings.length).toBe(0);

          const leakBranding = await db
            .select()
            .from(branding)
            .where(eq(branding.tenantId, tenantBId));
          expect(leakBranding.length).toBe(0);
        });
      });

      // 2. Context B sees only tenant B settings and branding
      await runWithTenantContext(contextB, async () => {
        await tenantDb.query(async (db) => {
          const settings = await db.select().from(companySettings);
          expect(settings.length).toBe(1);
          expect(settings[0]?.tenantId).toBe(tenantBId);
          expect(settings[0]?.contactPhone).toBe('+21671000002');

          const brands = await db.select().from(branding);
          expect(brands.length).toBe(1);
          expect(brands[0]?.tenantId).toBe(tenantBId);
          expect(brands[0]?.storeName).toBe('Store B');
        });
      });
    });

    it('allows updating own row in real tables, silences cross-tenant update, and rejects tenant_id change', async () => {
      const contextA = {
        tenantId: tenantAId,
        slug: tenantASlug,
        name: 'Company A',
        status: 'active' as const,
        defaultLocale: 'ar' as const,
      };

      await runWithTenantContext(contextA, async () => {
        await tenantDb.transaction(async (tx) => {
          // 1. Update own company_settings works
          const updateOwn = await tx
            .update(companySettings)
            .set({ contactPhone: '+21671999999' })
            .where(eq(companySettings.tenantId, tenantAId));
          expect(updateOwn.rowCount).toBe(1);

          // 2. Cross-tenant update affects 0 rows
          const updateB = await tx
            .update(companySettings)
            .set({ contactPhone: '+21671888888' })
            .where(eq(companySettings.tenantId, tenantBId));
          expect(updateB.rowCount).toBe(0);

          // 3. Attempting to update tenant_id to tenant B fails with RLS WITH CHECK violation
          await expect(
            tx
              .update(companySettings)
              .set({ tenantId: tenantBId })
              .where(eq(companySettings.tenantId, tenantAId)),
          ).rejects.toThrow();
        });
      });

      // Verify via TenantDb in context B that Tenant B's data is unchanged
      const contextB = {
        tenantId: tenantBId,
        slug: tenantBSlug,
        name: 'Company B',
        status: 'active' as const,
        defaultLocale: 'ar' as const,
      };
      await runWithTenantContext(contextB, async () => {
        await tenantDb.query(async (db) => {
          const res = await db
            .select()
            .from(companySettings)
            .where(eq(companySettings.tenantId, tenantBId));
          expect(res[0]?.contactPhone).toBe('+21671000002');
        });
      });

      // Verify via PlatformDb directly that Tenant B was untouched
      const bSettings = await platformDb
        .select()
        .from(companySettings)
        .where(eq(companySettings.tenantId, tenantBId));
      expect(bSettings[0]?.contactPhone).toBe('+21671000002');
    });

    it('denies INSERT and DELETE on real tables under app_runtime via TenantDb', async () => {
      const contextA = {
        tenantId: tenantAId,
        slug: tenantASlug,
        name: 'Company A',
        status: 'active' as const,
        defaultLocale: 'ar' as const,
      };

      const expectPermissionDenied = async (operation: () => Promise<unknown>) => {
        try {
          await operation();
          expect.unreachable('Operation should have thrown permission denied');
        } catch (err: unknown) {
          const pgErr = (err as { cause?: { code?: string; message?: string } })?.cause ??
            (err as { code?: string; message?: string });
          expect(pgErr?.code).toBe('42501');
          const errorMsg = `${(err as Error).message} ${pgErr?.message ?? ''}`;
          expect(errorMsg).toMatch(/permission denied/i);
        }
      };

      await runWithTenantContext(contextA, async () => {
        // INSERT into company_settings denied (least privilege: only app_platform can insert)
        await expectPermissionDenied(() =>
          tenantDb.transaction(async (tx) => {
            await tx.insert(companySettings).values({
              tenantId: tenantAId,
              contactPhone: '+21671000999',
            });
          }),
        );

        // DELETE from company_settings denied
        await expectPermissionDenied(() =>
          tenantDb.transaction(async (tx) => {
            await tx
              .delete(companySettings)
              .where(eq(companySettings.tenantId, tenantAId));
          }),
        );

        // INSERT into branding denied
        await expectPermissionDenied(() =>
          tenantDb.transaction(async (tx) => {
            await tx.insert(branding).values({
              tenantId: tenantAId,
              storeName: 'Illegal Store',
            });
          }),
        );

        // DELETE from branding denied
        await expectPermissionDenied(() =>
          tenantDb.transaction(async (tx) => {
            await tx.delete(branding).where(eq(branding.tenantId, tenantAId));
          }),
        );
      });
    });
  });

  describe('Real HTTP Requests via Fastify app.inject', () => {
    it('resolves concurrent requests with different Hosts to their respective tenants', async () => {
      const [resA, resB] = await Promise.all([
        app.inject({
          method: 'GET',
          url: '/test-tenant/info',
          headers: { host: tenantAHost },
        }),
        app.inject({
          method: 'GET',
          url: '/test-tenant/info',
          headers: { host: tenantBHost },
        }),
      ]);

      expect(resA.statusCode).toBe(200);
      expect(JSON.parse(resA.body).tenantId).toBe(tenantAId);

      expect(resB.statusCode).toBe(200);
      expect(JSON.parse(resB.body).tenantId).toBe(tenantBId);
    });

    it('returns 404 for unknown host', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/test-tenant/info',
        headers: { host: 'unknown-tenant.example.com' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('ignores spoofed x-tenant-host header when TRUST_TENANT_HOST_HEADER=false', async () => {
      process.env['TRUST_TENANT_HOST_HEADER'] = 'false';

      // Send host header as Tenant A, spoofing x-tenant-host as Tenant B
      const res = await app.inject({
        method: 'GET',
        url: '/test-tenant/info',
        headers: {
          host: tenantAHost,
          'x-tenant-host': tenantBHost,
        },
      });

      expect(res.statusCode).toBe(200);
      // Must resolve strictly to Tenant A (from Host), ignoring spoofed x-tenant-host
      expect(JSON.parse(res.body).tenantId).toBe(tenantAId);
    });

    it('trusts x-tenant-host when TRUST_TENANT_HOST_HEADER=true demonstrating proxy spoof vulnerability when misconfigured', async () => {
      process.env['TRUST_TENANT_HOST_HEADER'] = 'true';
      try {
        const res = await app.inject({
          method: 'GET',
          url: '/test-tenant/info',
          headers: {
            host: tenantAHost,
            'x-tenant-host': tenantBHost,
          },
        });

        expect(res.statusCode).toBe(200);
        // With trust enabled, resolves to Tenant B from the header
        expect(JSON.parse(res.body).tenantId).toBe(tenantBId);
      } finally {
        process.env['TRUST_TENANT_HOST_HEADER'] = 'false';
      }
    });

    it('reads company_settings and branding via HTTP strictly for the authenticated tenant', async () => {
      // 1. Tenant A reads its own settings and branding
      const [resSettingsA, resBrandingA] = await Promise.all([
        app.inject({
          method: 'GET',
          url: '/test-tenant/settings',
          headers: { host: tenantAHost },
        }),
        app.inject({
          method: 'GET',
          url: '/test-tenant/branding',
          headers: { host: tenantAHost },
        }),
      ]);

      expect(resSettingsA.statusCode).toBe(200);
      const settingsA = JSON.parse(resSettingsA.body);
      expect(settingsA.tenantId).toBe(tenantAId);
      expect(settingsA.contactPhone).toBe('+21671000001');

      expect(resBrandingA.statusCode).toBe(200);
      const brandingA = JSON.parse(resBrandingA.body);
      expect(brandingA.tenantId).toBe(tenantAId);
      expect(brandingA.storeName).toBe('Store A');

      // 2. Tenant B reads its own settings and branding
      const [resSettingsB, resBrandingB] = await Promise.all([
        app.inject({
          method: 'GET',
          url: '/test-tenant/settings',
          headers: { host: tenantBHost },
        }),
        app.inject({
          method: 'GET',
          url: '/test-tenant/branding',
          headers: { host: tenantBHost },
        }),
      ]);

      expect(resSettingsB.statusCode).toBe(200);
      const settingsB = JSON.parse(resSettingsB.body);
      expect(settingsB.tenantId).toBe(tenantBId);
      expect(settingsB.contactPhone).toBe('+21671000002');

      expect(resBrandingB.statusCode).toBe(200);
      const brandingB = JSON.parse(resBrandingB.body);
      expect(brandingB.tenantId).toBe(tenantBId);
      expect(brandingB.storeName).toBe('Store B');

      // 3. Client under Tenant A attempting to leak Tenant B via query, body, or headers receives only Tenant A data
      const leakAttemptRes = await app.inject({
        method: 'GET',
        url: `/test-tenant/settings?tenantId=${tenantBId}&tenant_id=${tenantBId}`,
        headers: {
          host: tenantAHost,
          'x-tenant-id': tenantBId,
          'x-customer-id': tenantBId,
        },
      });

      expect(leakAttemptRes.statusCode).toBe(200);
      const leakSettings = JSON.parse(leakAttemptRes.body);
      expect(leakSettings.tenantId).toBe(tenantAId);
      expect(leakSettings.contactPhone).toBe('+21671000001');
    });

    it('mutates Tenant A settings via HTTP without modifying Tenant B settings', async () => {
      // 1. Update Tenant A settings via PATCH /test-tenant/settings
      const patchRes = await app.inject({
        method: 'PATCH',
        url: '/test-tenant/settings',
        headers: {
          host: tenantAHost,
          'content-type': 'application/json',
        },
        payload: JSON.stringify({
          contactPhone: '+21671555555',
          tenantId: tenantBId, // Attempted mass-assignment override
        }),
      });

      expect(patchRes.statusCode).toBe(200);
      const updatedA = JSON.parse(patchRes.body);
      expect(updatedA.tenantId).toBe(tenantAId);
      expect(updatedA.contactPhone).toBe('+21671555555');

      // 2. Read Tenant B settings via HTTP and verify Tenant B is completely unchanged
      const resB = await app.inject({
        method: 'GET',
        url: '/test-tenant/settings',
        headers: { host: tenantBHost },
      });

      expect(resB.statusCode).toBe(200);
      const currentB = JSON.parse(resB.body);
      expect(currentB.tenantId).toBe(tenantBId);
      expect(currentB.contactPhone).toBe('+21671000002');

      // 3. Verify directly via PlatformDb that Tenant B was untouched
      const platformB = await platformDb
        .select()
        .from(companySettings)
        .where(eq(companySettings.tenantId, tenantBId));
      expect(platformB[0]?.contactPhone).toBe('+21671000002');
    });

    it('handles 20 concurrent interleaved requests per tenant with transaction delays without leaking context', async () => {
      const requestsA = Array.from({ length: 20 }, () =>
        app.inject({
          method: 'GET',
          url: '/test-tenant/concurrent-read',
          headers: { host: tenantAHost },
        }),
      );

      const requestsB = Array.from({ length: 20 }, () =>
        app.inject({
          method: 'GET',
          url: '/test-tenant/concurrent-read',
          headers: { host: tenantBHost },
        }),
      );

      // Interleave and execute all 40 requests simultaneously
      const results = await Promise.all([...requestsA, ...requestsB]);

      for (let i = 0; i < 20; i++) {
        const resA = results[i]!;
        expect(resA.statusCode).toBe(200);
        const dataA = JSON.parse(resA.body);
        expect(dataA.tenantId).toBe(tenantAId);
        expect(dataA.storeName).toBe('Store A');

        const resB = results[i + 20]!;
        expect(resB.statusCode).toBe(200);
        const dataB = JSON.parse(resB.body);
        expect(dataB.tenantId).toBe(tenantBId);
        expect(dataB.storeName).toBe('Store B');
      }
    });

    it('rejects suspended tenant with 404 after cache clear', async () => {
      // 1. Verify tenant B is initially active and responds with 200
      const initialRes = await app.inject({
        method: 'GET',
        url: '/test-tenant/info',
        headers: { host: tenantBHost },
      });
      expect(initialRes.statusCode).toBe(200);

      // 2. Suspend Tenant B via platformPool
      const client = await platformPool.connect();
      try {
        await client.query("UPDATE tenants SET status = 'suspended' WHERE id = $1", [
          tenantBId,
        ]);
      } finally {
        client.release();
      }

      // 3. Clear tenant resolver cache to force re-evaluation from DB
      tenantResolver.clearCache();

      // 4. Request to suspended tenant must fail closed with 404
      const suspendedRes = await app.inject({
        method: 'GET',
        url: '/test-tenant/info',
        headers: { host: tenantBHost },
      });
      expect(suspendedRes.statusCode).toBe(404);
      expect(JSON.parse(suspendedRes.body).message).toBe('Tenant not found or inactive');

      // 5. Restore tenant B to active for subsequent tests/cleanup
      const restoreClient = await platformPool.connect();
      try {
        await restoreClient.query("UPDATE tenants SET status = 'active' WHERE id = $1", [
          tenantBId,
        ]);
      } finally {
        restoreClient.release();
      }
      tenantResolver.clearCache();
    });

    // --- Health bypass: allowed paths (resolver must NOT be called) ---
    // NOTE: Once a real health controller exists (@Public, no DB), these
    // tests must also assert the controller's response (200 / {ok:true}).

    describe('health bypass — allowed paths', () => {
      it('bypasses GET /api/health', async () => {
        const spy = vi.spyOn(tenantResolver, 'resolveByHost');
        const res = await app.inject({ method: 'GET', url: '/api/health' });
        expect(spy).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(404);
        expect(JSON.parse(res.body).message).toContain('Cannot GET /api/health');
        spy.mockRestore();
      });

      it('bypasses GET /api/health?x=1', async () => {
        const spy = vi.spyOn(tenantResolver, 'resolveByHost');
        const res = await app.inject({ method: 'GET', url: '/api/health?x=1' });
        expect(spy).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(404);
        spy.mockRestore();
      });

      it('bypasses GET /health', async () => {
        const spy = vi.spyOn(tenantResolver, 'resolveByHost');
        const res = await app.inject({ method: 'GET', url: '/health' });
        expect(spy).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(404);
        spy.mockRestore();
      });

      it('bypasses GET /health?probe=1', async () => {
        const spy = vi.spyOn(tenantResolver, 'resolveByHost');
        const res = await app.inject({ method: 'GET', url: '/health?probe=1' });
        expect(spy).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(404);
        spy.mockRestore();
      });

      it('bypasses HEAD /api/health', async () => {
        const spy = vi.spyOn(tenantResolver, 'resolveByHost');
        const res = await app.inject({ method: 'HEAD', url: '/api/health' });
        expect(spy).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(404);
        spy.mockRestore();
      });
    });

    // --- Health bypass: deny cases (resolver IS called, tenant-not-found) ---

    describe('health bypass — deny cases', () => {
      it('does NOT bypass /API/health (case differs)', async () => {
        const res = await app.inject({
          method: 'GET', url: '/API/health',
          headers: { host: 'unknown-host.example.com' },
        });
        expect(res.statusCode).toBe(404);
        expect(JSON.parse(res.body).message).toBe('Tenant not found or inactive');
      });

      it('does NOT bypass /api/%68ealth (percent-encoded)', async () => {
        const res = await app.inject({
          method: 'GET', url: '/api/%68ealth',
          headers: { host: 'unknown-host.example.com' },
        });
        expect(res.statusCode).toBe(404);
        expect(JSON.parse(res.body).message).toBe('Tenant not found or inactive');
      });

      it('does NOT bypass /api/health;x=1 (path param injection)', async () => {
        const res = await app.inject({
          method: 'GET', url: '/api/health;x=1',
          headers: { host: 'unknown-host.example.com' },
        });
        expect(res.statusCode).toBe(404);
        expect(JSON.parse(res.body).message).toBe('Tenant not found or inactive');
      });

      it('does NOT bypass /api/health/../products (path traversal)', async () => {
        const res = await app.inject({
          method: 'GET', url: '/api/health/../products',
          headers: { host: 'unknown-host.example.com' },
        });
        expect(res.statusCode).toBe(404);
        expect(JSON.parse(res.body).message).toBe('Tenant not found or inactive');
      });

      it('does NOT bypass /api/health/..%2Fproducts (encoded traversal)', async () => {
        const res = await app.inject({
          method: 'GET', url: '/api/health/..%2Fproducts',
          headers: { host: 'unknown-host.example.com' },
        });
        expect(res.statusCode).toBe(404);
        expect(JSON.parse(res.body).message).toBe('Tenant not found or inactive');
      });

      it('does NOT bypass POST /api/health (wrong method)', async () => {
        const res = await app.inject({
          method: 'POST', url: '/api/health',
          headers: { host: 'unknown-host.example.com' },
        });
        expect(res.statusCode).toBe(404);
        expect(JSON.parse(res.body).message).toBe('Tenant not found or inactive');
      });

      it('does NOT bypass DELETE /api/health (wrong method)', async () => {
        const res = await app.inject({
          method: 'DELETE', url: '/api/health',
          headers: { host: 'unknown-host.example.com' },
        });
        expect(res.statusCode).toBe(404);
        expect(JSON.parse(res.body).message).toBe('Tenant not found or inactive');
      });

      it('does NOT bypass /api/health/ (trailing slash)', async () => {
        const res = await app.inject({
          method: 'GET', url: '/api/health/',
          headers: { host: 'unknown-host.example.com' },
        });
        expect(res.statusCode).toBe(404);
        expect(JSON.parse(res.body).message).toBe('Tenant not found or inactive');
      });

      it('does NOT bypass //api/health (double slash)', async () => {
        const res = await app.inject({
          method: 'GET', url: '//api/health',
          headers: { host: 'unknown-host.example.com' },
        });
        expect(res.statusCode).toBe(404);
        expect(JSON.parse(res.body).message).toBe('Tenant not found or inactive');
      });

      it('does NOT bypass /api/health-check (different path)', async () => {
        const res = await app.inject({
          method: 'GET', url: '/api/health-check',
          headers: { host: 'unknown-host.example.com' },
        });
        expect(res.statusCode).toBe(404);
        expect(JSON.parse(res.body).message).toBe('Tenant not found or inactive');
      });

      it('does NOT bypass /api/healthz (different path)', async () => {
        const res = await app.inject({
          method: 'GET', url: '/api/healthz',
          headers: { host: 'unknown-host.example.com' },
        });
        expect(res.statusCode).toBe(404);
        expect(JSON.parse(res.body).message).toBe('Tenant not found or inactive');
      });

      it('does NOT bypass /api/healthx?x=/api/health (path smuggling)', async () => {
        const res = await app.inject({
          method: 'GET', url: '/api/healthx?x=/api/health',
          headers: { host: 'unknown-host.example.com' },
        });
        expect(res.statusCode).toBe(404);
        expect(JSON.parse(res.body).message).toBe('Tenant not found or inactive');
      });
    });

    // --- Fail-closed: no originalUrl on the request ---

    it('does not bypass when req has no originalUrl (fail-closed)', async () => {
      const middleware = app.get(TenantMiddleware);
      const fakeReq = {
        url: '/',
        method: 'GET',
        headers: { host: 'unknown-host.example.com' } as Record<string, string | string[] | undefined>,
      };
      const fakeNext = vi.fn();

      await expect(
        middleware.use(fakeReq, {}, fakeNext),
      ).rejects.toThrow('Tenant not found or inactive');
      expect(fakeNext).not.toHaveBeenCalled();
    });

    // --- Normal tenant request through a health sub-path ---

    it('treats /api/health/fake with valid tenant host as normal tenant request', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/health/fake',
        headers: { host: tenantAHost },
      });
      // Middleware ran (valid host resolved), router can't find the route → 404 from router
      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body).message).toContain('Cannot GET /api/health/fake');
    });
  });
});

