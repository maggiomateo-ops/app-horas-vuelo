-- Prepared SELECT only; not executed as a file in this delivery.
-- Fixed UUID is authority scope. Registration/model never authorize writes.
WITH target AS (
  SELECT * FROM app.aircraft WHERE aircraft_id='96d849aa-2827-4aa3-b02b-6671577444a7'::uuid
)
SELECT a.aircraft_id,a.status,a.manufacturer,a.model,
  (a.serial_number IS NOT NULL) AS has_serial_requiring_review,
  (SELECT count(*) FROM app.aircraft_configuration c WHERE c.aircraft_id=a.aircraft_id) AS configurations,
  (SELECT count(*) FROM app.component_installations i WHERE i.aircraft_id=a.aircraft_id) AS all_installations,
  (SELECT count(DISTINCT i.component_id) FROM app.component_installations i WHERE i.aircraft_id=a.aircraft_id) AS linked_components,
  (SELECT count(*) FROM app.flight_records f WHERE f.aircraft_id=a.aircraft_id) AS flights,
  (SELECT count(*) FROM app.flight_import_batches b WHERE b.aircraft_id=a.aircraft_id) AS imports,
  (SELECT count(*) FROM app.utilization_adjustments u WHERE u.aircraft_id=a.aircraft_id) AS adjustments,
  (SELECT count(*) FROM app.aircraft_memberships m JOIN app.users u USING(user_id)
    WHERE m.aircraft_id=a.aircraft_id AND m.role='OWNER' AND m.status='ACTIVE' AND u.status='ACTIVE') AS active_owners,
  (SELECT jsonb_agg(jsonb_build_object('tis',b.baseline_tis_hours,'date',b.baseline_effective_date,'source',b.source,'firstFlight',b.first_tracked_flight_id))
    FROM app.aircraft_utilization_baselines b WHERE b.aircraft_id=a.aircraft_id) AS baseline,
  (SELECT count(*) FROM audit.audit_events e WHERE e.aircraft_id=a.aircraft_id
    AND e.action_code='AIRCRAFT_CONFIGURATION_CREATED') AS configuration_events
FROM target a;
