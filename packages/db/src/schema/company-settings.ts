import { pgTable, uuid, varchar, bigint, timestamp, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants } from './tenants.js';

/**
 * Company settings: 1:1 with tenants.
 * tenant_id is both PK and FK → tenants(id) ON DELETE CASCADE.
 */
export const companySettings = pgTable(
  'company_settings',
  {
    tenantId: uuid('tenant_id')
      .primaryKey()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    contactPhone: varchar('contact_phone', { length: 30 }),
    contactWhatsapp: varchar('contact_whatsapp', { length: 30 }),
    minOrderAmountMillimes: bigint('min_order_amount_millimes', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'chk_company_settings_min_order',
      sql`${table.minOrderAmountMillimes} >= 0`,
    ),
  ],
);

/**
 * Branding: 1:1 with tenants.
 * tenant_id is both PK and FK → tenants(id) ON DELETE CASCADE.
 */
export const branding = pgTable(
  'branding',
  {
    tenantId: uuid('tenant_id')
      .primaryKey()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    storeName: varchar('store_name', { length: 255 }),
    logoKey: varchar('logo_key', { length: 512 }),
    primaryColor: varchar('primary_color', { length: 7 }),
    welcomeMessage: varchar('welcome_message', { length: 1000 }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'chk_branding_primary_color',
      sql`${table.primaryColor} IS NULL OR ${table.primaryColor} ~ '^#[0-9A-Fa-f]{6}$'`,
    ),
  ],
);

export type DbCompanySettings = typeof companySettings.$inferSelect;
export type DbNewCompanySettings = typeof companySettings.$inferInsert;
export type DbBranding = typeof branding.$inferSelect;
export type DbNewBranding = typeof branding.$inferInsert;
