import { AsyncLocalStorage } from 'node:async_hooks';
import type { TenantContext } from '@repo/contracts';

export class TenantContextMissingException extends Error {
  constructor(message = 'Tenant context is missing for tenant-scoped operation') {
    super(message);
    this.name = 'TenantContextMissingException';
  }
}

const asyncLocalStorage = new AsyncLocalStorage<TenantContext>();

export function getTenantContext(): TenantContext | undefined {
  return asyncLocalStorage.getStore();
}

export function getRequiredTenantContext(): TenantContext {
  const context = asyncLocalStorage.getStore();
  if (!context) {
    throw new TenantContextMissingException();
  }
  return context;
}

export async function runWithTenantContext<T>(
  context: TenantContext,
  fn: () => T | Promise<T>,
): Promise<T> {
  return asyncLocalStorage.run(context, fn);
}
