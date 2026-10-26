-- PROPOSAL ONLY. NOT A MIGRATION. DO NOT EXECUTE here.
-- Isolated preflight only: schema.sql, retention.sql, security.sql, synthetic fixtures.
-- NO membership granted to app_runtime/app_horas_runtime; no LOGIN, passwords or credentials.
CREATE ROLE hours_v2_reader NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE ROLE hours_v2_writer NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE ROLE hours_v2_maintenance NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE ROLE hours_v2_cleanup_owner NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE ROLE hours_v2_security_owner NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE ROLE hours_v2_invalidator NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE SCHEMA hours_v2_private;
REVOKE ALL ON SCHEMA hours_v2_private FROM PUBLIC;
GRANT CREATE ON SCHEMA hours_v2_private TO hours_v2_security_owner,hours_v2_cleanup_owner;
GRANT USAGE ON SCHEMA app, hours_v2_private TO hours_v2_reader, hours_v2_writer,
  hours_v2_maintenance, hours_v2_cleanup_owner, hours_v2_security_owner, hours_v2_invalidator;
GRANT USAGE ON SCHEMA audit TO hours_v2_cleanup_owner;
GRANT SELECT ON app.aircraft_memberships, app.users, app.aircraft TO hours_v2_security_owner;
GRANT UPDATE(hours_v2_generation) ON app.aircraft TO hours_v2_security_owner;
-- Lock-only privileges inside fixed definer body; no raw execution path or role membership.
GRANT UPDATE(user_id) ON app.users TO hours_v2_security_owner;
GRANT UPDATE(membership_id) ON app.aircraft_memberships TO hours_v2_security_owner;
GRANT SELECT ON app.aircraft TO hours_v2_cleanup_owner;
-- Row locks require UPDATE privilege. Cleanup owner has no function that changes this UUID.
GRANT UPDATE(aircraft_id) ON app.aircraft TO hours_v2_cleanup_owner;
GRANT SELECT ON app.flight_import_batches TO hours_v2_cleanup_owner;
GRANT UPDATE(hours_v2_stage_state, hours_v2_purged_at) ON app.flight_import_batches TO hours_v2_cleanup_owner;
GRANT INSERT ON audit.audit_events TO hours_v2_cleanup_owner;

