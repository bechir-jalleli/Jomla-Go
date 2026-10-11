-- Revoke unpermitted privileges from app_runtime and app_platform
REVOKE INSERT, DELETE, TRUNCATE ON TABLE "company_settings" FROM app_runtime;
REVOKE INSERT, DELETE, TRUNCATE ON TABLE "branding" FROM app_runtime;
REVOKE TRUNCATE ON TABLE "company_settings" FROM app_platform;
REVOKE TRUNCATE ON TABLE "branding" FROM app_platform;

-- Enable and Force RLS
ALTER TABLE "company_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_settings" FORCE ROW LEVEL SECURITY;
ALTER TABLE "branding" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "branding" FORCE ROW LEVEL SECURITY;

-- app_runtime policies: separate SELECT and UPDATE policies with distinct names
CREATE POLICY company_settings_runtime_select ON "company_settings"
  FOR SELECT TO app_runtime
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY company_settings_runtime_update ON "company_settings"
  FOR UPDATE TO app_runtime
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY branding_runtime_select ON "branding"
  FOR SELECT TO app_runtime
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY branding_runtime_update ON "branding"
  FOR UPDATE TO app_runtime
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- app_platform policies: FOR ALL unrestricted access (no TRUNCATE)
CREATE POLICY company_settings_platform_all ON "company_settings"
  FOR ALL TO app_platform
  USING (true)
  WITH CHECK (true);

CREATE POLICY branding_platform_all ON "branding"
  FOR ALL TO app_platform
  USING (true)
  WITH CHECK (true);