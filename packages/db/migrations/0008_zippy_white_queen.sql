CREATE TABLE "auth_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"type" varchar(30) NOT NULL,
	"user_id" uuid,
	"customer_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "chk_auth_tokens_type" CHECK ("auth_tokens"."type" IN ('password_reset', 'account_activation'))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"realm" varchar(20) NOT NULL,
	"user_id" uuid,
	"customer_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "chk_sessions_realm" CHECK ("sessions"."realm" IN ('admin', 'attar')),
	CONSTRAINT "chk_sessions_realm_identity" CHECK (("sessions"."realm" = 'admin' AND "sessions"."user_id" IS NOT NULL) OR ("sessions"."realm" = 'attar' AND "sessions"."customer_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" "citext" NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"role" varchar(20) DEFAULT 'admin' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_users_tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "chk_users_status" CHECK ("users"."status" IN ('active', 'suspended', 'invited')),
	CONSTRAINT "chk_users_role" CHECK ("users"."role" IN ('admin'))
);
--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "fk_auth_tokens_tenant_user" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "fk_sessions_tenant_user" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_auth_tokens_tenant_id" ON "auth_tokens" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_auth_tokens_tenant_user_id" ON "auth_tokens" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_sessions_tenant_id" ON "sessions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_sessions_tenant_user_id" ON "sessions" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_sessions_tenant_customer_id" ON "sessions" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "idx_sessions_tenant_expires" ON "sessions" USING btree ("tenant_id","expires_at");--> statement-breakpoint
CREATE INDEX "idx_users_tenant_id" ON "users" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_users_tenant_email" ON "users" USING btree ("tenant_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_users_single_admin_per_tenant" ON "users" USING btree ("tenant_id") WHERE "users"."role" = 'admin';