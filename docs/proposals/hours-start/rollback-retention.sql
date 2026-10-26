-- Only after rollback-security.sql on EMPTY DISPOSABLE branch. Never execute here.
ALTER TABLE app.aircraft DROP COLUMN hours_v2_generation;
ALTER TABLE app.flight_import_batches DROP CONSTRAINT ck_hours_v2_cleanup, DROP CONSTRAINT ck_hours_v2_retention;
ALTER TABLE app.flight_import_batches DROP COLUMN hours_v2_retention_policy, DROP COLUMN hours_v2_cleanup_error, DROP COLUMN hours_v2_cleanup_retry_at, DROP COLUMN hours_v2_cleanup_attempts, DROP COLUMN hours_v2_cleanup_lease_until, DROP COLUMN hours_v2_cleanup_token, DROP COLUMN hours_v2_raw_deleted_at, DROP COLUMN hours_v2_purged_at, DROP COLUMN hours_v2_cancelled_at, DROP COLUMN hours_v2_stage_expires_at, DROP COLUMN hours_v2_stage_state, DROP COLUMN hours_v2;
