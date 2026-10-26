-- PREPARED ONLY, NOT EXECUTED. Same independent synthetic manifest as session A.
\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL SERIALIZABLE;
SELECT set_config('hours_v2.actor_id',:'fixture_actor',true),
 set_config('hours_v2.aircraft_id',:'fixture_aircraft',true),
 set_config('hours_v2.canary_aircraft_id',:'fixture_aircraft',true),
 set_config('hours_v2.verified_preview_test','true',true);
-- Capture SERIALIZABLE snapshot before A advances the shared generation.
SELECT hours_v2_generation AS expected_generation FROM app.aircraft WHERE aircraft_id=:'fixture_aircraft'::uuid \gset
\prompt 'Run session A through COMMIT, then enter YES: ' fixture_ack
SELECT set_config('hours_v2.fixture_ack',:'fixture_ack',true);
DO $$ BEGIN IF current_setting('hours_v2.fixture_ack')<>'YES' THEN RAISE EXCEPTION 'Fixture coordination not acknowledged'; END IF; END $$;
SET LOCAL ROLE hours_v2_writer;
-- MUST raise 40001 on stale row/snapshot; no acceptance statement may execute afterwards.
SELECT hours_v2_private.begin_mutation(:'fixture_aircraft'::uuid,:'expected_generation'::bigint);
-- If reached, fail test; even a missed fence must NOT leave a successful transaction.
DO $$ BEGIN RAISE EXCEPTION 'FAIL: stale preview crossed fence'; END $$;
ROLLBACK;
-- Coordinator requires SQLSTATE=40001, closes/rolls back B and proves acceptance count unchanged.
-- Retry in a NEW transaction with old expected_generation must also fail (40001).
