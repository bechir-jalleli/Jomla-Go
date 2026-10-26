import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import type pg from 'pg';
import crypto from 'node:crypto';
import * as schema from './schema/index.js';

export interface CreateTenantInput {
  name: string;
  slug: string;
  primaryHostname: string;
  defaultLocale?: string;
  contactPhone?: string;
  contactWhatsapp?: string;
  minOrderAmountMillimes?: bigint;
  storeName?: string;
  primaryColor?: string;
  welcomeMessage?: string;
}

export interface TenantManagementResult {
  tenantId: string;
  slug: string;
  name: string;
  status: string;
  primaryHostname: string;
}

export class PlatformTenantManager {
  private readonly db: NodePgDatabase<typeof schema>;
  private readonly pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
    this.db = drizzle(this.pool, { schema });
  }

  /**
   * Atomically create a tenant, primary domain, default company_settings, and default branding.
   * Runs in a single transaction via app_platform.
   */
  async createTenant(input: CreateTenantInput): Promise<TenantManagementResult> {
    const tenantId = crypto.randomUUID();
    const domainId = crypto.randomUUID();

    // Enforce slug & hostname normalization
    const slug = input.slug.trim().toLowerCase();
    const primaryHostname = input.primaryHostname.trim().toLowerCase();
    const name = input.name.trim();

    return await this.db.transaction(async (tx) => {
      // 1. Insert tenant
      await tx.insert(schema.tenants).values({
        id: tenantId,
        slug,
        name,
        status: 'active',
        defaultLocale: input.defaultLocale || 'ar',
      });

      // 2. Insert primary domain
      await tx.insert(schema.tenantDomains).values({
        id: domainId,
        tenantId,
        hostname: primaryHostname,
        kind: 'platform',
        isPrimary: true,
        verificationStatus: 'verified',
      });

      // 3. Insert company settings
      await tx.insert(schema.companySettings).values({
        tenantId,
        contactPhone: input.contactPhone || null,
        contactWhatsapp: input.contactWhatsapp || null,
        minOrderAmountMillimes: input.minOrderAmountMillimes ?? 0n,
      });

      // 4. Insert branding
      await tx.insert(schema.branding).values({
        tenantId,
        storeName: input.storeName || name,
        primaryColor: input.primaryColor || null,
        welcomeMessage: input.welcomeMessage || null,
      });

      return {
        tenantId,
        slug,
        name,
        status: 'active',
        primaryHostname,
      };
    });
  }

  /**
   * Add a domain (custom or platform) to an existing tenant.
   */
  async addDomain(input: {
    tenantId: string;
    hostname: string;
    kind?: 'platform' | 'custom';
    isPrimary?: boolean;
  }): Promise<{ id: string; hostname: string; isPrimary: boolean }> {
    const id = crypto.randomUUID();
    const hostname = input.hostname.trim().toLowerCase();
    const kind = input.kind || 'custom';
    const isPrimary = input.isPrimary || false;

    return await this.db.transaction(async (tx) => {
      if (isPrimary) {
        // Demote existing primary domain if this becomes primary
        await tx
          .update(schema.tenantDomains)
          .set({ isPrimary: false })
          .where(eq(schema.tenantDomains.tenantId, input.tenantId));
      }

      await tx.insert(schema.tenantDomains).values({
        id,
        tenantId: input.tenantId,
        hostname,
        kind,
        isPrimary,
        verificationStatus: kind === 'platform' ? 'verified' : 'pending',
      });

      return { id, hostname, isPrimary };
    });
  }

  /**
   * Suspend a tenant.
   */
  async suspendTenant(tenantIdOrSlug: string): Promise<TenantManagementResult> {
    return this.updateTenantStatus(tenantIdOrSlug, 'suspended');
  }

  /**
   * Activate or reactivate a tenant.
   */
  async activateTenant(tenantIdOrSlug: string): Promise<TenantManagementResult> {
    return this.updateTenantStatus(tenantIdOrSlug, 'active');
  }

  private async updateTenantStatus(
    tenantIdOrSlug: string,
    status: 'active' | 'suspended' | 'trial' | 'archived',
  ): Promise<TenantManagementResult> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantIdOrSlug);
    const whereCondition = isUuid
      ? eq(schema.tenants.id, tenantIdOrSlug)
      : eq(schema.tenants.slug, tenantIdOrSlug.trim().toLowerCase());

    const existing = await this.db.query.tenants.findFirst({
      where: whereCondition,
    });

    if (!existing) {
      throw new Error(`Tenant not found: ${tenantIdOrSlug}`);
    }

    await this.db
      .update(schema.tenants)
      .set({ status, updatedAt: new Date() })
      .where(eq(schema.tenants.id, existing.id));

    const primaryDomain = await this.db.query.tenantDomains.findFirst({
      where: eq(schema.tenantDomains.tenantId, existing.id),
    });

    return {
      tenantId: existing.id,
      slug: existing.slug,
      name: existing.name,
      status,
      primaryHostname: primaryDomain?.hostname ?? '',
    };
  }
}
