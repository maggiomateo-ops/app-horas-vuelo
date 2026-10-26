-- PREPARED ONLY. Metadata queries for separately authorized disposable target; never run here.
-- Control-plane branch/endpoint identity + denylist verification MUST precede SQL connection.
-- Database name alone cannot distinguish Neon parent from disposable branch.
SELECT current_database(),current_user,session_user,current_setting('server_version'),current_setting('transaction_isolation');
SELECT rolname,rolcanlogin,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname IN (current_user,session_user,'app_runtime','app_horas_runtime');
SELECT version,filename,checksum_sha256 FROM public.schema_migrations ORDER BY version;
-- Coordinator compares exact checkout expected-ledger.json and independently sourced any extra
-- version. Baseline 001–008 byte-exact reconciled; 009 reserved for Hours V2 only.
-- Missing/extra/changed version HALTS. NO adoption or ledger writes.
SELECT n.nspname,c.relname,c.relkind,pg_get_userbyid(c.relowner) AS owner,c.relrowsecurity,c.relforcerowsecurity,c.relacl
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('app','audit','hours_v2_private')
 ORDER BY n.nspname,c.relname;
SELECT n.nspname,c.relname,a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attacl
 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('app','audit') AND a.attnum>0 AND NOT a.attisdropped ORDER BY n.nspname,c.relname,a.attnum;
SELECT conrelid::regclass,conname,pg_get_constraintdef(oid),condeferrable,condeferred FROM pg_constraint
 WHERE connamespace IN (SELECT oid FROM pg_namespace WHERE nspname IN ('app','audit')) ORDER BY conrelid::regclass::text,conname;
SELECT defaclrole::regrole,defaclnamespace::regnamespace,defaclobjtype,defaclacl FROM pg_default_acl;
-- Save baseline before forced-rollback.sql, compare byte-normalized metadata on NEW connection
-- afterwards. New V2 tables/roles/functions/columns must be absent; baseline ledger/grants identical.
