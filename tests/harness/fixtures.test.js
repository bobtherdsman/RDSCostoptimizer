import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const fixturesDir = fileURLToPath(new URL("../fixtures", import.meta.url));
const fixtureFiles = readdirSync(fixturesDir).filter((name) => name.endsWith(".json"));

function assertDistribution(value, label) {
  for (const key of ["avg", "p50", "p90", "p95", "p99", "max"]) {
    assert.equal(typeof value[key], "number", `${label}.${key} must be a number`);
  }
}

describe("fixture contracts", () => {
  it("contains the initial deterministic cases", () => {
    assert.deepEqual(fixtureFiles.sort(), [
      "db-level-io-offender.json",
      "low-cpu-iops-blocked.json",
      "low-cpu-memory-blocked.json",
      "low-cpu-memory-fits.json",
      "low-cpu-throughput-blocked.json"
    ]);
  });

  for (const file of fixtureFiles) {
    it(`${file} matches the fixture envelope`, () => {
      const fixture = JSON.parse(readFileSync(join(fixturesDir, file), "utf8"));

      assert.equal(typeof fixture.name, "string");
      assert.equal(typeof fixture.description, "string");
      assert.equal(typeof fixture.currentConfig.region, "string");
      assert.equal(typeof fixture.currentConfig.instanceClass, "string");
      assert.equal(fixture.currentConfig.sqlServerEdition, "Standard");
      assert.equal(fixture.currentConfig.licenseModel, "license-included");
      assert.equal(typeof fixture.currentConfig.allocatedStorageGb, "number");
      assert.equal(typeof fixture.currentConfig.multiAz, "boolean");

      assert.equal(typeof fixture.workload.collectionHours, "number");
      assertDistribution(fixture.workload.cpuPct, "workload.cpuPct");
      assertDistribution(fixture.workload.iops, "workload.iops");
      assertDistribution(fixture.workload.throughputMbps, "workload.throughputMbps");
      assert.ok(Array.isArray(fixture.workload.databases));
      assert.ok(fixture.workload.databases.length > 0);

      for (const db of fixture.workload.databases) {
        assert.equal(typeof db.databaseName, "string");
        if (db.iops) assertDistribution(db.iops, `${db.databaseName}.iops`);
        if (db.throughputMbps) assertDistribution(db.throughputMbps, `${db.databaseName}.throughputMbps`);
      }

      assert.ok(["recommendation", "blocked"].includes(fixture.expected.outcome));
      assert.ok(Object.hasOwn(fixture.expected, "primaryBlocker"));
      assert.equal(typeof fixture.expected.topDatabase, "string");
    });
  }
});