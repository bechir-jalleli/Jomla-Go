REVOKE ALL ON TABLE "tenants" FROM app_runtime;
REVOKE ALL ON TABLE "tenant_domains" FROM app_runtime;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "tenants" TO app_platform;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "tenant_domains" TO app_platform;