-- PROPOSAL ONLY, NOT A MIGRATION; do not execute. Apply order in isolated preflight:
-- schema.sql -> retention.sql -> security.sql. Never registered in db/migrations.
-- Reuse the V1 batch as lifecycle/tombstone: still 20 new tables, no raw bytes in DB.
ALTER TABLE app.flight_import_batches
  ADD COLUMN hours_v2 boolean NOT NULL DEFAULT false,
  ADD COLUMN hours_v2_stage_state text,
  ADD COLUMN hours_v2_stage_expires_at timestamptz,
  ADD COLUMN hours_v2_cancelled_at timestamptz,
  ADD COLUMN hours_v2_purged_at timestamptz,
  ADD COLUMN hours_v2_raw_deleted_at timestamptz,
  ADD COLUMN hours_v2_cleanup_token uuid,
  ADD COLUMN hours_v2_cleanup_lease_until timestamptz,
  ADD COLUMN hours_v2_cleanup_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN hours_v2_cleanup_retry_at timestamptz,
  ADD COLUMN hours_v2_cleanup_error text,
  ADD COLUMN hours_v2_retention_policy text,
  ADD CONSTRAINT ck_hours_v2_retention CHECK (
    (NOT hours_v2 AND hours_v2_stage_state IS NULL AND hours_v2_retention_policy IS NULL)
    OR (hours_v2 AND hours_v2_stage_state IS NOT NULL
      AND hours_v2_stage_state IN ('OPEN','CANCELLED','EXPIRED','CONFIRMED','PURGED')
      AND hours_v2_stage_expires_at IS NOT NULL
      AND hours_v2_stage_expires_at = created_at + interval '168 hours'
      AND source_expires_at IS NOT NULL
      AND source_expires_at <= created_at + interval '24 hours'
      AND source_expires_at > created_at
      AND hours_v2_retention_policy IS NOT NULL
      AND hours_v2_retention_policy='hours-retention-v2.1'
      AND (hours_v2_stage_state<>'CANCELLED' OR hours_v2_cancelled_at IS NOT NULL)
      AND (hours_v2_stage_state<>'PURGED' OR hours_v2_purged_at IS NOT NULL)
      AND (hours_v2_stage_state<>'CONFIRMED' OR status='COMMITTED')
      AND (status<>'COMMITTED' OR hours_v2_stage_state='CONFIRMED'))
  ),
  ADD CONSTRAINT ck_hours_v2_cleanup CHECK (
    hours_v2_cleanup_attempts >= 0
    AND (hours_v2_cleanup_token IS NULL)=(hours_v2_cleanup_lease_until IS NULL)
    AND (hours_v2_cleanup_error IS NULL OR hours_v2_cleanup_error IN ('PROVIDER_ERROR','VERIFY_FAILED','LEASE_EXPIRED'))
    AND (hours_v2_raw_deleted_at IS NULL OR source_storage_key IS NULL)
  );
-- NO default TTL for V1, no writes/backfill or reinterpretation of V1 status.
-- Shared monotonic fence; every participating mutation bumps it before reading hours inputs.
ALTER TABLE app.aircraft ADD COLUMN hours_v2_generation bigint NOT NULL DEFAULT 0
  CHECK(hours_v2_generation >= 0);
