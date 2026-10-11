import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  check,
  customType,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// PostgreSQL citext column definition
export const citext = customType<{ data: string }>({
  dataType() {
    return 'citext';
  },
});

export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey(),
    slug: varchar('slug', { length: 63 }).notNull().unique(),
    name: varchar('name', { length: 255 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    defaultLocale: varchar('default_locale', { length: 5 }).notNull().default('ar'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_tenants_status').on(table.status),
    check(
      'chk_tenants_status',
      sql`${table.status} IN ('active', 'trial', 'suspended', 'archived')`,
    ),
  ],
);

export const tenantDomains = pgTable(
  'tenant_domains',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    hostname: citext('hostname').notNull().unique(),
    kind: varchar('kind', { length: 20 }).notNull().default('platform'),
    isPrimary: boolean('is_primary').notNull().default(false),
    verificationStatus: varchar('verification_status', { length: 20 })
      .notNull()
      .default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_tenant_domains_tenant_id').on(table.tenantId),
    check(
      'chk_tenant_domains_kind',
      sql`${table.kind} IN ('platform', 'custom')`,
    ),
    check(
      'chk_tenant_domains_verification_status',
      sql`${table.verificationStatus} IN ('pending', 'verified', 'failed')`,
    ),
    uniqueIndex('idx_tenant_domains_single_primary')
      .on(table.tenantId)
      .where(sql`${table.isPrimary} = true`),
  ],
);

export type DbTenant = typeof tenants.$inferSelect;
export type DbNewTenant = typeof tenants.$inferInsert;
export type DbTenantDomain = typeof tenantDomains.$inferSelect;
export type DbNewTenantDomain = typeof tenantDomains.$inferInsert;

