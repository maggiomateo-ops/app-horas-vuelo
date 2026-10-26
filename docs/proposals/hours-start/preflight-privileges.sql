-- PREPARED ONLY / NOT EXECUTED. Run after proposed SQL on approved disposable synthetic target.
-- Role names are proposals, not existing production grants. All queries are metadata-only.
SELECT rolname,rolcanlogin,rolinherit,rolbypassrls FROM pg_roles WHERE rolname LIKE 'hours_v2_%' ORDER BY rolname;
SELECT r.rolname,member.rolname AS member FROM pg_auth_members m
 JOIN pg_roles r ON r.oid=m.roleid JOIN pg_roles member ON member.oid=m.member
 WHERE r.rolname LIKE 'hours_v2_%' OR member.rolname LIKE 'hours_v2_%';
-- Expected: no runtime/user membership or path into security_owner/cleanup_owner.
SELECT table_name,has_table_privilege('hours_v2_maintenance','app.'||table_name,'SELECT') AS worker_select,
 has_table_privilege('hours_v2_maintenance','app.'||table_name,'DELETE') AS worker_delete,
 has_table_privilege('hours_v2_writer','app.'||table_name,'UPDATE') AS writer_update,
 has_table_privilege('hours_v2_writer','app.'||table_name,'DELETE') AS writer_delete
 FROM information_schema.tables WHERE table_schema='app' AND table_name IN (
 'hours_import_staged_rows','hours_reconciliation_runs','hours_reconciliation_confirmations',
 'aircraft_hours_acceptances','flight_record_revisions') ORDER BY table_name;
-- Expected all false, including effective inherited/table/column privileges:
SELECT grantee,table_name,column_name,privilege_type FROM information_schema.column_privileges
 WHERE grantee IN ('hours_v2_writer','hours_v2_maintenance') AND privilege_type IN ('UPDATE','DELETE');
SELECT has_table_privilege('app_runtime','audit.audit_events','UPDATE') AS audit_update,
 has_table_privilege('app_runtime','audit.audit_events','DELETE') AS audit_delete,
 has_table_privilege('app_runtime','app.flight_record_revisions','UPDATE') AS revision_update,
 has_table_privilege('app_runtime','app.flight_record_revisions','DELETE') AS revision_delete;
-- Also inspect actual login (not only app_runtime), grant inheritance, owners, RLS FORCE and function ACLs.
SELECT n.nspname,p.proname,pg_get_userbyid(p.proowner) AS owner,p.prosecdef,p.proconfig,p.proacl
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='hours_v2_private' ORDER BY p.proname;
