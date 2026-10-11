import { z } from 'zod';

export const TenantStatus = {
  TRIAL: 'trial',
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  ARCHIVED: 'archived',
} as const;

export type TenantStatus = (typeof TenantStatus)[keyof typeof TenantStatus];

export const tenantStatusSchema = z.enum([
  TenantStatus.TRIAL,
  TenantStatus.ACTIVE,
  TenantStatus.SUSPENDED,
  TenantStatus.ARCHIVED,
]);

export const TenantDomainKind = {
  PLATFORM: 'platform',
  CUSTOM: 'custom',
} as const;

export type TenantDomainKind = (typeof TenantDomainKind)[keyof typeof TenantDomainKind];

export const tenantDomainKindSchema = z.enum([
  TenantDomainKind.PLATFORM,
  TenantDomainKind.CUSTOM,
]);

export const DomainVerificationStatus = {
  PENDING: 'pending',
  VERIFIED: 'verified',
  FAILED: 'failed',
} as const;

export type DomainVerificationStatus =
  (typeof DomainVerificationStatus)[keyof typeof DomainVerificationStatus];

export const domainVerificationStatusSchema = z.enum([
  DomainVerificationStatus.PENDING,
  DomainVerificationStatus.VERIFIED,
  DomainVerificationStatus.FAILED,
]);

export const tenantSchema = z
  .object({
    id: z.string().uuid(),
    slug: z
      .string()
      .min(2)
      .max(63)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase alphanumeric with hyphens'),
    name: z.string().min(1).max(255),
    status: tenantStatusSchema.default(TenantStatus.ACTIVE),
    defaultLocale: z.enum(['ar', 'fr']).default('ar'),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();

export type Tenant = z.infer<typeof tenantSchema>;

export const tenantDomainSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    hostname: z
      .string()
      .min(3)
      .max(255)
      .regex(
        /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/,
        'Invalid hostname format',
      ),
    kind: tenantDomainKindSchema,
    isPrimary: z.boolean().default(false),
    verificationStatus: domainVerificationStatusSchema.default(DomainVerificationStatus.VERIFIED),
    createdAt: z.date(),
  })
  .strict();

export type TenantDomain = z.infer<typeof tenantDomainSchema>;

export const tenantContextSchema = z
  .object({
    tenantId: z.string().uuid(),
    slug: z.string(),
    name: z.string(),
    status: tenantStatusSchema,
    defaultLocale: z.enum(['ar', 'fr']),
  })
  .strict();

export type TenantContext = z.infer<typeof tenantContextSchema>;
