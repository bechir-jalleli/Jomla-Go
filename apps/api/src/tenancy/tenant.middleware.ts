import { Injectable, type NestMiddleware, NotFoundException } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { TenantResolverService } from './tenant-resolver.service.js';
import { runWithTenantContext } from './tenant-context.js';

/**
 * Narrow request shape for the middleware — avoids `any` while staying
 * framework-agnostic. Fastify's @fastify/middie sets `originalUrl` to the
 * unmodified request URL; `url` is rewritten after route matching (always
 * `/` for `forRoutes('*')`).
 */
interface RawRequest {
  url?: string;
  originalUrl?: string;
  method?: string;
  headers: Record<string, string | string[] | undefined>;
}

const HEALTH_PATHS: ReadonlySet<string> = new Set(['/api/health', '/health']);
const BYPASS_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD']);

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(private readonly tenantResolver: TenantResolverService) {}

  async use(
    req: RawRequest,
    _res: unknown,
    next: (err?: Error) => void,
  ): Promise<void> {
    // originalUrl preserves the full path; url is rewritten by Fastify.
    const rawUrl = req.originalUrl ?? req.url ?? '';
    const pathname = rawUrl.split('?')[0] ?? '';
    const method = (req.method ?? '').toUpperCase();

    // Bypass health probes — exact pathname, GET/HEAD only, no normalization.
    if (BYPASS_METHODS.has(method) && HEALTH_PATHS.has(pathname)) {
      return next();
    }

    // Only trust X-Tenant-Host header when explicitly enabled (e.g. behind reverse proxy in prod)
    const trustProxyHeader = process.env['TRUST_TENANT_HOST_HEADER'] === 'true';
    const proxyHeader = req.headers['x-tenant-host'];
    const proxyHost = Array.isArray(proxyHeader) ? proxyHeader[0] : proxyHeader;

    const hostHeader = req.headers['host'];
    const directHost = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;

    const rawHost = trustProxyHeader && proxyHost ? proxyHost : directHost;

    if (!rawHost) {
      throw new NotFoundException('Missing host header for tenant resolution');
    }

    const tenantContext = await this.tenantResolver.resolveByHost(rawHost);
    if (!tenantContext) {
      throw new NotFoundException('Tenant not found or inactive');
    }

    // Run the remaining pipeline inside AsyncLocalStorage tenant context
    try {
      await runWithTenantContext(tenantContext, () => {
        next();
      });
    } catch (error) {
      next(error as Error);
    }
  }
}
