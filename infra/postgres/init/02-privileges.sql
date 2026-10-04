-- Revoke CREATE on schema public from PUBLIC
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- Grant USAGE to the three roles
GRANT USAGE ON SCHEMA public TO app_owner, app_runtime, app_platform;
-- app_owner needs CREATE on public schema to create tables
GRANT CREATE ON SCHEMA public TO app_owner;

-- Set default privileges for objects created by app_owner
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public 
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;

ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public 
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_platform;

ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public 
GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO app_runtime, app_platform;
