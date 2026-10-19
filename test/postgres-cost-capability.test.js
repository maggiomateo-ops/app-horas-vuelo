import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resolvePostgresCostWriteCapability } from "../api/_settingsWriteCapability.js";

test("Costs migrations preserve the confirmed 683ed48 contents", () => {
  for (const [filename, expected] of [
    ["006_costs.sql", "2c13566e417716ba15dfef4ce26c57e42d6b9c9b0c9ca2907905e6977dc44cd7"],
    ["007_costs_allocation_metric_adjustments.sql", "e3b5cc4690fef2bfd49eb425abd3d98f4ca64ecaf6a15026139954d9c1989326"],
  ]) {
    const content = readFileSync(new URL(`../db/migrations/${filename}`, import.meta.url));
    assert.equal(createHash("sha256").update(content).digest("hex"), expected);
  }
});

test("Costs capability fails closed and requires explicit Postgres context", () => {
  const previous = process.env.POSTGRES_COST_WRITES_ENABLED;
  try {
    for (const value of [undefined, "", "false", " FALSE "]) {
      if (value === undefined) delete process.env.POSTGRES_COST_WRITES_ENABLED;
      else process.env.POSTGRES_COST_WRITES_ENABLED = value;
      assert.deepEqual(resolvePostgresCostWriteCapability("POSTGRES"), {
        enabled: false, mode: "DISABLED",
      });
    }
    for (const value of ["true", " TRUE "]) {
      process.env.POSTGRES_COST_WRITES_ENABLED = value;
      assert.deepEqual(resolvePostgresCostWriteCapability("POSTGRES"), {
        enabled: true, mode: "OWNER_COSTS",
      });
      for (const source of [undefined, "", "SHEETS", "invalid"]) {
        assert.equal(resolvePostgresCostWriteCapability(source).enabled, false);
      }
    }
    for (const value of ["yes", "1", "0", "null"]) {
      process.env.POSTGRES_COST_WRITES_ENABLED = value;
      for (const source of ["POSTGRES", "SHEETS"]) {
        assert.throws(() => resolvePostgresCostWriteCapability(source), {
          code: "COST_WRITE_FLAG_INVALID", statusCode: 500,
        });
      }
    }
  } finally {
    if (previous === undefined) delete process.env.POSTGRES_COST_WRITES_ENABLED;
    else process.env.POSTGRES_COST_WRITES_ENABLED = previous;
  }
});
