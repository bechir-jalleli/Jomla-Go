import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  index,
  uniqueIndex,
  check,
  unique,
  foreignKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants, citext } from './tenants.js';

/**
 * Users: Admin accounts for distributor staff (Tenant-scoped).
 * In MVP, exactly one Admin account per tenant (enforced by partial unique index).
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    email: citext('email').notNull(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    role: varchar('role', { length: 20 }).notNull().default('admin'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_users_tenant_id').on(table.tenantId),
    uniqueIndex('idx_users_tenant_email').on(table.tenantId, table.email),
    unique('uq_users_tenant_id_id').on(table.tenantId, table.id),
    // Partial unique index: exactly one admin per tenant in MVP (BP §6.3)
    uniqueIndex('idx_users_single_admin_per_tenant')
      .on(table.tenantId)
      .where(sql`${table.role} = 'admin'`),
    check('chk_users_status', sql`${table.status} IN ('active', 'suspended', 'invited')`),
    check('chk_users_role', sql`${table.role} IN ('admin')`),
  ],
);

/**
 * Sessions: Custom session authentication supporting both 'admin' and 'attar' realms.
 * Token is a 256-bit random cryptosecure string, stored exclusively as SHA-256 hash.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    realm: varchar('realm', { length: 20 }).notNull(),
    userId: uuid('user_id'),
    customerId: uuid('customer_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_sessions_tenant_id').on(table.tenantId),
    index('idx_sessions_tenant_user_id').on(table.tenantId, table.userId),
    index('idx_sessions_tenant_customer_id').on(table.tenantId, table.customerId),
    index('idx_sessions_tenant_expires').on(table.tenantId, table.expiresAt),
    check('chk_sessions_realm', sql`${table.realm} IN ('admin', 'attar')`),
    check(
      'chk_sessions_realm_identity',
      sql`(${table.realm} = 'admin' AND ${table.userId} IS NOT NULL) OR (${table.realm} = 'attar' AND ${table.customerId} IS NOT NULL)`,
    ),
    // Composite foreign key to users(tenant_id, id)
    foreignKey({
      columns: [table.tenantId, table.userId],
      foreignColumns: [users.tenantId, users.id],
      name: 'fk_sessions_tenant_user',
    }).onDelete('cascade'),
  ],
);

/**
 * Auth Tokens: Single-use short-lived tokens for password resets and activations.
 */
export const authTokens = pgTable(
  'auth_tokens',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    type: varchar('type', { length: 30 }).notNull(),
    userId: uuid('user_id'),
    customerId: uuid('customer_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_auth_tokens_tenant_id').on(table.tenantId),
    index('idx_auth_tokens_tenant_user_id').on(table.tenantId, table.userId),
    check(
      'chk_auth_tokens_type',
      sql`${table.type} IN ('password_reset', 'account_activation')`,
    ),
    // Composite foreign key to users(tenant_id, id)
    foreignKey({
      columns: [table.tenantId, table.userId],
      foreignColumns: [users.tenantId, users.id],
      name: 'fk_auth_tokens_tenant_user',
    }).onDelete('cascade'),
  ],
);

export type DbUser = typeof users.$inferSelect;
export type DbNewUser = typeof users.$inferInsert;
export type DbSession = typeof sessions.$inferSelect;
export type DbNewSession = typeof sessions.$inferInsert;
export type DbAuthToken = typeof authTokens.$inferSelect;
export type DbNewAuthToken = typeof authTokens.$inferInsert;
