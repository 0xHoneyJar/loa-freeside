-- PostgreSQL Initialization Script
--
-- Sprint 38: Drizzle Schema Design
--
-- Sets up the database with proper roles and extensions for RLS.
-- This script runs on container first startup.

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create application roles
DO $$
BEGIN
    -- App user role (uses RLS)
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arrakis_app') THEN
        CREATE ROLE arrakis_app LOGIN PASSWORD 'arrakis_app_password';
    END IF;

    -- Admin role (bypasses RLS)
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arrakis_admin') THEN
        CREATE ROLE arrakis_admin LOGIN PASSWORD 'arrakis_admin_password' BYPASSRLS;
    END IF;
END
$$;

-- Grant permissions
GRANT CONNECT ON DATABASE arrakis TO arrakis_app;
GRANT CONNECT ON DATABASE arrakis TO arrakis_admin;

-- Create schema for app tables
CREATE SCHEMA IF NOT EXISTS public;

-- Grant schema permissions
GRANT USAGE ON SCHEMA public TO arrakis_app;
GRANT USAGE ON SCHEMA public TO arrakis_admin;
GRANT ALL ON SCHEMA public TO arrakis;

-- Set default search path
ALTER DATABASE arrakis SET search_path TO public;

-- Log initialization
DO $$
BEGIN
    RAISE NOTICE 'Arrakis database initialized successfully';
END
$$;
