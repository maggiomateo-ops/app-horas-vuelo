-- PREPARED ONLY. Requires separately approved disposable schema-only target, no real data.
-- Coordinator first reads/verifies branch identity, ledger hashes, DDL privileges and empty fixture state.
\set ON_ERROR_STOP on
BEGIN;
\ir schema.sql
\ir retention.sql
\ir security.sql
-- Verify catalogue/privileges in this transaction before intentional terminal exception.
DO $$ BEGIN RAISE EXCEPTION 'EXPECTED_HOURS_V2_FORCED_ROLLBACK' USING ERRCODE='P0001'; END $$;
-- ON_ERROR_STOP exits with aborted transaction; coordinator MUST close/ROLLBACK connection.
-- Never follow failure by COMMIT. A NEW connection independently checks the baseline restored.
