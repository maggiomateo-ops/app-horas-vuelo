-- Prepared SELECT only. Run after explicit authorization and one actual UI commit.
-- Parameters supplied by the verifier, never inferred from the database result:
-- $1 = exact approved four-installation JSON array captured from reviewed input.
-- Fields: componentType, positionIndex, manufacturer, model, serialNumber,
-- installedOn (YYYY-MM-DD), openingTisHours (number or null).
-- $2 = canonical UUID of authenticated actor from the approved session.
-- Do not execute with the incomplete plan.json input matrix.
WITH target AS (
  SELECT '96d849aa-2827-4aa3-b02b-6671577444a7'::uuid AS aircraft_id
), expected AS (
  SELECT * FROM jsonb_to_recordset($1::jsonb) AS e(
    "componentType" text,"positionIndex" integer,manufacturer text,model text,
    "serialNumber" text,"installedOn" date,"openingTisHours" numeric)
), actual AS (
  SELECT c.component_type AS "componentType",i.position_index::integer AS "positionIndex",
    c.manufacturer,c.model,c.serial_number AS "serialNumber",i.installed_on AS "installedOn",
    i.opening_tis_hours AS "openingTisHours",c.component_id,i.component_installation_id,i.removed_on,c.status
  FROM app.component_installations i JOIN app.components c USING(component_id)
  JOIN target t USING(aircraft_id)
), actual_values AS (
  SELECT "componentType","positionIndex",manufacturer,model,"serialNumber","installedOn","openingTisHours" FROM actual
), mismatches AS (
  (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual_values)
  UNION ALL
  (SELECT * FROM actual_values EXCEPT ALL SELECT * FROM expected)
), events AS (
  SELECT e.* FROM audit.audit_events e JOIN target t USING(aircraft_id)
  WHERE e.action_code='AIRCRAFT_CONFIGURATION_CREATED'
)
SELECT
  (SELECT count(*)=4 FROM expected) AS expected_four,
  (SELECT count(*)=4 AND count(DISTINCT ("componentType","positionIndex"))=4
    AND count(*) FILTER(WHERE "componentType"='ENGINE' AND "positionIndex" IN(1,2))=2
    AND count(*) FILTER(WHERE "componentType"='PROPELLER' AND "positionIndex" IN(1,2))=2
    AND bool_and("installedOn" IS NOT NULL) FROM expected) AS expected_topology_valid,
  (SELECT count(*)=4 AND count(DISTINCT component_id)=4 AND count(DISTINCT component_installation_id)=4
    AND bool_and(removed_on IS NULL AND status='ACTIVE') FROM actual) AS four_distinct_active_installations,
  NOT EXISTS(SELECT 1 FROM mismatches) AS input_values_exact_including_nulls,
  (SELECT count(*)=1 AND bool_and(c.propulsion_type='PISTON' AND c.engine_count=2 AND c.propeller_count=2)
    FROM app.aircraft_configuration c JOIN target t USING(aircraft_id)) AS topology_exact,
  (SELECT count(*)=1 AND bool_and(e.actor_type='USER' AND e.actor_user_id=$2::uuid AND e.operation_source='MANUAL'
    AND e.metadata->>'bootstrap_mode'='CREATE_COMPONENTS'
    AND e.after_state->'topology'=jsonb_build_object('propulsionType','PISTON','engineCount',2,'propellerCount',2)
    AND jsonb_array_length(e.after_state->'installations')=4) FROM events e) AS one_audit_with_actor_and_topology,
  (SELECT jsonb_agg(jsonb_build_object('id',a.component_installation_id,'componentId',a.component_id,
    'type',a."componentType",'position',a."positionIndex",'date',a."installedOn",'tis',a."openingTisHours") ORDER BY a."componentType",a."positionIndex") FROM actual a) AS persisted_installations;
-- Verify IDs and every Audit snapshot value against actual above, GET and the reviewed input.
-- Capture counts/event IDs before and after an authorized repeat: expect HTTP 409 and no new rows/events.
-- SELECT results alone do not prove rollback, concurrency behavior or authenticated end-to-end acceptance.
