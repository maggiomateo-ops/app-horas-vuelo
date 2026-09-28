import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../db/migrations/004_export_direct_response_artifacts.sql",
  import.meta.url
);

function acceptsD257State(row) {
  const pending =
    row.status === "PENDING" &&
    row.generatedAt === null &&
    row.failedAt === null &&
    row.failureCode === null &&
    row.filename === null &&
    row.sha256 === null &&
    row.size === null &&
    row.storageKey === null &&
    row.expiresAt === null &&
    row.removedAt === null;
  const failed =
    row.status === "FAILED" &&
    row.failedAt !== null &&
    row.failureCode !== null &&
    row.generatedAt === null &&
    row.filename === null &&
    row.sha256 === null &&
    row.size === null &&
    row.storageKey === null &&
    row.expiresAt === null &&
    row.removedAt === null;
  const completedMetadata =
    row.status === "COMPLETED" &&
    row.generatedAt !== null &&
    row.failedAt === null &&
    row.failureCode === null &&
    row.filename !== null &&
    row.sha256 !== null &&
    row.size !== null &&
    row.size >= 0;
  const direct =
    row.storageKey === null && row.expiresAt === null && row.removedAt === null;
  const stored =
    row.storageKey !== null && row.expiresAt !== null && row.removedAt === null;
  const removed =
    row.storageKey === null && row.expiresAt !== null && row.removedAt !== null;

  return pending || failed || (completedMetadata && (direct || stored || removed));
}

function completedArtifact(overrides = {}) {
  return {
    status: "COMPLETED",
    generatedAt: "2026-09-27T12:00:00Z",
    failedAt: null,
    failureCode: null,
    filename: "flight-history.xlsx",
    sha256: "abc123",
    size: 1024,
    storageKey: null,
    expiresAt: null,
    removedAt: null,
    ...overrides,
  };
}

test("migration 004 modifica solo los dos constraints de app.export_runs", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /ALTER TABLE app\.export_runs/);
  assert.match(sql, /DROP CONSTRAINT IF EXISTS ck_export_run_terminal_state/);
  assert.match(sql, /DROP CONSTRAINT IF EXISTS ck_export_artifact_delivery/);
  assert.match(sql, /ADD CONSTRAINT ck_export_run_terminal_state CHECK/);
  assert.match(sql, /ADD CONSTRAINT ck_export_artifact_delivery CHECK/);
  assert.doesNotMatch(sql, /ALTER TABLE (?!app\.export_runs)/);
  assert.doesNotMatch(sql, /ADD COLUMN|DROP COLUMN|INSERT INTO|UPDATE |DELETE FROM/i);
});

test("D-257 conserva PENDING y FAILED sin metadata de artifact", () => {
  assert.equal(
    acceptsD257State({
      status: "PENDING",
      generatedAt: null,
      failedAt: null,
      failureCode: null,
      filename: null,
      sha256: null,
      size: null,
      storageKey: null,
      expiresAt: null,
      removedAt: null,
    }),
    true
  );
  assert.equal(
    acceptsD257State({
      status: "FAILED",
      generatedAt: null,
      failedAt: "2026-09-27T12:00:00Z",
      failureCode: "RENDER_FAILED",
      filename: null,
      sha256: null,
      size: null,
      storageKey: null,
      expiresAt: null,
      removedAt: null,
    }),
    true
  );
});

test("D-257 acepta los tres modos COMPLETED canónicos", () => {
  assert.equal(acceptsD257State(completedArtifact()), true);
  assert.equal(
    acceptsD257State(
      completedArtifact({
        storageKey: "exports/run.xlsx",
        expiresAt: "2026-09-28T12:00:00Z",
      })
    ),
    true
  );
  assert.equal(
    acceptsD257State(
      completedArtifact({
        expiresAt: "2026-09-28T12:00:00Z",
        removedAt: "2026-09-28T13:00:00Z",
      })
    ),
    true
  );
});

test("D-257 rechaza metadata obligatoria ausente y estados híbridos", () => {
  const invalidCompleted = [
    completedArtifact({ filename: null }),
    completedArtifact({ sha256: null }),
    completedArtifact({ size: null }),
    completedArtifact({ expiresAt: "2026-09-28T12:00:00Z" }),
    completedArtifact({ storageKey: "exports/run.xlsx" }),
    completedArtifact({
      storageKey: "exports/run.xlsx",
      expiresAt: "2026-09-28T12:00:00Z",
      removedAt: "2026-09-28T13:00:00Z",
    }),
    completedArtifact({ removedAt: "2026-09-28T13:00:00Z" }),
  ];

  for (const row of invalidCompleted) assert.equal(acceptsD257State(row), false);

  assert.equal(
    acceptsD257State({
      ...completedArtifact(),
      status: "PENDING",
      generatedAt: null,
    }),
    false
  );
  assert.equal(
    acceptsD257State({
      ...completedArtifact(),
      status: "FAILED",
      generatedAt: null,
      failedAt: "2026-09-27T12:00:00Z",
      failureCode: "RENDER_FAILED",
    }),
    false
  );
});
