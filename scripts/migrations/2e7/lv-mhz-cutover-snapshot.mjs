import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { batchGetSpreadsheetValuesReadonly } from "./google-sheets-readonly.mjs";
import { buildCutoverSnapshot } from "./cutover-snapshot-core.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function generateCanonicalBundle({ sourceSnapshot, targetManifest, temporaryDirectory }) {
  const sourceSnapshotPath = path.join(temporaryDirectory, "source-snapshot.json");
  const targetManifestPath = path.join(temporaryDirectory, "target-manifest.json");
  const bundlePath = path.join(temporaryDirectory, "canonical-bundle.json");
  await fs.writeFile(sourceSnapshotPath, `${JSON.stringify(sourceSnapshot)}\n`, "utf8");
  await fs.writeFile(targetManifestPath, `${JSON.stringify(targetManifest)}\n`, "utf8");

  await execFileAsync(process.execPath, [
    path.join(repositoryRoot, "scripts/migrations/2e3/lv-mhz-build-bundle.mjs"),
  ], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      MIGRATION_SOURCE_SNAPSHOT_INPUT: sourceSnapshotPath,
      MIGRATION_TARGET_MANIFEST_INPUT: targetManifestPath,
      MIGRATION_BUNDLE_OUTPUT: bundlePath,
    },
    windowsHide: true,
  });

  return readJson(bundlePath);
}

async function main() {
  const manifest = await readJson(path.join(
    repositoryRoot,
    "data-migrations/2e7/lv-mhz-cutover-manifest.json"
  ));
  const sourceManifest = await readJson(path.join(
    repositoryRoot,
    manifest.historical_evidence.source_manifest
  ));
  const historicalTargetManifest = await readJson(path.join(
    repositoryRoot,
    manifest.historical_evidence.target_manifest
  ));

  const adminSource = sourceManifest.sources.admin_spreadsheet;
  const aircraftSource = sourceManifest.sources.aircraft_spreadsheet;
  const [usersValues, permissionsValues, aircraftValues] = await batchGetSpreadsheetValuesReadonly(
    adminSource.spreadsheet_id,
    ["USUARIOS!A:K", "PERMISOS!A:H", "AERONAVES!A:H"]
  );
  const [
    computacionValues,
    aircraftHistoryValues,
    engineHistoryValues,
    propellerHistoryValues,
    settingsValues,
  ] = await batchGetSpreadsheetValuesReadonly(
    aircraftSource.spreadsheet_id,
    [
      "Computacion Horas!A:P",
      "Historial Aeronave!A:K",
      "Historial Motor!A:J",
      "Historial Helice!A:K",
      "CONFIGURACION!A:B",
    ]
  );

  const source = {
    usersValues,
    permissionsValues,
    aircraftValues,
    computacionValues,
    aircraftHistoryValues,
    engineHistoryValues,
    propellerHistoryValues,
    settingsValues,
  };
  const targetManifest = {
    ...historicalTargetManifest,
    migration_key: manifest.target_overrides.migration_key,
    audit_transform: {
      ...historicalTargetManifest.audit_transform,
      per_flight_reason: manifest.target_overrides.per_flight_reason,
      batch_summary_reason: manifest.target_overrides.batch_summary_reason,
    },
  };
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "app-horas-2e7-"));

  try {
    const legacyBundle = await generateCanonicalBundle({
      sourceSnapshot: {
        usersValues,
        permissionsValues,
        aircraftValues,
        computacionValues,
        historyValues: aircraftHistoryValues,
        settingsValues,
      },
      targetManifest,
      temporaryDirectory,
    });
    const { snapshot, report } = buildCutoverSnapshot({ manifest, source, legacyBundle });
    const outputPath = String(process.env.CUTOVER_SNAPSHOT_OUTPUT || "").trim();
    if (outputPath) {
      await fs.writeFile(path.resolve(outputPath), `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    }
    console.log(JSON.stringify(report, null, 2));
  } finally {
    for (const filename of ["source-snapshot.json", "target-manifest.json", "canonical-bundle.json"]) {
      try {
        await fs.unlink(path.join(temporaryDirectory, filename));
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
    await fs.rmdir(temporaryDirectory);
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error?.message || "No se pudo generar el snapshot de cutover 2E.7.",
    writesPerformed: 0,
  }));
  process.exitCode = 1;
});
