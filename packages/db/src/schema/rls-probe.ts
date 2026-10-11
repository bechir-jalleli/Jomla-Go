import { pgTable, uuid, text } from 'drizzle-orm/pg-core';

/**
 * Temporary probe table used to verify the migration pipeline
 * and to test RLS policies in Task 8. No RLS applied yet.
 */
export const rlsProbe = pgTable('rls_probe', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
});
