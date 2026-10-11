ALTER TABLE "rls_probe" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rls_probe" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "rls_probe" TO app_runtime
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "rls_probe" TO app_runtime;