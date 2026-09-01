import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CanonicalWorkloadSampleSeries } from "../src/contracts/types.js";
import { assessEvidenceWindow, assessEvidenceWindowFromDuration } from "../src/evidence-window/index.js";

describe("evidence-window assessment", () => {
  it("applies every verified duration classification", () => {
    assert.equal(assessEvidenceWindowFromDuration(24).classification, "insufficient");
    assert.equal(assessEvidenceWindowFromDuration(60).classification, "below_preliminary_window");
    assert.equal(assessEvidenceWindowFromDuration(96).classification, "preliminary");
    assert.equal(assessEvidenceWindowFromDuration(168).classification, "minimum_recommended");
    assert.equal(assessEvidenceWindowFromDuration(336).classification, "preferred");
    assert.equal(assessEvidenceWindowFromDuration(720).classification, "monthly_cycle");
    assert.equal(assessEvidenceWindowFromDuration(800).classification, "preferred");
  });

  it("assigns preliminary, medium, and high confidence from the verified bands", () => {
    assert.equal(assessEvidenceWindowFromDuration(96).confidence, "preliminary");
    assert.equal(assessEvidenceWindowFromDuration(168).confidence, "medium");
    assert.equal(assessEvidenceWindowFromDuration(336).confidence, "high");
  });

  it("calculates duration and reports continuity without inventing an allowable-gap threshold", () => {
    const series: CanonicalWorkloadSampleSeries = {
      alignmentIntervalSeconds: 60,
      cpu: [
        {
          timestamp: "2026-08-01 00:00:00",
          timestampMs: Date.parse("2026-08-01T00:00:00Z"),
          sampleKey: "2026-08-01T00:00:00.000Z",
          sqlCpuPct: 10,
          otherCpuPct: 5,
          systemIdlePct: 85
        },
        {
          timestamp: "2026-08-08 00:00:00",
          timestampMs: Date.parse("2026-08-08T00:00:00Z"),
          sampleKey: "2026-08-08T00:00:00.000Z",
          sqlCpuPct: 20,
          otherCpuPct: 5,
          systemIdlePct: 75
        }
      ],
      memory: [],
      databaseIo: [],
      synchronized: [],
      issues: [
        {
          code: "missing_sample",
          source: "memory",
          message: "Memory gap."
        },
        {
          code: "invalid_sample",
          source: "database_io",
          message: "Invalid I/O sample."
        }
      ]
    };

    const assessment = assessEvidenceWindow(series);
    assert.equal(assessment.durationHours, 168);
    assert.equal(assessment.classification, "minimum_recommended");
    assert.equal(assessment.continuityStatus, "issues_detected");
    assert.equal(assessment.continuityIssueCount, 1);
    assert.equal(assessment.invalidSampleCount, 1);
    assert.equal(assessment.representativeness, "customer_confirmation_required");
    assert.match(assessment.confidenceReason, /customer confirmation/i);
  });
});
