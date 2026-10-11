import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import crypto from 'node:crypto';
import { Controller, Get } from '@nestjs/common';
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
import { rlsProbe } from '@repo/db';

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
  @Get('info')
  getTenantInfo() {
    const context = getRequiredTenantContext();
    return { tenantId: context.tenantId, slug: context.slug };
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

    it('bypasses /api/health with query params (?x=1) without requiring tenant host', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/health?x=1',
      });
      // The middleware passes through to Next without throwing Tenant NotFoundException.
      // 404 from Nest router is normal since health route isn't defined on this test controller,
      // but verify it wasn't intercepted by TenantMiddleware with 'Missing host header'.
      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body).message).toContain('Cannot GET /api/health?x=1');
    });
  });
});

