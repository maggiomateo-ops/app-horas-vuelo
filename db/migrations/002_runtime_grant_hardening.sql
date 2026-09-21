-- App Horas — 2E.1 runtime grant hardening
-- Migration: 002_runtime_grant_hardening.sql
-- No data changes. Narrows capability-grant mutation privileges per D-184/D-190.

REVOKE UPDATE ON app.aircraft_membership_capabilities FROM app_runtime;

GRANT UPDATE (revoked_by_user_id, revoked_at)
  ON app.aircraft_membership_capabilities TO app_runtime;
