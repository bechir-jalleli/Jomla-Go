CREATE TABLE "branding" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"store_name" varchar(255),
	"logo_key" varchar(512),
	"primary_color" varchar(7),
	"welcome_message" varchar(1000),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_branding_primary_color" CHECK ("branding"."primary_color" IS NULL OR "branding"."primary_color" ~ '^#[0-9A-Fa-f]{6}$')
);
--> statement-breakpoint
CREATE TABLE "company_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"contact_phone" varchar(30),
	"contact_whatsapp" varchar(30),
	"min_order_amount_millimes" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_company_settings_min_order" CHECK ("company_settings"."min_order_amount_millimes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "branding" ADD CONSTRAINT "branding_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;