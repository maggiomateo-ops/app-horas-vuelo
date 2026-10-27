# Migration 010 — execution gate, 2026-10-27

Checkpoint verified: 05ce2afeee51a054f805250348868990c19925f1, branch codex/lv-sim-v1-tracking-reference; clean before documentation. Fast-forward only from 9fd61ba. Preflight fixture includes corrected updated_at. No implementation/SQL bytes changed in this attempt.

D-311/D-312/D-313, Roadmap 3.1B, Change Log, Schema Catalog fields and Settings Matrix consulted. D-313 is conditional authority to apply 010 only after real clone preflight, rollback and readback PASS. It does not itself satisfy those gates.

## Verified read-only

Neon project red-pine-78283204; isolated clone br-patient-sea-b67mocv2 explicitly has parent br-billowing-band-b62jj1ab. Exact authorized SELECT on clone returned current_database=app_horas, current_user=app_horas_migration, tracking fields=0 and ledger 001–008 (009/010 absent). 008 applied checksum matches exact repository bytes:
30df860f6ba51617e93c55be21e8d2355aba734977dfb3db6bf0776b5c07c160.

010 original bytes SHA-256:
40ea53f5e091a57c6bd581dcbe23c16f54192634736e2c122c536a832955d766.

TEST parent SELECT as app_horas_migration/app_horas returned 0 new tracking fields; LV-SIM installations=0, configurations=0, flights=0, existing Audit events=2. Runtime installation INSERT=true. Runtime Audit SELECT/INSERT=true, UPDATE/DELETE=false. No writes to schema, ledger, Audit or business records were executed. Parent ledger was not freshly queried in this attempt after stopping; clone ledger is the verified fresh 001–008 read. No claim of complete parent preconditions or complete privilege fingerprint.

## Execution tooling blocker

The required psql executable is absent from PATH and checked standard local PostgreSQL/client locations. DATABASE_MIGRATION_URL is not configured (only presence tested; no value printed). Authorized Neon connector SELECT and internal credential retrieval succeeded; no secret was printed, written to disk or used for execution. Credential retrieval is not proof of psql readiness or preflight PASS.

Homebrew client inspection (`brew list --versions libpq postgresql@18 postgresql@17 postgresql@16`) failed on its API cache with `Operation not permitted @ apply2files`. Classified TOOL / local filesystem access. Per the user's stop condition, no escalation, installation, alternate SQL execution route or DDL retry was attempted after this security/access block. No psql preflight was started. There is no active migration transaction from this attempt to roll back. Previous fixture failure/rollback documented in Sheets is historical evidence, not a PASS for the corrected preflight.

## Gates

- Target identity and partial read-only preconditions: verified as described above.
- Corrected SQL preflight: NOT RUN.
- ROLLBACK and post-preflight readback: NOT RUN in this attempt.
- Persistent 010 / ledger registration / COMMIT: NOT RUN.
- Post-COMMIT VERIFY: NOT RUN.
- Functional acceptance: PENDING.

Migration 010 remains unapplied by this execution. 008/009 not executed, ledger not changed. No Vercel variables/flags, Production/main, runtime/general roles, Costs functionality or LV-MHZ business data changed.

## Canonical documentation readback

Product Sheet: 02_Roadmap!H28 and 09_Change_Log!A107:G107 record current tool blockage and successful SELECT (earlier SQL connector failures remain in historical entries). Schema Catalog: Tables & Fields!J447:J448 and Settings Matrix!J108 preserve contract/conditional authorization and mark 010 pending. Updated values read back successfully; content-only masks preserved formats/validation and historical decisions. Native visual rendering not rechecked; no layout/style changes requested or applied.

## Resume requirement

Provide an authorized environment with psql available and a secure connection binding to the explicit clone, without exposing credentials. Revalidate current branch/role/ledger/columns/business counts/privileges; run the unchanged corrected preflight on the clone with ON_ERROR_STOP; prove ROLLBACK and fresh readback. Only after every D-313 condition passes may the exact original 010 and its checksum be registered atomically on reverified TEST parent. No renewed functional or DDL decision is implied by fixing tooling, and no Preview write activation or aircraft canary belongs to this step.
