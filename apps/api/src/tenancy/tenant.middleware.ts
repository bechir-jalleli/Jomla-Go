import { Injectable, type NestMiddleware, NotFoundException } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { TenantResolverService } from './tenant-resolver.service.js';
import { runWithTenantContext } from './tenant-context.js';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(private readonly tenantResolver: TenantResolverService) {}

  async use(
    req: IncomingMessage,
    res: ServerResponse,
    next: (err?: Error) => void,
  ): Promise<void> {
    const rawUrl = req.url ?? '';
    const pathname = rawUrl.split('?')[0] ?? '';

    // Bypass health check endpoints (strictly platform-level health probes)
    if (pathname === '/api/health' || pathname === '/health') {
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

