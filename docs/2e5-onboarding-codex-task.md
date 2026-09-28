# 2E.5 — Codex implementation task: canonical aircraft onboarding

Status: implementation task frozen by D-242, D-243 and D-244. Branch: `etapa-2e4-test-app-parity`.

## Scope
Implement backend only. Do not implement or redesign UI. Do not touch Production/main or Vercel Production configuration. Do not enable `POSTGRES_ONBOARDING_WRITES_ENABLED`.

## Canonical endpoint
Extend `api/aircraft.js` so POST is supported only when `AIRCRAFT_DATA_SOURCE=POSTGRES` and `resolvePostgresOnboardingWriteCapability(...).enabled === true`. Existing GET behavior must remain compatible. Missing/false onboarding flag returns fail-closed 503 for POST. Sheets/legacy aircraft source must not receive this new mutation path.

## Input
Canonical POST body:
- `registration`: required non-empty string; trim + uppercase.
- `manufacturer`: required non-empty trimmed string.
- `model`: required non-empty trimmed string.
- `serialNumber`: optional; blank => null.
- `countryCode`: optional ISO-2; trim + uppercase; blank => null.
- `openingTisHours`: optional decimal >= 0; blank/null => null (unknown, never coerce to 0).
- `baselineEffectiveDate`: required valid ISO YYYY-MM-DD.
- `defaultCaptureMethod`: optional, default `DIRECT`; validate against DB constraint.
- `defaultOilUnit`: optional, default `US_QUART`; validate against DB constraint.

Reject unsupported business-state fields (ownership, components, tanks, purposes, tracking, legacy totals/blobs) with 422 rather than persisting them.

## Repository
Create a focused Postgres onboarding repository (prefer `api/_postgresOnboardingRepository.js`) using `withPostgresTransaction`.

Transaction requirements:
1. SERIALIZABLE.
2. Require authenticated ACTIVE canonical user.
3. Take `pg_advisory_xact_lock(hashtext(...))` keyed by normalized registration before duplicate check.
4. Privacy-safe duplicate detection:
   - any current registration (`effective_to_at IS NULL`) matching case-insensitively => throw 409 code `AIRCRAFT_POSSIBLE_DUPLICATE`;
   - if serialNumber supplied, normalized manufacturer + serial collision => same 409;
   - never expose matching aircraft/user details and never auto-merge.
5. Insert `app.aircraft`: ACTIVE, creator user, timestamps.
6. Insert initial current `app.aircraft_registrations`, effective_from_at = transaction time, optional country code.
7. Insert ACTIVE creator `app.aircraft_memberships` role OWNER, activated_at now. OWNER is app access only.
8. Insert active `MANAGE_OWNERSHIP` in `app.aircraft_membership_capabilities`, granted by creator.
9. Insert `app.aircraft_settings` using validated/default capture method and oil unit.
10. Insert `app.aircraft_utilization_baselines`: nullable opening TIS, required effective date, source OWNER_ENTRY, creator. Do not invent first_tracked_flight_id.
11. DO NOT insert `aircraft_ownership_interests`. Ownership readiness must remain false until separately configured and total active shares = 100%.
12. Insert append-only `audit.audit_events` in the SAME transaction: USER/MANUAL, entity AIRCRAFT, action `AIRCRAFT_CREATED`, actor creator, aircraft/entity IDs, request UUID, after_state containing canonical created state and metadata with contract `D-242/D-244`. Audit metadata is evidence, not business state.
13. Return only after commit.

## Response
201 JSON:
`{ ok:true, aircraft:{ aircraft_id, matricula, fabricante, modelo, rol:"OWNER" }, onboarding:{ ownershipConfigured:false, flightWritesReady:false } }`

Do not expose duplicate details.

## Error contract
- 400 invalid primitive/canonical input where appropriate.
- 403 inactive/unauthorized canonical user.
- 409 `AIRCRAFT_POSSIBLE_DUPLICATE`.
- 422 unsupported fields / invalid onboarding business payload.
- 503 onboarding write flag disabled.
- 500/502 generic internal failure without secrets.

## Tests / verification
Add focused automated tests if the repo test harness supports them. At minimum ensure:
- GET aircraft behavior unchanged.
- POST disabled by default.
- validation rejects malformed/unsupported payload.
- duplicate errors are privacy-safe.
- unknown opening TIS stays null.
- repository uses one transaction and Audit is inside it.
- no ownership-interest insert exists.
- no Production selector/config changes.
- no secrets or connection strings.

Do not perform a persistent TEST canary and do not enable the flag. Finish with code/build/tests only; the technical lead will independently review diff, runtime grants, transaction/Audit and then authorize the canary gate.


## Preflight status
- D-246: backend implementation preflight PASS for commit eab01de60dbd42ec3dc01417361f64a7976906c2.
- Runtime INSERT privileges verified for all bootstrap tables and Audit.
- Persistent onboarding canary remains pending; Preview gate must be enabled before the canary.
- Production remains out of scope.
