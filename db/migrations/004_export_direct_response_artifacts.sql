-- 004_export_direct_response_artifacts.sql
-- D-257: completed export runs may be delivered directly over HTTP without storage.

ALTER TABLE app.export_runs
  DROP CONSTRAINT IF EXISTS ck_export_run_terminal_state,
  DROP CONSTRAINT IF EXISTS ck_export_artifact_delivery;

ALTER TABLE app.export_runs
  ADD CONSTRAINT ck_export_run_terminal_state CHECK (
    (
      status = 'PENDING'
      AND generated_at IS NULL
      AND failed_at IS NULL
      AND failure_code IS NULL
      AND artifact_filename IS NULL
      AND artifact_sha256 IS NULL
      AND artifact_size_bytes IS NULL
      AND artifact_storage_key IS NULL
      AND artifact_expires_at IS NULL
      AND artifact_removed_at IS NULL
    )
    OR
    (
      status = 'COMPLETED'
      AND generated_at IS NOT NULL
      AND failed_at IS NULL
      AND failure_code IS NULL
      AND artifact_filename IS NOT NULL
      AND artifact_sha256 IS NOT NULL
      AND artifact_size_bytes IS NOT NULL
    )
    OR
    (
      status = 'FAILED'
      AND failed_at IS NOT NULL
      AND failure_code IS NOT NULL
      AND generated_at IS NULL
      AND artifact_filename IS NULL
      AND artifact_sha256 IS NULL
      AND artifact_size_bytes IS NULL
      AND artifact_storage_key IS NULL
      AND artifact_expires_at IS NULL
      AND artifact_removed_at IS NULL
    )
  ),
  ADD CONSTRAINT ck_export_artifact_delivery CHECK (
    (artifact_size_bytes IS NULL OR artifact_size_bytes >= 0)
    AND (
      status <> 'COMPLETED'
      OR (
        artifact_storage_key IS NULL
        AND artifact_expires_at IS NULL
        AND artifact_removed_at IS NULL
      )
      OR (
        artifact_storage_key IS NOT NULL
        AND artifact_expires_at IS NOT NULL
        AND artifact_removed_at IS NULL
      )
      OR (
        artifact_storage_key IS NULL
        AND artifact_expires_at IS NOT NULL
        AND artifact_removed_at IS NOT NULL
      )
    )
  );
