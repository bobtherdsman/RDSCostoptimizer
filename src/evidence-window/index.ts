import type {
  CanonicalWorkloadSampleSeries,
  EvidenceWindowAssessment,
  EvidenceWindowClassification,
  EvidenceWindowShortWindowException,
  WorkloadSampleIssueCode
} from "../contracts/types.js";

const HOUR_MS = 60 * 60 * 1000;

export function assessEvidenceWindow(
  series: CanonicalWorkloadSampleSeries | undefined,
  fallbackDurationHours = 0,
  shortWindowException?: EvidenceWindowShortWindowException
): EvidenceWindowAssessment {
  const timestamps = series
    ? [
        ...series.cpu.map((sample) => sample.timestampMs),
        ...series.memory.map((sample) => sample.timestampMs),
        ...series.databaseIo.map((sample) => sample.timestampMs)
      ].filter(Number.isFinite)
    : [];
  const startTimestampMs = timestamps.length > 0 ? Math.min(...timestamps) : undefined;
  const endTimestampMs = timestamps.length > 0 ? Math.max(...timestamps) : undefined;
  const durationHours = round(
    startTimestampMs !== undefined && endTimestampMs !== undefined
      ? (endTimestampMs - startTimestampMs) / HOUR_MS
      : fallbackDurationHours
  );
  const issueCounts = countIssues(series);
  const continuityIssueCount =
    issueCounts.missing_sample
    + issueCounts.duplicate_sample
    + issueCounts.out_of_order;
  const invalidSampleCount =
    issueCounts.counter_reset
    + issueCounts.invalid_sample
    + issueCounts.invalid_elapsed;
  const classification = classifyEvidenceWindow(durationHours);
  const confirmedShortWindowException = durationHours < 48
    && shortWindowException?.customerConfirmed === true;
  const confidence = confidenceForClassification(classification);
  const continuityStatus = !series
    ? "unavailable"
    : continuityIssueCount === 0
      ? "complete"
      : "issues_detected";
  const durationReason = reasonForClassification(classification, durationHours, confirmedShortWindowException);
  const continuityReason = continuityStatus === "complete"
    ? "No missing, duplicate, or out-of-order sample intervals were detected."
    : continuityStatus === "unavailable"
      ? "Canonical sample continuity evidence is unavailable."
      : `${continuityIssueCount} continuity issue(s) were detected and must be reviewed.`;

  return {
    startTimestamp: startTimestampMs === undefined ? undefined : new Date(startTimestampMs).toISOString(),
    endTimestamp: endTimestampMs === undefined ? undefined : new Date(endTimestampMs).toISOString(),
    durationHours,
    durationDays: round(durationHours / 24),
    classification,
    confidence,
    productionRightsizingEligible: durationHours >= 48 || confirmedShortWindowException,
    continuityStatus,
    continuityIssueCount,
    invalidSampleCount,
    issueCounts,
    representativeness: "customer_confirmation_required",
    representativenessStatement:
      "Customer must verbally confirm that the collection represents normal workload and includes normal peak business periods.",
    shortWindowException: confirmedShortWindowException ? shortWindowException : undefined,
    confidenceReason: `${durationReason} ${continuityReason} Business-period representativeness requires customer confirmation.`
  };
}

export function assessEvidenceWindowFromDuration(
  durationHours: number,
  shortWindowException?: EvidenceWindowShortWindowException
): EvidenceWindowAssessment {
  return assessEvidenceWindow(undefined, durationHours, shortWindowException);
}

function classifyEvidenceWindow(durationHours: number): EvidenceWindowClassification {
  if (durationHours < 48) return "insufficient";
  if (durationHours < 72) return "below_preliminary_window";
  if (durationHours < 168) return "preliminary";
  if (durationHours < 336) return "minimum_recommended";
  if (durationHours >= 720 && durationHours <= 768) return "monthly_cycle";
  return "preferred";
}

function confidenceForClassification(
  classification: EvidenceWindowClassification
): EvidenceWindowAssessment["confidence"] {
  if (classification === "minimum_recommended") return "medium";
  if (classification === "preferred" || classification === "monthly_cycle") return "high";
  return "preliminary";
}

function reasonForClassification(
  classification: EvidenceWindowClassification,
  durationHours: number,
  confirmedShortWindowException = false
): string {
  const hours = round(durationHours);
  if (classification === "insufficient") {
    if (confirmedShortWindowException) {
      return `${hours} collected hours is below 48 hours and is eligible only under the documented customer-confirmed clearly idle or non-production exception.`;
    }
    return `${hours} collected hours is below 48 hours and is insufficient for production rightsizing except a clearly idle or non-production case confirmed by the customer.`;
  }
  if (classification === "below_preliminary_window") {
    return `${hours} collected hours is above the insufficient band but below the documented three-day preliminary window.`;
  }
  if (classification === "preliminary") {
    return `${round(durationHours / 24)} collected days is a preliminary, low-to-medium confidence window.`;
  }
  if (classification === "minimum_recommended") {
    return `${round(durationHours / 24)} collected days meets the minimum recommended production assessment window.`;
  }
  if (classification === "monthly_cycle") {
    return `${round(durationHours / 24)} collected days covers the documented 30-32 day monthly-cycle window.`;
  }
  return `${round(durationHours / 24)} collected days meets the preferred default for high-confidence optimization.`;
}

function countIssues(
  series: CanonicalWorkloadSampleSeries | undefined
): Record<WorkloadSampleIssueCode, number> {
  const counts: Record<WorkloadSampleIssueCode, number> = {
    missing_sample: 0,
    duplicate_sample: 0,
    out_of_order: 0,
    counter_reset: 0,
    invalid_sample: 0,
    invalid_elapsed: 0
  };
  for (const issue of series?.issues ?? []) {
    counts[issue.code] += 1;
  }
  return counts;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
