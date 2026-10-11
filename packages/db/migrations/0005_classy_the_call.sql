ALTER TABLE "tenant_domains" ALTER COLUMN "verification_status" SET DEFAULT 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "idx_tenant_domains_single_primary" ON "tenant_domains" USING btree ("tenant_id") WHERE "tenant_domains"."is_primary" = true;--> statement-breakpoint
ALTER TABLE "tenant_domains" ADD CONSTRAINT "chk_tenant_domains_kind" CHECK ("tenant_domains"."kind" IN ('platform', 'custom'));--> statement-breakpoint
ALTER TABLE "tenant_domains" ADD CONSTRAINT "chk_tenant_domains_verification_status" CHECK ("tenant_domains"."verification_status" IN ('pending', 'verified', 'failed'));--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "chk_tenants_status" CHECK ("tenants"."status" IN ('active', 'trial', 'suspended', 'archived'));