-- Context is bound ONLY after canonical session verification by trusted backend.
-- Custom GUCs are NOT cryptographic identity and NOT authority for SQL clients.
-- These NOLOGIN roles are not exposed to browsers or granted to current runtime.
CREATE FUNCTION hours_v2_private.owner_active(p_aircraft uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT p_aircraft = nullif(current_setting('hours_v2.aircraft_id',true),'')::uuid
    AND EXISTS(SELECT 1 FROM app.aircraft_memberships m
      JOIN app.users u ON u.user_id=m.user_id
      JOIN app.aircraft a ON a.aircraft_id=m.aircraft_id
      WHERE m.aircraft_id=p_aircraft
        AND m.user_id=nullif(current_setting('hours_v2.actor_id',true),'')::uuid
        AND m.role='OWNER' AND m.status='ACTIVE' AND u.status='ACTIVE' AND a.status='ACTIVE');
$$;
ALTER FUNCTION hours_v2_private.owner_active(uuid) OWNER TO hours_v2_security_owner;
REVOKE ALL ON FUNCTION hours_v2_private.owner_active(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hours_v2_private.owner_active(uuid) TO hours_v2_reader, hours_v2_writer;

CREATE FUNCTION hours_v2_private.begin_mutation(p_aircraft uuid, p_expected_generation bigint DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v bigint;
BEGIN
  IF current_setting('transaction_isolation') <> 'serializable'
    OR current_setting('hours_v2.verified_preview_test',true) IS DISTINCT FROM 'true'
    OR p_aircraft IS DISTINCT FROM nullif(current_setting('hours_v2.canary_aircraft_id',true),'')::uuid
    OR NOT coalesce(hours_v2_private.owner_active(p_aircraft),false) THEN
    RAISE EXCEPTION 'Hours V2 mutation denied' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM app.users WHERE user_id=nullif(current_setting('hours_v2.actor_id',true),'')::uuid FOR SHARE;
  UPDATE app.aircraft SET hours_v2_generation=hours_v2_generation+1
   WHERE aircraft_id=p_aircraft AND (p_expected_generation IS NULL OR hours_v2_generation=p_expected_generation)
   RETURNING hours_v2_generation INTO v;
  IF NOT FOUND THEN RAISE EXCEPTION 'Stale hours preview' USING ERRCODE='40001'; END IF;
  PERFORM 1 FROM app.aircraft_memberships WHERE aircraft_id=p_aircraft
    AND user_id=nullif(current_setting('hours_v2.actor_id',true),'')::uuid FOR SHARE;
  PERFORM set_config('hours_v2.fenced_generation',v::text,true);
  RETURN v;
END $$;
ALTER FUNCTION hours_v2_private.begin_mutation(uuid,bigint) OWNER TO hours_v2_security_owner;
REVOKE ALL ON FUNCTION hours_v2_private.begin_mutation(uuid,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hours_v2_private.begin_mutation(uuid,bigint) TO hours_v2_writer;
-- Updates the shared row (not just FOR UPDATE), forcing stale SERIALIZABLE waiters to retry.
-- Membership/user revocation must participate in the same ordered aircraft protocol.

CREATE FUNCTION hours_v2_private.write_scope(p_aircraft uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
 SELECT coalesce(hours_v2_private.owner_active(p_aircraft),false)
   AND current_setting('transaction_isolation')='serializable'
   AND current_setting('hours_v2.verified_preview_test',true)='true'
   AND p_aircraft=nullif(current_setting('hours_v2.canary_aircraft_id',true),'')::uuid
   AND EXISTS(SELECT 1 FROM app.aircraft WHERE aircraft_id=p_aircraft
     AND hours_v2_generation=nullif(current_setting('hours_v2.fenced_generation',true),'')::bigint);
$$;
ALTER FUNCTION hours_v2_private.write_scope(uuid) OWNER TO hours_v2_security_owner;
REVOKE ALL ON FUNCTION hours_v2_private.write_scope(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hours_v2_private.write_scope(uuid) TO hours_v2_writer;

GRANT SELECT, INSERT ON app.flight_import_batches TO hours_v2_security_owner;
GRANT UPDATE(hours_v2_stage_state,hours_v2_cancelled_at) ON app.flight_import_batches TO hours_v2_security_owner;
CREATE FUNCTION hours_v2_private.batch_open(p_aircraft uuid,p_batch uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
 SELECT coalesce(hours_v2_private.owner_active(p_aircraft),false) AND EXISTS(
 SELECT 1 FROM app.flight_import_batches b WHERE b.aircraft_id=p_aircraft AND b.import_batch_id=p_batch
   AND b.hours_v2 AND b.hours_v2_stage_state='OPEN' AND b.hours_v2_stage_expires_at>statement_timestamp());
$$;
ALTER FUNCTION hours_v2_private.batch_open(uuid,uuid) OWNER TO hours_v2_security_owner;
REVOKE ALL ON FUNCTION hours_v2_private.batch_open(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hours_v2_private.batch_open(uuid,uuid) TO hours_v2_writer;

CREATE FUNCTION hours_v2_private.open_batch(p_aircraft uuid,p_sha256 text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE id uuid := gen_random_uuid(); t timestamptz := clock_timestamp();
BEGIN
 IF NOT coalesce(hours_v2_private.write_scope(p_aircraft),false) OR p_sha256 !~ '^[a-f0-9]{64}$' OR p_sha256 IS NULL THEN
   RAISE EXCEPTION 'Batch creation denied' USING ERRCODE='42501';
 END IF;
 INSERT INTO app.flight_import_batches(import_batch_id,aircraft_id,initiated_by_user_id,template_version,
   source_filename,source_file_sha256,status,source_storage_key,source_expires_at,created_at,
   hours_v2,hours_v2_stage_state,hours_v2_stage_expires_at,hours_v2_retention_policy)
 VALUES(id,p_aircraft,nullif(current_setting('hours_v2.actor_id',true),'')::uuid,'hours-v2.1','source.xlsx',p_sha256,'UPLOADED',
   'test/'||p_aircraft||'/'||id||'/'||gen_random_uuid(),t+interval '24 hours',t,true,'OPEN',t+interval '168 hours','hours-retention-v2.1');
 RETURN id;
END $$;
ALTER FUNCTION hours_v2_private.open_batch(uuid,text) OWNER TO hours_v2_security_owner;
REVOKE ALL ON FUNCTION hours_v2_private.open_batch(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hours_v2_private.open_batch(uuid,text) TO hours_v2_writer;

CREATE FUNCTION hours_v2_private.cancel_batch(p_aircraft uuid,p_batch uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE b app.flight_import_batches%ROWTYPE;
BEGIN
 IF NOT coalesce(hours_v2_private.write_scope(p_aircraft),false) THEN RAISE EXCEPTION 'Cancel denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO b FROM app.flight_import_batches WHERE aircraft_id=p_aircraft AND import_batch_id=p_batch FOR UPDATE;
 IF NOT FOUND OR NOT b.hours_v2 OR b.hours_v2_stage_state='CONFIRMED' THEN RAISE EXCEPTION 'Cancel denied' USING ERRCODE='42501'; END IF;
 IF b.hours_v2_stage_state IN ('CANCELLED','EXPIRED','PURGED') THEN RETURN false; END IF;
 UPDATE app.flight_import_batches SET hours_v2_stage_state='CANCELLED',hours_v2_cancelled_at=clock_timestamp() WHERE import_batch_id=p_batch;
 RETURN true;
END $$;
ALTER FUNCTION hours_v2_private.cancel_batch(uuid,uuid) OWNER TO hours_v2_security_owner;
REVOKE ALL ON FUNCTION hours_v2_private.cancel_batch(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hours_v2_private.cancel_batch(uuid,uuid) TO hours_v2_writer;

-- OWNER sees live temporary candidates or accepted minimal evidence, never expired staging.
GRANT SELECT ON app.hours_import_mapping_versions,app.hours_reconciliation_runs TO hours_v2_security_owner;
CREATE POLICY hours_lookup_mapping ON app.hours_import_mapping_versions FOR SELECT TO hours_v2_security_owner USING(true);
CREATE POLICY hours_lookup_run ON app.hours_reconciliation_runs FOR SELECT TO hours_v2_security_owner USING(true);
CREATE FUNCTION hours_v2_private.fact_visible(p_aircraft uuid,p_batch uuid,p_run uuid,p_mapping uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b uuid := p_batch;
BEGIN
 IF NOT coalesce(hours_v2_private.owner_active(p_aircraft),false) THEN RETURN false; END IF;
 IF b IS NULL AND p_run IS NOT NULL THEN
  SELECT import_batch_id INTO b FROM app.hours_reconciliation_runs WHERE aircraft_id=p_aircraft AND reconciliation_run_id=p_run;
 END IF;
 IF b IS NULL AND p_mapping IS NOT NULL THEN
  SELECT import_batch_id INTO b FROM app.hours_import_mapping_versions WHERE aircraft_id=p_aircraft AND mapping_version_id=p_mapping;
 END IF;
 IF b IS NULL THEN RETURN true; END IF;
 RETURN EXISTS(SELECT 1 FROM app.flight_import_batches WHERE aircraft_id=p_aircraft AND import_batch_id=b AND hours_v2
  AND (hours_v2_stage_state='CONFIRMED' OR (hours_v2_stage_state='OPEN' AND hours_v2_stage_expires_at>clock_timestamp())));
END $$;
ALTER FUNCTION hours_v2_private.fact_visible(uuid,uuid,uuid,uuid) OWNER TO hours_v2_security_owner;
REVOKE ALL ON FUNCTION hours_v2_private.fact_visible(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hours_v2_private.fact_visible(uuid,uuid,uuid,uuid) TO hours_v2_reader,hours_v2_writer;

CREATE FUNCTION hours_v2_private.guard_history() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE batch_id uuid; run_id uuid; accepted boolean; j jsonb;
BEGIN
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Immutable hours evidence' USING ERRCODE='42501'; END IF;
  j := CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  run_id := (j->>'reconciliation_run_id')::uuid;
  IF TG_OP='DELETE' THEN
    IF current_user <> 'hours_v2_cleanup_owner' THEN
      RAISE EXCEPTION 'Cleanup function required' USING ERRCODE='42501';
    END IF;
    IF run_id IS NOT NULL THEN
      SELECT r.import_batch_id INTO batch_id FROM app.hours_reconciliation_runs r WHERE r.reconciliation_run_id=run_id;
    ELSIF TG_TABLE_NAME='hours_import_mapping_versions' THEN batch_id := (j->>'import_batch_id')::uuid;
    ELSIF TG_TABLE_NAME='hours_import_staged_rows' THEN batch_id := (j->>'import_batch_id')::uuid;
    ELSIF TG_TABLE_NAME='hours_import_mapping_fields' THEN
      SELECT m.import_batch_id INTO batch_id FROM app.hours_import_mapping_versions m WHERE m.mapping_version_id=(j->>'mapping_version_id')::uuid;
    END IF;
    SELECT EXISTS(SELECT 1 FROM app.hours_reconciliation_runs r
      JOIN app.hours_reconciliation_confirmations c USING(aircraft_id,reconciliation_run_id)
      WHERE r.import_batch_id=batch_id) INTO accepted;
    IF batch_id IS NULL OR accepted OR NOT EXISTS(SELECT 1 FROM app.flight_import_batches b
      WHERE b.import_batch_id=batch_id AND b.hours_v2 AND b.status<>'COMMITTED'
        AND (b.hours_v2_stage_state IN ('CANCELLED','EXPIRED','PURGED') OR b.hours_v2_stage_expires_at<=clock_timestamp())) THEN
      RAISE EXCEPTION 'Accepted or live evidence cannot be purged' USING ERRCODE='42501';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_TABLE_NAME IN ('hours_import_mapping_versions','hours_import_staged_rows','hours_import_mapping_fields') THEN
    batch_id := (j->>'import_batch_id')::uuid;
    IF batch_id IS NULL THEN
      SELECT m.import_batch_id INTO batch_id FROM app.hours_import_mapping_versions m WHERE m.mapping_version_id=(j->>'mapping_version_id')::uuid;
    END IF;
    IF NOT hours_v2_private.batch_open((j->>'aircraft_id')::uuid,batch_id) THEN
      RAISE EXCEPTION 'Closed staging cannot gain new source facts' USING ERRCODE='42501';
    END IF;
  END IF;
  IF current_user='hours_v2_writer' AND EXISTS(
    SELECT 1 FROM jsonb_each_text(j) x WHERE x.key IN ('created_by_user_id','recorded_by_user_id','confirmed_by_user_id')
      AND x.value IS DISTINCT FROM nullif(current_setting('hours_v2.actor_id',true),'')) THEN
    RAISE EXCEPTION 'Actor must match verified context' USING ERRCODE='42501';
  END IF;
  IF TG_TABLE_NAME='hours_reconciliation_runs' AND
    (j->>'input_generation')::bigint IS DISTINCT FROM nullif(current_setting('hours_v2.fenced_generation',true),'')::bigint THEN
    RAISE EXCEPTION 'Validation must freeze current fenced generation' USING ERRCODE='40001';
  END IF;
  IF TG_TABLE_NAME='hours_reconciliation_confirmations' AND NOT EXISTS(
    SELECT 1 FROM app.hours_reconciliation_runs r WHERE r.reconciliation_run_id=run_id
      AND r.aircraft_id=(j->>'aircraft_id')::uuid
      AND r.input_generation=nullif(current_setting('hours_v2.fenced_generation',true),'')::bigint-1) THEN
    RAISE EXCEPTION 'Stale validation cannot be confirmed' USING ERRCODE='40001';
  END IF;
  -- Accepted snapshots cannot acquire extra child facts after confirmation.
  IF run_id IS NOT NULL AND TG_TABLE_NAME NOT IN ('hours_reconciliation_confirmations','aircraft_hours_acceptances','hours_acceptance_invalidations','hours_import_committed_rows')
    AND EXISTS(SELECT 1 FROM app.hours_reconciliation_confirmations c WHERE c.reconciliation_run_id=run_id) THEN
    RAISE EXCEPTION 'Confirmed snapshot is sealed' USING ERRCODE='42501';
  END IF;
  IF TG_TABLE_NAME='hours_import_committed_rows' AND EXISTS(SELECT 1 FROM app.aircraft_hours_acceptances a WHERE a.reconciliation_run_id=run_id) THEN
    RAISE EXCEPTION 'Accepted lineage is sealed' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION hours_v2_private.guard_history() FROM PUBLIC;

REVOKE ALL ON app.aircraft_hours_plans FROM PUBLIC, app_runtime;
ALTER TABLE app.aircraft_hours_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.aircraft_hours_plans FORCE ROW LEVEL SECURITY;
GRANT SELECT ON app.aircraft_hours_plans TO hours_v2_reader, hours_v2_writer;
CREATE POLICY hours_owner_read ON app.aircraft_hours_plans FOR SELECT TO hours_v2_reader, hours_v2_writer
 USING(hours_v2_private.owner_active(aircraft_id));
CREATE TRIGGER hours_history_guard BEFORE INSERT OR UPDATE OR DELETE ON app.aircraft_hours_plans
 FOR EACH ROW EXECUTE FUNCTION hours_v2_private.guard_history();
GRANT INSERT ON app.aircraft_hours_plans TO hours_v2_writer;
CREATE POLICY hours_owner_insert ON app.aircraft_hours_plans FOR INSERT TO hours_v2_writer
 WITH CHECK(hours_v2_private.write_scope(aircraft_id));
GRANT SELECT ON app.aircraft_hours_plans TO hours_v2_cleanup_owner;
CREATE POLICY hours_cleanup_read ON app.aircraft_hours_plans FOR SELECT TO hours_v2_cleanup_owner USING(true);

REVOKE ALL ON app.aircraft_hours_plan_revisions FROM PUBLIC, app_runtime;
ALTER TABLE app.aircraft_hours_plan_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.aircraft_hours_plan_revisions FORCE ROW LEVEL SECURITY;
GRANT SELECT ON app.aircraft_hours_plan_revisions TO hours_v2_reader, hours_v2_writer;
CREATE POLICY hours_owner_read ON app.aircraft_hours_plan_revisions FOR SELECT TO hours_v2_reader, hours_v2_writer
 USING(hours_v2_private.owner_active(aircraft_id));
CREATE TRIGGER hours_history_guard BEFORE INSERT OR UPDATE OR DELETE ON app.aircraft_hours_plan_revisions
 FOR EACH ROW EXECUTE FUNCTION hours_v2_private.guard_history();
GRANT INSERT ON app.aircraft_hours_plan_revisions TO hours_v2_writer;
CREATE POLICY hours_owner_insert ON app.aircraft_hours_plan_revisions FOR INSERT TO hours_v2_writer
 WITH CHECK(hours_v2_private.write_scope(aircraft_id));
GRANT SELECT ON app.aircraft_hours_plan_revisions TO hours_v2_cleanup_owner;
CREATE POLICY hours_cleanup_read ON app.aircraft_hours_plan_revisions FOR SELECT TO hours_v2_cleanup_owner USING(true);

REVOKE ALL ON app.hours_component_overhaul_episodes FROM PUBLIC, app_runtime;
ALTER TABLE app.hours_component_overhaul_episodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.hours_component_overhaul_episodes FORCE ROW LEVEL SECURITY;
GRANT SELECT ON app.hours_component_overhaul_episodes TO hours_v2_reader, hours_v2_writer;
CREATE POLICY hours_owner_read ON app.hours_component_overhaul_episodes FOR SELECT TO hours_v2_reader, hours_v2_writer
 USING(hours_v2_private.owner_active(aircraft_id));
CREATE TRIGGER hours_history_guard BEFORE INSERT OR UPDATE OR DELETE ON app.hours_component_overhaul_episodes
 FOR EACH ROW EXECUTE FUNCTION hours_v2_private.guard_history();
GRANT INSERT ON app.hours_component_overhaul_episodes TO hours_v2_writer;
CREATE POLICY hours_owner_insert ON app.hours_component_overhaul_episodes FOR INSERT TO hours_v2_writer
 WITH CHECK(hours_v2_private.write_scope(aircraft_id));
GRANT SELECT ON app.hours_component_overhaul_episodes TO hours_v2_cleanup_owner;
CREATE POLICY hours_cleanup_read ON app.hours_component_overhaul_episodes FOR SELECT TO hours_v2_cleanup_owner USING(true);

REVOKE ALL ON app.hours_import_mapping_versions FROM PUBLIC, app_runtime;
ALTER TABLE app.hours_import_mapping_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.hours_import_mapping_versions FORCE ROW LEVEL SECURITY;
GRANT SELECT ON app.hours_import_mapping_versions TO hours_v2_reader, hours_v2_writer;
CREATE POLICY hours_owner_read ON app.hours_import_mapping_versions FOR SELECT TO hours_v2_reader, hours_v2_writer
 USING(hours_v2_private.fact_visible(aircraft_id,import_batch_id,NULL::uuid,mapping_version_id));
CREATE TRIGGER hours_history_guard BEFORE INSERT OR UPDATE OR DELETE ON app.hours_import_mapping_versions
 FOR EACH ROW EXECUTE FUNCTION hours_v2_private.guard_history();
GRANT INSERT ON app.hours_import_mapping_versions TO hours_v2_writer;
CREATE POLICY hours_owner_insert ON app.hours_import_mapping_versions FOR INSERT TO hours_v2_writer
 WITH CHECK(hours_v2_private.write_scope(aircraft_id) AND hours_v2_private.fact_visible(aircraft_id,import_batch_id,NULL::uuid,mapping_version_id));
GRANT SELECT ON app.hours_import_mapping_versions TO hours_v2_cleanup_owner;
CREATE POLICY hours_cleanup_read ON app.hours_import_mapping_versions FOR SELECT TO hours_v2_cleanup_owner USING(true);
GRANT DELETE ON app.hours_import_mapping_versions TO hours_v2_cleanup_owner;
CREATE POLICY hours_cleanup_delete ON app.hours_import_mapping_versions FOR DELETE TO hours_v2_cleanup_owner USING(true);

REVOKE ALL ON app.hours_import_mapping_fields FROM PUBLIC, app_runtime;
ALTER TABLE app.hours_import_mapping_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.hours_import_mapping_fields FORCE ROW LEVEL SECURITY;
GRANT SELECT ON app.hours_import_mapping_fields TO hours_v2_reader, hours_v2_writer;
CREATE POLICY hours_owner_read ON app.hours_import_mapping_fields FOR SELECT TO hours_v2_reader, hours_v2_writer
 USING(hours_v2_private.fact_visible(aircraft_id,NULL::uuid,NULL::uuid,mapping_version_id));
CREATE TRIGGER hours_history_guard BEFORE INSERT OR UPDATE OR DELETE ON app.hours_import_mapping_fields
 FOR EACH ROW EXECUTE FUNCTION hours_v2_private.guard_history();
GRANT INSERT ON app.hours_import_mapping_fields TO hours_v2_writer;
CREATE POLICY hours_owner_insert ON app.hours_import_mapping_fields FOR INSERT TO hours_v2_writer
 WITH CHECK(hours_v2_private.write_scope(aircraft_id) AND hours_v2_private.fact_visible(aircraft_id,NULL::uuid,NULL::uuid,mapping_version_id));
GRANT SELECT ON app.hours_import_mapping_fields TO hours_v2_cleanup_owner;
CREATE POLICY hours_cleanup_read ON app.hours_import_mapping_fields FOR SELECT TO hours_v2_cleanup_owner USING(true);
GRANT DELETE ON app.hours_import_mapping_fields TO hours_v2_cleanup_owner;
CREATE POLICY hours_cleanup_delete ON app.hours_import_mapping_fields FOR DELETE TO hours_v2_cleanup_owner USING(true);

REVOKE ALL ON app.hours_import_staged_rows FROM PUBLIC, app_runtime;
ALTER TABLE app.hours_import_staged_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.hours_import_staged_rows FORCE ROW LEVEL SECURITY;
GRANT SELECT ON app.hours_import_staged_rows TO hours_v2_reader, hours_v2_writer;
CREATE POLICY hours_owner_read ON app.hours_import_staged_rows FOR SELECT TO hours_v2_reader, hours_v2_writer
 USING(hours_v2_private.fact_visible(aircraft_id,import_batch_id,NULL::uuid,mapping_version_id));
CREATE TRIGGER hours_history_guard BEFORE INSERT OR UPDATE OR DELETE ON app.hours_import_staged_rows
 FOR EACH ROW EXECUTE FUNCTION hours_v2_private.guard_history();
GRANT INSERT ON app.hours_import_staged_rows TO hours_v2_writer;
CREATE POLICY hours_owner_insert ON app.hours_import_staged_rows FOR INSERT TO hours_v2_writer
 WITH CHECK(hours_v2_private.write_scope(aircraft_id) AND hours_v2_private.fact_visible(aircraft_id,import_batch_id,NULL::uuid,mapping_version_id));
GRANT SELECT ON app.hours_import_staged_rows TO hours_v2_cleanup_owner;
CREATE POLICY hours_cleanup_read ON app.hours_import_staged_rows FOR SELECT TO hours_v2_cleanup_owner USING(true);
GRANT DELETE ON app.hours_import_staged_rows TO hours_v2_cleanup_owner;
CREATE POLICY hours_cleanup_delete ON app.hours_import_staged_rows FOR DELETE TO hours_v2_cleanup_owner USING(true);

REVOKE ALL ON app.hours_counter_references FROM PUBLIC, app_runtime;
ALTER TABLE app.hours_counter_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.hours_counter_references FORCE ROW LEVEL SECURITY;
GRANT SELECT ON app.hours_counter_references TO hours_v2_reader, hours_v2_writer;
CREATE POLICY hours_owner_read ON app.hours_counter_references FOR SELECT TO hours_v2_reader, hours_v2_writer
 USING(hours_v2_private.owner_active(aircraft_id));
CREATE TRIGGER hours_history_guard BEFORE INSERT OR UPDATE OR DELETE ON app.hours_counter_references
 FOR EACH ROW EXECUTE FUNCTION hours_v2_private.guard_history();
GRANT INSERT ON app.hours_counter_references TO hours_v2_writer;
CREATE POLICY hours_owner_insert ON app.hours_counter_references FOR INSERT TO hours_v2_writer
 WITH CHECK(hours_v2_private.write_scope(aircraft_id));
GRANT SELECT ON app.hours_counter_references TO hours_v2_cleanup_owner;
CREATE POLICY hours_cleanup_read ON app.hours_counter_references FOR SELECT TO hours_v2_cleanup_owner USING(true);

REVOKE ALL ON app.hours_reconciliation_runs FROM PUBLIC, app_runtime;
ALTER TABLE app.hours_reconciliation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.hours_reconciliation_runs FORCE ROW LEVEL SECURITY;
GRANT SELECT ON app.hours_reconciliation_runs TO hours_v2_reader, hours_v2_writer;
CREATE POLICY hours_owner_read ON app.hours_reconciliation_runs FOR SELECT TO hours_v2_reader, hours_v2_writer
 USING(hours_v2_private.fact_visible(aircraft_id,import_batch_id,reconciliation_run_id,NULL::uuid));
CREATE TRIGGER hours_history_guard BEFORE INSERT OR UPDATE OR DELETE ON app.hours_reconciliation_runs
 FOR EACH ROW EXECUTE FUNCTION hours_v2_private.guard_history();
GRANT INSERT ON app.hours_reconciliation_runs TO hours_v2_writer;
CREATE POLICY hours_owner_insert ON app.hours_reconciliation_runs FOR INSERT TO hours_v2_writer
 WITH CHECK(hours_v2_private.write_scope(aircraft_id) AND hours_v2_private.fact_visible(aircraft_id,import_batch_id,reconciliation_run_id,NULL::uuid));
GRANT SELECT ON app.hours_reconciliation_runs TO hours_v2_cleanup_owner;
CREATE POLICY hours_cleanup_read ON app.hours_reconciliation_runs FOR SELECT TO hours_v2_cleanup_owner USING(true);
GRANT DELETE ON app.hours_reconciliation_runs TO hours_v2_cleanup_owner;
CREATE POLICY hours_cleanup_delete ON app.hours_reconciliation_runs FOR DELETE TO hours_v2_cleanup_owner USING(true);

REVOKE ALL ON app.hours_reconciliation_flights FROM PUBLIC, app_runtime;
ALTER TABLE app.hours_reconciliation_flights ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.hours_reconciliation_flights FORCE ROW LEVEL SECURITY;
GRANT SELECT ON app.hours_reconciliation_flights TO hours_v2_reader, hours_v2_writer;
CREATE POLICY hours_owner_read ON app.hours_reconciliation_flights FOR SELECT TO hours_v2_reader, hours_v2_writer
 USING(hours_v2_private.fact_visible(aircraft_id,NULL::uuid,reconciliation_run_id,NULL::uuid));
CREATE TRIGGER hours_history_guard BEFORE INSERT OR UPDATE OR DELETE ON app.hours_reconciliation_flights
 FOR EACH ROW EXECUTE FUNCTION hours_v2_private.guard_history();
GRANT INSERT ON app.hours_reconciliation_flights TO hours_v2_writer;
CREATE POLICY hours_owner_insert ON app.hours_reconciliation_flights FOR INSERT TO hours_v2_writer
 WITH CHECK(hours_v2_private.write_scope(aircraft_id) AND hours_v2_private.fact_visible(aircraft_id,NULL::uuid,reconciliation_run_id,NULL::uuid));
GRANT SELECT ON app.hours_reconciliation_flights TO hours_v2_cleanup_owner;
CREATE POLICY hours_cleanup_read ON app.hours_reconciliation_flights FOR SELECT TO hours_v2_cleanup_owner USING(true);
GRANT DELETE ON app.hours_reconciliation_flights TO hours_v2_cleanup_owner;
CREATE POLICY hours_cleanup_delete ON app.hours_reconciliation_flights FOR DELETE TO hours_v2_cleanup_owner USING(true);

REVOKE ALL ON app.hours_reconciliation_installations FROM PUBLIC, app_runtime;
ALTER TABLE app.hours_reconciliation_installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.hours_reconciliation_installations FORCE ROW LEVEL SECURITY;
GRANT SELECT ON app.hours_reconciliation_installations TO hours_v2_reader, hours_v2_writer;
CREATE POLICY hours_owner_read ON app.hours_reconciliation_installations FOR SELECT TO hours_v2_reader, hours_v2_writer
 USING(hours_v2_private.fact_visible(aircraft_id,NULL::uuid,reconciliation_run_id,NULL::uuid));
CREATE TRIGGER hours_history_guard BEFORE INSERT OR UPDATE OR DELETE ON app.hours_reconciliation_installations
 FOR EACH ROW EXECUTE FUNCTION hours_v2_private.guard_history();
GRANT INSERT ON app.hours_reconciliation_installations TO hours_v2_writer;
CREATE POLICY hours_owner_insert ON app.hours_reconciliation_installations FOR INSERT TO hours_v2_writer
 WITH CHECK(hours_v2_private.write_scope(aircraft_id) AND hours_v2_private.fact_visible(aircraft_id,NULL::uuid,reconciliation_run_id,NULL::uuid));
GRANT SELECT ON app.hours_reconciliation_installations TO hours_v2_cleanup_owner;
CREATE POLICY hours_cleanup_read ON app.hours_reconciliation_installations FOR SELECT TO hours_v2_cleanup_owner USING(true);
GRANT DELETE ON app.hours_reconciliation_installations TO hours_v2_cleanup_owner;
CREATE POLICY hours_cleanup_delete ON app.hours_reconciliation_installations FOR DELETE TO hours_v2_cleanup_owner USING(true);

REVOKE ALL ON app.hours_reconciliation_staged_rows FROM PUBLIC, app_runtime;
ALTER TABLE app.hours_reconciliation_staged_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.hours_reconciliation_staged_rows FORCE ROW LEVEL SECURITY;
GRANT SELECT ON app.hours_reconciliation_staged_rows TO hours_v2_reader, hours_v2_writer;
CREATE POLICY hours_owner_read ON app.hours_reconciliation_staged_rows FOR SELECT TO hours_v2_reader, hours_v2_writer
 USING(hours_v2_private.fact_visible(aircraft_id,import_batch_id,reconciliation_run_id,NULL::uuid));
CREATE TRIGGER hours_history_guard BEFORE INSERT OR UPDATE OR DELETE ON app.hours_reconciliation_staged_rows
 FOR EACH ROW EXECUTE FUNCTION hours_v2_private.guard_history();
GRANT INSERT ON app.hours_reconciliation_staged_rows TO hours_v2_writer;
CREATE POLICY hours_owner_insert ON app.hours_reconciliation_staged_rows FOR INSERT TO hours_v2_writer
 WITH CHECK(hours_v2_private.write_scope(aircraft_id) AND hours_v2_private.fact_visible(aircraft_id,import_batch_id,reconciliation_run_id,NULL::uuid));
GRANT SELECT ON app.hours_reconciliation_staged_rows TO hours_v2_cleanup_owner;
CREATE POLICY hours_cleanup_read ON app.hours_reconciliation_staged_rows FOR SELECT TO hours_v2_cleanup_owner USING(true);
GRANT DELETE ON app.hours_reconciliation_staged_rows TO hours_v2_cleanup_owner;
CREATE POLICY hours_cleanup_delete ON app.hours_reconciliation_staged_rows FOR DELETE TO hours_v2_cleanup_owner USING(true);

REVOKE ALL ON app.hours_reconciliation_references FROM PUBLIC, app_runtime;
ALTER TABLE app.hours_reconciliation_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.hours_reconciliation_references FORCE ROW LEVEL SECURITY;
GRANT SELECT ON app.hours_reconciliation_references TO hours_v2_reader, hours_v2_writer;
CREATE POLICY hours_owner_read ON app.hours_reconciliation_references FOR SELECT TO hours_v2_reader, hours_v2_writer
 USING(hours_v2_private.fact_visible(aircraft_id,NULL::uuid,reconciliation_run_id,NULL::uuid));
CREATE TRIGGER hours_history_guard BEFORE INSERT OR UPDATE OR DELETE ON app.hours_reconciliation_references
 FOR EACH ROW EXECUTE FUNCTION hours_v2_private.guard_history();
GRANT INSERT ON app.hours_reconciliation_references TO hours_v2_writer;
CREATE POLICY hours_owner_insert ON app.hours_reconciliation_references FOR INSERT TO hours_v2_writer
 WITH CHECK(hours_v2_private.write_scope(aircraft_id) AND hours_v2_private.fact_visible(aircraft_id,NULL::uuid,reconciliation_run_id,NULL::uuid));
GRANT SELECT ON app.hours_reconciliation_references TO hours_v2_cleanup_owner;
CREATE POLICY hours_cleanup_read ON app.hours_reconciliation_references FOR SELECT TO hours_v2_cleanup_owner USING(true);
GRANT DELETE ON app.hours_reconciliation_references TO hours_v2_cleanup_owner;
CREATE POLICY hours_cleanup_delete ON app.hours_reconciliation_references FOR DELETE TO hours_v2_cleanup_owner USING(true);

REVOKE ALL ON app.flight_component_utilization_attributions FROM PUBLIC, app_runtime;
ALTER TABLE app.flight_component_utilization_attributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.flight_component_utilization_attributions FORCE ROW LEVEL SECURITY;
GRANT SELECT ON app.flight_component_utilization_attributions TO hours_v2_reader, hours_v2_writer;
CREATE POLICY hours_owner_read ON app.flight_component_utilization_attributions FOR SELECT TO hours_v2_reader, hours_v2_writer
 USING(hours_v2_private.fact_visible(aircraft_id,NULL::uuid,reconciliation_run_id,NULL::uuid));
CREATE TRIGGER hours_history_guard BEFORE INSERT OR UPDATE OR DELETE ON app.flight_component_utilization_attributions
 FOR EACH ROW EXECUTE FUNCTION hours_v2_private.guard_history();
GRANT INSERT ON app.flight_component_utilization_attributions TO hours_v2_writer;
CREATE POLICY hours_owner_insert ON app.flight_component_utilization_attributions FOR INSERT TO hours_v2_writer
 WITH CHECK(hours_v2_private.write_scope(aircraft_id) AND hours_v2_private.fact_visible(aircraft_id,NULL::uuid,reconciliation_run_id,NULL::uuid));
GRANT SELECT ON app.flight_component_utilization_attributions TO hours_v2_cleanup_owner;
CREATE POLICY hours_cleanup_read ON app.flight_component_utilization_attributions FOR SELECT TO hours_v2_cleanup_owner USING(true);
GRANT DELETE ON app.flight_component_utilization_attributions TO hours_v2_cleanup_owner;
CREATE POLICY hours_cleanup_delete ON app.flight_component_utilization_attributions FOR DELETE TO hours_v2_cleanup_owner USING(true);

REVOKE ALL ON app.hours_candidate_component_attributions FROM PUBLIC, app_runtime;
ALTER TABLE app.hours_candidate_component_attributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.hours_candidate_component_attributions FORCE ROW LEVEL SECURITY;
GRANT SELECT ON app.hours_candidate_component_attributions TO hours_v2_reader, hours_v2_writer;
CREATE POLICY hours_owner_read ON app.hours_candidate_component_attributions FOR SELECT TO hours_v2_reader, hours_v2_writer
 USING(hours_v2_private.fact_visible(aircraft_id,NULL::uuid,reconciliation_run_id,NULL::uuid));
CREATE TRIGGER hours_history_guard BEFORE INSERT OR UPDATE OR DELETE ON app.hours_candidate_component_attributions
 FOR EACH ROW EXECUTE FUNCTION hours_v2_private.guard_history();
GRANT INSERT ON app.hours_candidate_component_attributions TO hours_v2_writer;
CREATE POLICY hours_owner_insert ON app.hours_candidate_component_attributions FOR INSERT TO hours_v2_writer
 WITH CHECK(hours_v2_private.write_scope(aircraft_id) AND hours_v2_private.fact_visible(aircraft_id,NULL::uuid,reconciliation_run_id,NULL::uuid));
GRANT SELECT ON app.hours_candidate_component_attributions TO hours_v2_cleanup_owner;
CREATE POLICY hours_cleanup_read ON app.hours_candidate_component_attributions FOR SELECT TO hours_v2_cleanup_owner USING(true);
GRANT DELETE ON app.hours_candidate_component_attributions TO hours_v2_cleanup_owner;
CREATE POLICY hours_cleanup_delete ON app.hours_candidate_component_attributions FOR DELETE TO hours_v2_cleanup_owner USING(true);

REVOKE ALL ON app.hours_reconciliation_differences FROM PUBLIC, app_runtime;
ALTER TABLE app.hours_reconciliation_differences ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.hours_reconciliation_differences FORCE ROW LEVEL SECURITY;
GRANT SELECT ON app.hours_reconciliation_differences TO hours_v2_reader, hours_v2_writer;
CREATE POLICY hours_owner_read ON app.hours_reconciliation_differences FOR SELECT TO hours_v2_reader, hours_v2_writer
 USING(hours_v2_private.fact_visible(aircraft_id,NULL::uuid,reconciliation_run_id,NULL::uuid));
CREATE TRIGGER hours_history_guard BEFORE INSERT OR UPDATE OR DELETE ON app.hours_reconciliation_differences
 FOR EACH ROW EXECUTE FUNCTION hours_v2_private.guard_history();
GRANT INSERT ON app.hours_reconciliation_differences TO hours_v2_writer;
CREATE POLICY hours_owner_insert ON app.hours_reconciliation_differences FOR INSERT TO hours_v2_writer
 WITH CHECK(hours_v2_private.write_scope(aircraft_id) AND hours_v2_private.fact_visible(aircraft_id,NULL::uuid,reconciliation_run_id,NULL::uuid));
GRANT SELECT ON app.hours_reconciliation_differences TO hours_v2_cleanup_owner;
CREATE POLICY hours_cleanup_read ON app.hours_reconciliation_differences FOR SELECT TO hours_v2_cleanup_owner USING(true);
GRANT DELETE ON app.hours_reconciliation_differences TO hours_v2_cleanup_owner;
CREATE POLICY hours_cleanup_delete ON app.hours_reconciliation_differences FOR DELETE TO hours_v2_cleanup_owner USING(true);

REVOKE ALL ON app.hours_reconciliation_issues FROM PUBLIC, app_runtime;
ALTER TABLE app.hours_reconciliation_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.hours_reconciliation_issues FORCE ROW LEVEL SECURITY;
GRANT SELECT ON app.hours_reconciliation_issues TO hours_v2_reader, hours_v2_writer;
CREATE POLICY hours_owner_read ON app.hours_reconciliation_issues FOR SELECT TO hours_v2_reader, hours_v2_writer
 USING(hours_v2_private.fact_visible(aircraft_id,NULL::uuid,reconciliation_run_id,NULL::uuid));
CREATE TRIGGER hours_history_guard BEFORE INSERT OR UPDATE OR DELETE ON app.hours_reconciliation_issues
 FOR EACH ROW EXECUTE FUNCTION hours_v2_private.guard_history();
GRANT INSERT ON app.hours_reconciliation_issues TO hours_v2_writer;
CREATE POLICY hours_owner_insert ON app.hours_reconciliation_issues FOR INSERT TO hours_v2_writer
 WITH CHECK(hours_v2_private.write_scope(aircraft_id) AND hours_v2_private.fact_visible(aircraft_id,NULL::uuid,reconciliation_run_id,NULL::uuid));
GRANT SELECT ON app.hours_reconciliation_issues TO hours_v2_cleanup_owner;
CREATE POLICY hours_cleanup_read ON app.hours_reconciliation_issues FOR SELECT TO hours_v2_cleanup_owner USING(true);
GRANT DELETE ON app.hours_reconciliation_issues TO hours_v2_cleanup_owner;
CREATE POLICY hours_cleanup_delete ON app.hours_reconciliation_issues FOR DELETE TO hours_v2_cleanup_owner USING(true);

REVOKE ALL ON app.hours_reconciliation_confirmations FROM PUBLIC, app_runtime;
ALTER TABLE app.hours_reconciliation_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.hours_reconciliation_confirmations FORCE ROW LEVEL SECURITY;
GRANT SELECT ON app.hours_reconciliation_confirmations TO hours_v2_reader, hours_v2_writer;
CREATE POLICY hours_owner_read ON app.hours_reconciliation_confirmations FOR SELECT TO hours_v2_reader, hours_v2_writer
 USING(hours_v2_private.owner_active(aircraft_id));
CREATE TRIGGER hours_history_guard BEFORE INSERT OR UPDATE OR DELETE ON app.hours_reconciliation_confirmations
 FOR EACH ROW EXECUTE FUNCTION hours_v2_private.guard_history();
GRANT INSERT ON app.hours_reconciliation_confirmations TO hours_v2_writer;
CREATE POLICY hours_owner_insert ON app.hours_reconciliation_confirmations FOR INSERT TO hours_v2_writer
 WITH CHECK(hours_v2_private.write_scope(aircraft_id));
GRANT SELECT ON app.hours_reconciliation_confirmations TO hours_v2_cleanup_owner;
CREATE POLICY hours_cleanup_read ON app.hours_reconciliation_confirmations FOR SELECT TO hours_v2_cleanup_owner USING(true);

REVOKE ALL ON app.hours_import_committed_rows FROM PUBLIC, app_runtime;
ALTER TABLE app.hours_import_committed_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.hours_import_committed_rows FORCE ROW LEVEL SECURITY;
GRANT SELECT ON app.hours_import_committed_rows TO hours_v2_reader, hours_v2_writer;
CREATE POLICY hours_owner_read ON app.hours_import_committed_rows FOR SELECT TO hours_v2_reader, hours_v2_writer
 USING(hours_v2_private.owner_active(aircraft_id));
CREATE TRIGGER hours_history_guard BEFORE INSERT OR UPDATE OR DELETE ON app.hours_import_committed_rows
 FOR EACH ROW EXECUTE FUNCTION hours_v2_private.guard_history();
GRANT INSERT ON app.hours_import_committed_rows TO hours_v2_writer;
CREATE POLICY hours_owner_insert ON app.hours_import_committed_rows FOR INSERT TO hours_v2_writer
 WITH CHECK(hours_v2_private.write_scope(aircraft_id));
GRANT SELECT ON app.hours_import_committed_rows TO hours_v2_cleanup_owner;
CREATE POLICY hours_cleanup_read ON app.hours_import_committed_rows FOR SELECT TO hours_v2_cleanup_owner USING(true);

REVOKE ALL ON app.aircraft_hours_acceptances FROM PUBLIC, app_runtime;
ALTER TABLE app.aircraft_hours_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.aircraft_hours_acceptances FORCE ROW LEVEL SECURITY;
GRANT SELECT ON app.aircraft_hours_acceptances TO hours_v2_reader, hours_v2_writer;
CREATE POLICY hours_owner_read ON app.aircraft_hours_acceptances FOR SELECT TO hours_v2_reader, hours_v2_writer
 USING(hours_v2_private.owner_active(aircraft_id));
CREATE TRIGGER hours_history_guard BEFORE INSERT OR UPDATE OR DELETE ON app.aircraft_hours_acceptances
 FOR EACH ROW EXECUTE FUNCTION hours_v2_private.guard_history();
GRANT INSERT ON app.aircraft_hours_acceptances TO hours_v2_writer;
CREATE POLICY hours_owner_insert ON app.aircraft_hours_acceptances FOR INSERT TO hours_v2_writer
 WITH CHECK(hours_v2_private.write_scope(aircraft_id));
GRANT SELECT ON app.aircraft_hours_acceptances TO hours_v2_cleanup_owner;
CREATE POLICY hours_cleanup_read ON app.aircraft_hours_acceptances FOR SELECT TO hours_v2_cleanup_owner USING(true);

REVOKE ALL ON app.hours_acceptance_invalidations FROM PUBLIC, app_runtime;
ALTER TABLE app.hours_acceptance_invalidations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.hours_acceptance_invalidations FORCE ROW LEVEL SECURITY;
GRANT SELECT ON app.hours_acceptance_invalidations TO hours_v2_reader, hours_v2_writer;
CREATE POLICY hours_owner_read ON app.hours_acceptance_invalidations FOR SELECT TO hours_v2_reader, hours_v2_writer
 USING(hours_v2_private.owner_active(aircraft_id));
CREATE TRIGGER hours_history_guard BEFORE INSERT OR UPDATE OR DELETE ON app.hours_acceptance_invalidations
 FOR EACH ROW EXECUTE FUNCTION hours_v2_private.guard_history();
GRANT INSERT ON app.hours_acceptance_invalidations TO hours_v2_invalidator;
CREATE POLICY hours_internal_invalidation ON app.hours_acceptance_invalidations FOR INSERT TO hours_v2_invalidator WITH CHECK(true);
GRANT SELECT ON app.hours_acceptance_invalidations TO hours_v2_cleanup_owner;
CREATE POLICY hours_cleanup_read ON app.hours_acceptance_invalidations FOR SELECT TO hours_v2_cleanup_owner USING(true);

-- Only invalidation facts, no authority to change an old acceptance or its inputs.
GRANT SELECT ON app.aircraft_hours_acceptances TO hours_v2_invalidator;
CREATE POLICY hours_internal_head ON app.aircraft_hours_acceptances FOR SELECT TO hours_v2_invalidator USING(true);
-- No UPDATE/DELETE to any new application role on canonical revisions or Audit.
REVOKE ALL ON app.flight_record_revisions, audit.audit_events FROM hours_v2_reader,
 hours_v2_writer, hours_v2_maintenance, hours_v2_invalidator;

CREATE FUNCTION hours_v2_private.purge_batch(p_aircraft uuid, p_batch uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE b app.flight_import_batches%ROWTYPE;
BEGIN
  IF current_setting('transaction_isolation')<>'serializable' THEN
    RAISE EXCEPTION 'Serializable cleanup required' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM app.aircraft WHERE aircraft_id=p_aircraft FOR UPDATE;
  SELECT * INTO b FROM app.flight_import_batches WHERE aircraft_id=p_aircraft AND import_batch_id=p_batch FOR UPDATE;
  IF NOT FOUND OR NOT b.hours_v2 THEN RAISE EXCEPTION 'Not a V2 batch' USING ERRCODE='42501'; END IF;
  IF b.hours_v2_stage_state='PURGED' THEN RETURN false; END IF;
  IF b.status='COMMITTED' OR b.hours_v2_stage_state='CONFIRMED'
    OR EXISTS(SELECT 1 FROM app.hours_reconciliation_runs r JOIN app.hours_reconciliation_confirmations c USING(aircraft_id,reconciliation_run_id) WHERE r.import_batch_id=p_batch) THEN
    RAISE EXCEPTION 'Confirmed evidence is not temporary' USING ERRCODE='42501';
  END IF;
  IF b.hours_v2_cancelled_at IS NULL AND b.hours_v2_stage_expires_at>clock_timestamp() THEN
    RAISE EXCEPTION 'Staging still live' USING ERRCODE='42501';
  END IF;
  UPDATE app.flight_import_batches SET hours_v2_stage_state='EXPIRED'
    WHERE import_batch_id=p_batch AND hours_v2_stage_state='OPEN';
  DELETE FROM app.hours_reconciliation_issues x USING app.hours_reconciliation_runs r
    WHERE x.aircraft_id=p_aircraft AND x.reconciliation_run_id=r.reconciliation_run_id AND r.import_batch_id=p_batch;
  DELETE FROM app.hours_reconciliation_differences x USING app.hours_reconciliation_runs r
    WHERE x.aircraft_id=p_aircraft AND x.reconciliation_run_id=r.reconciliation_run_id AND r.import_batch_id=p_batch;
  DELETE FROM app.hours_candidate_component_attributions x USING app.hours_reconciliation_runs r
    WHERE x.aircraft_id=p_aircraft AND x.reconciliation_run_id=r.reconciliation_run_id AND r.import_batch_id=p_batch;
  DELETE FROM app.flight_component_utilization_attributions x USING app.hours_reconciliation_runs r
    WHERE x.aircraft_id=p_aircraft AND x.reconciliation_run_id=r.reconciliation_run_id AND r.import_batch_id=p_batch;
  DELETE FROM app.hours_reconciliation_references x USING app.hours_reconciliation_runs r
    WHERE x.aircraft_id=p_aircraft AND x.reconciliation_run_id=r.reconciliation_run_id AND r.import_batch_id=p_batch;
  DELETE FROM app.hours_reconciliation_staged_rows x USING app.hours_reconciliation_runs r
    WHERE x.aircraft_id=p_aircraft AND x.reconciliation_run_id=r.reconciliation_run_id AND r.import_batch_id=p_batch;
  DELETE FROM app.hours_reconciliation_installations x USING app.hours_reconciliation_runs r
    WHERE x.aircraft_id=p_aircraft AND x.reconciliation_run_id=r.reconciliation_run_id AND r.import_batch_id=p_batch;
  DELETE FROM app.hours_reconciliation_flights x USING app.hours_reconciliation_runs r
    WHERE x.aircraft_id=p_aircraft AND x.reconciliation_run_id=r.reconciliation_run_id AND r.import_batch_id=p_batch;
  DELETE FROM app.hours_reconciliation_runs WHERE aircraft_id=p_aircraft AND import_batch_id=p_batch;
  DELETE FROM app.hours_import_staged_rows WHERE aircraft_id=p_aircraft AND import_batch_id=p_batch;
  DELETE FROM app.hours_import_mapping_fields x USING app.hours_import_mapping_versions m
    WHERE x.aircraft_id=p_aircraft AND x.mapping_version_id=m.mapping_version_id AND m.import_batch_id=p_batch;
  DELETE FROM app.hours_import_mapping_versions WHERE aircraft_id=p_aircraft AND import_batch_id=p_batch;
  UPDATE app.flight_import_batches SET hours_v2_stage_state='PURGED', hours_v2_purged_at=clock_timestamp() WHERE import_batch_id=p_batch;
  INSERT INTO audit.audit_events(request_id,actor_type,operation_source,aircraft_id,entity_type,entity_id,action_code,metadata)
    VALUES(gen_random_uuid(),'SYSTEM','SYSTEM',p_aircraft,'HOURS_IMPORT',p_batch,'HOURS_STAGING_PURGED',jsonb_build_object('policy','hours-retention-v2.1'));
  RETURN true;
END $$;
ALTER FUNCTION hours_v2_private.purge_batch(uuid,uuid) OWNER TO hours_v2_cleanup_owner;
REVOKE ALL ON FUNCTION hours_v2_private.purge_batch(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hours_v2_private.purge_batch(uuid,uuid) TO hours_v2_maintenance;
-- Maintenance has no table SELECT/INSERT/UPDATE/DELETE and cannot SET ROLE cleanup_owner.
-- Internal provisioning review must confirm NO role-membership paths to definer owners.
-- Do NOT grant any of these roles to current runtime in this proposal.

-- Lease lifecycle for raw deletion: the worker receives an opaque storage key, never staging rows.
GRANT UPDATE(source_storage_key,hours_v2_raw_deleted_at,hours_v2_cleanup_token,
 hours_v2_cleanup_lease_until,hours_v2_cleanup_attempts,hours_v2_cleanup_retry_at,hours_v2_cleanup_error)
 ON app.flight_import_batches TO hours_v2_cleanup_owner;
CREATE FUNCTION hours_v2_private.claim_raw_cleanup(p_aircraft uuid,p_batch uuid)
RETURNS TABLE(lease_token uuid,storage_key text) LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE b app.flight_import_batches%ROWTYPE; token uuid := gen_random_uuid();
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'Serializable cleanup required' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM app.aircraft WHERE aircraft_id=p_aircraft FOR UPDATE;
 SELECT * INTO b FROM app.flight_import_batches WHERE aircraft_id=p_aircraft AND import_batch_id=p_batch FOR UPDATE;
 IF NOT FOUND OR NOT b.hours_v2 OR b.hours_v2_raw_deleted_at IS NOT NULL THEN RETURN; END IF;
 IF b.source_expires_at>clock_timestamp() AND b.hours_v2_stage_state NOT IN ('CANCELLED','EXPIRED','PURGED','CONFIRMED') THEN RETURN; END IF;
 IF b.hours_v2_cleanup_lease_until>clock_timestamp() OR b.hours_v2_cleanup_retry_at>clock_timestamp() THEN RETURN; END IF;
 IF b.source_storage_key IS NULL THEN RAISE EXCEPTION 'Missing cleanup key'; END IF;
 UPDATE app.flight_import_batches SET hours_v2_cleanup_token=token,hours_v2_cleanup_lease_until=clock_timestamp()+interval '2 minutes',
  hours_v2_cleanup_attempts=hours_v2_cleanup_attempts+1 WHERE import_batch_id=p_batch;
 RETURN QUERY SELECT token,b.source_storage_key;
END $$;
ALTER FUNCTION hours_v2_private.claim_raw_cleanup(uuid,uuid) OWNER TO hours_v2_cleanup_owner;
REVOKE ALL ON FUNCTION hours_v2_private.claim_raw_cleanup(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hours_v2_private.claim_raw_cleanup(uuid,uuid) TO hours_v2_maintenance;

CREATE FUNCTION hours_v2_private.finish_raw_cleanup(p_aircraft uuid,p_batch uuid,p_token uuid,p_verified_absent boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE b app.flight_import_batches%ROWTYPE;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'Serializable cleanup required' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM app.aircraft WHERE aircraft_id=p_aircraft FOR UPDATE;
 SELECT * INTO b FROM app.flight_import_batches WHERE aircraft_id=p_aircraft AND import_batch_id=p_batch FOR UPDATE;
 IF NOT FOUND OR NOT b.hours_v2 THEN RAISE EXCEPTION 'Not a V2 batch' USING ERRCODE='42501'; END IF;
 IF b.hours_v2_raw_deleted_at IS NOT NULL THEN RETURN false; END IF;
 IF p_token IS NULL OR b.hours_v2_cleanup_token IS DISTINCT FROM p_token OR b.hours_v2_cleanup_lease_until<=clock_timestamp() THEN
  RAISE EXCEPTION 'Stale cleanup lease' USING ERRCODE='40001';
 END IF;
 IF coalesce(p_verified_absent,false) THEN
  UPDATE app.flight_import_batches SET source_storage_key=NULL,hours_v2_raw_deleted_at=clock_timestamp(),
   hours_v2_cleanup_token=NULL,hours_v2_cleanup_lease_until=NULL,hours_v2_cleanup_retry_at=NULL,hours_v2_cleanup_error=NULL WHERE import_batch_id=p_batch;
  INSERT INTO audit.audit_events(request_id,actor_type,operation_source,aircraft_id,entity_type,entity_id,action_code,metadata)
   VALUES(gen_random_uuid(),'SYSTEM','SYSTEM',p_aircraft,'HOURS_IMPORT',p_batch,'HOURS_RAW_DELETION_VERIFIED',jsonb_build_object('policy','hours-retention-v2.1'));
 ELSE
  UPDATE app.flight_import_batches SET hours_v2_cleanup_token=NULL,hours_v2_cleanup_lease_until=NULL,
   hours_v2_cleanup_retry_at=clock_timestamp()+interval '5 minutes',hours_v2_cleanup_error='VERIFY_FAILED' WHERE import_batch_id=p_batch;
 END IF;
 RETURN coalesce(p_verified_absent,false);
END $$;
ALTER FUNCTION hours_v2_private.finish_raw_cleanup(uuid,uuid,uuid,boolean) OWNER TO hours_v2_cleanup_owner;
REVOKE ALL ON FUNCTION hours_v2_private.finish_raw_cleanup(uuid,uuid,uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hours_v2_private.finish_raw_cleanup(uuid,uuid,uuid,boolean) TO hours_v2_maintenance;

-- Seal batch in the SAME transaction as confirmation, lineage and successor acceptance.
GRANT UPDATE(status,committed_at,hours_v2_stage_state) ON app.flight_import_batches TO hours_v2_security_owner;
CREATE FUNCTION hours_v2_private.seal_batch(p_aircraft uuid,p_batch uuid,p_run uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
 IF NOT coalesce(hours_v2_private.write_scope(p_aircraft),false) THEN RAISE EXCEPTION 'Seal denied' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM app.hours_reconciliation_runs r
   JOIN app.hours_reconciliation_confirmations c USING(aircraft_id,reconciliation_run_id)
   JOIN app.aircraft_hours_acceptances a USING(aircraft_id,reconciliation_run_id)
   WHERE r.aircraft_id=p_aircraft AND r.import_batch_id=p_batch AND r.reconciliation_run_id=p_run) THEN
   RAISE EXCEPTION 'Atomic acceptance missing' USING ERRCODE='23514';
 END IF;
 UPDATE app.flight_import_batches SET status='COMMITTED',committed_at=clock_timestamp(),hours_v2_stage_state='CONFIRMED'
  WHERE aircraft_id=p_aircraft AND import_batch_id=p_batch AND hours_v2 AND hours_v2_stage_state='OPEN'
    AND hours_v2_stage_expires_at>clock_timestamp();
 IF NOT FOUND THEN RAISE EXCEPTION 'Closed or expired batch' USING ERRCODE='23514'; END IF;
END $$;
ALTER FUNCTION hours_v2_private.seal_batch(uuid,uuid,uuid) OWNER TO hours_v2_security_owner;
REVOKE ALL ON FUNCTION hours_v2_private.seal_batch(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hours_v2_private.seal_batch(uuid,uuid,uuid) TO hours_v2_writer;
GRANT SELECT ON app.hours_reconciliation_runs, app.hours_reconciliation_confirmations,
 app.aircraft_hours_acceptances TO hours_v2_security_owner;
CREATE POLICY hours_seal_confirmation ON app.hours_reconciliation_confirmations FOR SELECT TO hours_v2_security_owner USING(true);
CREATE POLICY hours_seal_acceptance ON app.aircraft_hours_acceptances FOR SELECT TO hours_v2_security_owner USING(true);

CREATE FUNCTION hours_v2_private.guard_batch_lifecycle() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.hours_v2 THEN RAISE EXCEPTION 'V2 batch tombstone is retained' USING ERRCODE='42501'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.hours_v2 AND current_user<>'hours_v2_security_owner' THEN RAISE EXCEPTION 'V2 batch factory required' USING ERRCODE='42501'; END IF;
  RETURN NEW;
 END IF;
 IF OLD.hours_v2 OR NEW.hours_v2 THEN
  IF TG_OP='DELETE' OR NOT NEW.hours_v2 OR NEW.aircraft_id<>OLD.aircraft_id
    OR NEW.import_batch_id<>OLD.import_batch_id OR NEW.created_at<>OLD.created_at
    OR NEW.source_file_sha256<>OLD.source_file_sha256 OR NEW.source_filename<>OLD.source_filename
    OR NEW.hours_v2_retention_policy IS DISTINCT FROM OLD.hours_v2_retention_policy
    OR NEW.hours_v2_stage_expires_at IS DISTINCT FROM OLD.hours_v2_stage_expires_at
    OR NEW.source_expires_at IS DISTINCT FROM OLD.source_expires_at
    OR current_user NOT IN ('hours_v2_security_owner','hours_v2_cleanup_owner') THEN
   RAISE EXCEPTION 'Protected V2 lifecycle' USING ERRCODE='42501';
  END IF;
  IF NEW.hours_v2_stage_state IS DISTINCT FROM OLD.hours_v2_stage_state AND NOT (
    (OLD.hours_v2_stage_state='OPEN' AND NEW.hours_v2_stage_state IN ('CANCELLED','EXPIRED','CONFIRMED')) OR
    (OLD.hours_v2_stage_state IN ('CANCELLED','EXPIRED') AND NEW.hours_v2_stage_state='PURGED')) THEN
   RAISE EXCEPTION 'Terminal batch cannot reopen' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION hours_v2_private.guard_batch_lifecycle() FROM PUBLIC;
CREATE TRIGGER hours_v2_batch_guard BEFORE INSERT OR UPDATE OR DELETE ON app.flight_import_batches
 FOR EACH ROW EXECUTE FUNCTION hours_v2_private.guard_batch_lifecycle();

-- Deferred end-of-transaction invariant: no confirmation without acceptance or missing promoted rows.
CREATE FUNCTION hours_v2_private.check_confirmation_complete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM app.aircraft_hours_acceptances a WHERE a.aircraft_id=NEW.aircraft_id AND a.reconciliation_run_id=NEW.reconciliation_run_id) THEN
   RAISE EXCEPTION 'Confirmation needs atomic acceptance' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM app.hours_reconciliation_staged_rows WHERE aircraft_id=NEW.aircraft_id
   AND reconciliation_run_id=NEW.reconciliation_run_id AND disposition='REQUIRES_REVIEW')
   OR EXISTS(SELECT 1 FROM app.hours_reconciliation_issues WHERE aircraft_id=NEW.aircraft_id
   AND reconciliation_run_id=NEW.reconciliation_run_id AND severity='ERROR') THEN
   RAISE EXCEPTION 'Blocking validation issues remain' USING ERRCODE='23514';
 END IF;
 SELECT import_batch_id INTO b FROM app.hours_reconciliation_runs WHERE reconciliation_run_id=NEW.reconciliation_run_id;
 IF b IS NOT NULL THEN
  IF NOT hours_v2_private.batch_confirmed(NEW.aircraft_id,b) THEN RAISE EXCEPTION 'Batch not sealed' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM app.hours_reconciliation_staged_rows s
    WHERE s.aircraft_id=NEW.aircraft_id AND s.reconciliation_run_id=NEW.reconciliation_run_id AND s.disposition='INCLUDE'
    AND NOT EXISTS(SELECT 1 FROM app.hours_import_committed_rows c
      JOIN app.hours_import_staged_rows row_source ON row_source.staged_row_id=c.staged_row_id
      JOIN app.flight_records f ON f.aircraft_id=c.aircraft_id AND f.flight_id=c.flight_id
      WHERE c.aircraft_id=s.aircraft_id AND c.reconciliation_run_id=s.reconciliation_run_id AND c.staged_row_id=s.staged_row_id
        AND f.status='ACTIVE' AND f.import_batch_id=b AND f.import_row_number=row_source.source_ordinal AND f.current_revision_id=c.flight_revision_id)) THEN
    RAISE EXCEPTION 'Incomplete or mismatched import lineage' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION hours_v2_private.check_confirmation_complete() OWNER TO hours_v2_security_owner;
REVOKE ALL ON FUNCTION hours_v2_private.check_confirmation_complete() FROM PUBLIC;
CREATE FUNCTION hours_v2_private.batch_confirmed(p_aircraft uuid,p_batch uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(hours_v2_private.owner_active(p_aircraft),false) AND EXISTS(SELECT 1 FROM app.flight_import_batches
  WHERE aircraft_id=p_aircraft AND import_batch_id=p_batch AND hours_v2 AND status='COMMITTED' AND hours_v2_stage_state='CONFIRMED' AND hours_v2_stage_expires_at>clock_timestamp());
$$;
ALTER FUNCTION hours_v2_private.batch_confirmed(uuid,uuid) OWNER TO hours_v2_security_owner;
REVOKE ALL ON FUNCTION hours_v2_private.batch_confirmed(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hours_v2_private.batch_confirmed(uuid,uuid) TO hours_v2_writer;
CREATE CONSTRAINT TRIGGER hours_confirmation_complete AFTER INSERT ON app.hours_reconciliation_confirmations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION hours_v2_private.check_confirmation_complete();
-- Writer can only READ canonical lineage here. Existing trusted flight repository remains the
-- sole canonical mutator; no new grant to INSERT/UPDATE revisions/roots is provided.
GRANT SELECT ON app.flight_records, app.hours_reconciliation_staged_rows,
 app.hours_import_committed_rows, app.hours_import_staged_rows, app.hours_reconciliation_issues TO hours_v2_security_owner;
CREATE POLICY hours_check_rows ON app.hours_reconciliation_staged_rows FOR SELECT TO hours_v2_security_owner USING(true);
CREATE POLICY hours_check_lineage ON app.hours_import_committed_rows FOR SELECT TO hours_v2_security_owner USING(true);
CREATE POLICY hours_check_issues ON app.hours_reconciliation_issues FOR SELECT TO hours_v2_security_owner USING(true);
CREATE POLICY hours_check_source ON app.hours_import_staged_rows FOR SELECT TO hours_v2_security_owner USING(true);

REVOKE CREATE ON SCHEMA hours_v2_private FROM hours_v2_security_owner,hours_v2_cleanup_owner;

CREATE FUNCTION hours_v2_private.due_cleanup(p_limit integer DEFAULT 50)
RETURNS TABLE(aircraft_id uuid,import_batch_id uuid) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT b.aircraft_id,b.import_batch_id FROM app.flight_import_batches b WHERE b.hours_v2 AND (
  (b.hours_v2_raw_deleted_at IS NULL AND (b.source_expires_at<=clock_timestamp() OR b.hours_v2_stage_state IN ('CANCELLED','EXPIRED','PURGED','CONFIRMED'))
   AND (b.hours_v2_cleanup_retry_at IS NULL OR b.hours_v2_cleanup_retry_at<=clock_timestamp())
   AND (b.hours_v2_cleanup_lease_until IS NULL OR b.hours_v2_cleanup_lease_until<=clock_timestamp()))
  OR (b.hours_v2_stage_state NOT IN ('CONFIRMED','PURGED') AND (b.hours_v2_cancelled_at IS NOT NULL OR b.hours_v2_stage_expires_at<=clock_timestamp())))
 ORDER BY b.created_at,b.import_batch_id LIMIT greatest(0,least(coalesce(p_limit,0),100));
$$;
-- Temporarily grant CREATE only to transfer this last function, then withdraw it.
GRANT CREATE ON SCHEMA hours_v2_private TO hours_v2_cleanup_owner;
ALTER FUNCTION hours_v2_private.due_cleanup(integer) OWNER TO hours_v2_cleanup_owner;
REVOKE CREATE ON SCHEMA hours_v2_private FROM hours_v2_cleanup_owner;
REVOKE ALL ON FUNCTION hours_v2_private.due_cleanup(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hours_v2_private.due_cleanup(integer) TO hours_v2_maintenance;
