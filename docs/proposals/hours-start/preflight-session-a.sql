-- PREPARED ONLY; never run here. Synthetic disposable branch with COMMITTED fixture setup only.
-- Variables fixture_aircraft, fixture_actor and test flight belong to independent synthetic manifest.
-- Coordinator verifies endpoint/branch/ledger/roles first. NOT parent TEST / Production.
\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL SERIALIZABLE;
SELECT set_config('hours_v2.actor_id',:'fixture_actor',true),
 set_config('hours_v2.aircraft_id',:'fixture_aircraft',true),
 set_config('hours_v2.canary_aircraft_id',:'fixture_aircraft',true),
 set_config('hours_v2.verified_preview_test','true',true);
SET LOCAL ROLE hours_v2_writer;
-- Start only AFTER B has captured generation and paused at its prompt.
SELECT hours_v2_private.begin_mutation(:'fixture_aircraft'::uuid,NULL) AS new_generation;
-- Baseline test demonstrates the shared version fence; this mutation advances generation only.
-- Follow matrix with synthetic create/edit/VOID/installation/adjustment writers before acceptance.
\prompt 'B captured its old generation? Enter YES to commit synthetic fence: ' fixture_ack
SELECT set_config('hours_v2.fixture_ack',:'fixture_ack',true);
DO $$ BEGIN IF current_setting('hours_v2.fixture_ack')<>'YES' THEN RAISE EXCEPTION 'Fixture coordination not acknowledged'; END IF; END $$;
COMMIT;
-- Commit exists ONLY in isolated fixture phase; force-rollback DDL test is a separate phase.
