import { Injectable } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { tenantDomains, tenants } from '@repo/db';
import type { TenantContext } from '@repo/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PlatformDb } from '../infra/db/platform-db.js';

interface CacheEntry {
  context: TenantContext | null;
  expiresAt: number;
}

const POSITIVE_CACHE_TTL_MS = 60 * 1000; // 60 seconds as per BP §17
const NEGATIVE_CACHE_TTL_MS = 10 * 1000; // 10 seconds for negative/miss cache
const MAX_CACHE_ENTRIES = 1000;

@Injectable()
export class TenantResolverService {
  private readonly domainCache = new Map<string, CacheEntry>();

  constructor(private readonly platformDb: PlatformDb) {}

  /**
   * Normalizes a raw host string by trimming, lowercasing, and removing port numbers.
   */
  normalizeHost(rawHost: string): string {
    const withoutPort = rawHost.trim().toLowerCase().split(':')[0] ?? '';
    return withoutPort.replace(/\.$/, '');
  }

  /**
   * Sets cache entry ensuring cache size never exceeds MAX_CACHE_ENTRIES.
   * If limit is reached, evicts the oldest entry (first insertion order) before adding.
   */
  private setCache(key: string, entry: CacheEntry): void {
    if (this.domainCache.size >= MAX_CACHE_ENTRIES && !this.domainCache.has(key)) {
      const oldestKey = this.domainCache.keys().next().value;
      if (oldestKey !== undefined) {
        this.domainCache.delete(oldestKey);
      }
    }
    this.domainCache.set(key, entry);
  }

  /**
   * Resolves a tenant by hostname using PlatformDb with in-memory caching.
   * Only resolves if verification_status is 'verified' and tenant is 'active' or 'trial'.
   * Returns TenantContext or null (Fail-closed).
   */
  async resolveByHost(rawHost: string): Promise<TenantContext | null> {
    const normalized = this.normalizeHost(rawHost);
    if (!normalized) {
      return null;
    }

    const cached = this.domainCache.get(normalized);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return cached.context;
    }

    // Query platform tables via PlatformDb - must match verified domain
    const rows = await this.platformDb.db
      .select({
        tenantId: tenants.id,
        slug: tenants.slug,
        name: tenants.name,
        status: tenants.status,
        defaultLocale: tenants.defaultLocale,
      })
      .from(tenantDomains)
      .innerJoin(tenants, eq(tenantDomains.tenantId, tenants.id))
      .where(
        and(
          eq(tenantDomains.hostname, normalized),
          eq(tenantDomains.verificationStatus, 'verified'),
        ),
      )
      .limit(1);

    const record = rows[0];

    // Only active or trial tenants are accessible
    if (!record || (record.status !== 'active' && record.status !== 'trial')) {
      this.setCache(normalized, {
        context: null,
        expiresAt: now + NEGATIVE_CACHE_TTL_MS,
      });
      return null;
    }

    const context: TenantContext = {
      tenantId: record.tenantId,
      slug: record.slug,
      name: record.name,
      status: record.status as TenantContext['status'],
      defaultLocale: record.defaultLocale as 'ar' | 'fr',
    };

    this.setCache(normalized, {
      context,
      expiresAt: now + POSITIVE_CACHE_TTL_MS,
    });

    return context;
  }

  /**
   * Clears in-memory resolution cache (useful for testing or domain updates).
   */
  clearCache(): void {
    this.domainCache.clear();
  }

  /**
   * Returns current cache size (for test verification).
   */
  getCacheSize(): number {
    return this.domainCache.size;
  }
}

