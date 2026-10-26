-- Revoke unpermitted privileges from app_runtime and app_platform
-- app_runtime cannot truncate any auth tables
REVOKE TRUNCATE ON TABLE "users" FROM app_runtime;
REVOKE TRUNCATE ON TABLE "sessions" FROM app_runtime;
REVOKE TRUNCATE ON TABLE "auth_tokens" FROM app_runtime;

-- app_runtime cannot insert or delete users directly (users are created by platform CLI / admin invite workflows)
REVOKE INSERT, DELETE ON TABLE "users" FROM app_runtime;

-- app_platform cannot truncate
REVOKE TRUNCATE ON TABLE "users" FROM app_platform;
REVOKE TRUNCATE ON TABLE "sessions" FROM app_platform;
REVOKE TRUNCATE ON TABLE "auth_tokens" FROM app_platform;

-- Enable and Force Row Level Security on all tenant-owned auth tables
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;

ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sessions" FORCE ROW LEVEL SECURITY;

ALTER TABLE "auth_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "auth_tokens" FORCE ROW LEVEL SECURITY;

-- ==========================================================
-- 1. USERS POLICIES
-- ==========================================================
-- app_runtime: SELECT and UPDATE own tenant users
CREATE POLICY users_runtime_select ON "users"
  FOR SELECT TO app_runtime
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY users_runtime_update ON "users"
  FOR UPDATE TO app_runtime
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- app_platform: unrestricted access (no TRUNCATE)
CREATE POLICY users_platform_all ON "users"
  FOR ALL TO app_platform
  USING (true)
  WITH CHECK (true);

-- ==========================================================
-- 2. SESSIONS POLICIES
-- ==========================================================
-- app_runtime: full CRUD within current tenant context (login, read, heartbeat, logout)
CREATE POLICY sessions_runtime_select ON "sessions"
  FOR SELECT TO app_runtime
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY sessions_runtime_insert ON "sessions"
  FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY sessions_runtime_update ON "sessions"
  FOR UPDATE TO app_runtime
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY sessions_runtime_delete ON "sessions"
  FOR DELETE TO app_runtime
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- app_platform: unrestricted access
CREATE POLICY sessions_platform_all ON "sessions"
  FOR ALL TO app_platform
  USING (true)
  WITH CHECK (true);

-- ==========================================================
-- 3. AUTH_TOKENS POLICIES
-- ==========================================================
-- app_runtime: full CRUD within current tenant context
CREATE POLICY auth_tokens_runtime_select ON "auth_tokens"
  FOR SELECT TO app_runtime
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY auth_tokens_runtime_insert ON "auth_tokens"
  FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY auth_tokens_runtime_update ON "auth_tokens"
  FOR UPDATE TO app_runtime
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY auth_tokens_runtime_delete ON "auth_tokens"
  FOR DELETE TO app_runtime
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- app_platform: unrestricted access
CREATE POLICY auth_tokens_platform_all ON "auth_tokens"
  FOR ALL TO app_platform
  USING (true)
  WITH CHECK (true);