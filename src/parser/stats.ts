import type { MetricDistribution } from "../contracts/types.js";

export const zeroDistribution: MetricDistribution = {
  avg: 0,
  p50: 0,
  p90: 0,
  p95: 0,
  p99: 0,
  max: 0
};

export function distribution(values: number[]): MetricDistribution {
  const clean = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (clean.length === 0) return { ...zeroDistribution };

  return {
    avg: round(clean.reduce((sum, value) => sum + value, 0) / clean.length),
    p50: round(percentile(clean, 50)),
    p90: round(percentile(clean, 90)),
    p95: round(percentile(clean, 95)),
    p99: round(percentile(clean, 99)),
    max: round(clean[clean.length - 1])
  };
}


export function removeExtremeOutliers(values: number[]): number[] {
  const clean = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (clean.length < 4) return clean;

  const q1 = percentile(clean, 25);
  const q3 = percentile(clean, 75);
  const iqr = q3 - q1;
  if (iqr === 0) return clean;

  const lowerFence = q1 - 3 * iqr;
  const upperFence = q3 + 3 * iqr;
  return clean.filter((value) => value >= lowerFence && value <= upperFence);
}
export function numberFrom(value: string | number | undefined): number {
  if (typeof value === "number") return value;
  if (!value) return 0;
  const parsed = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function percentile(sortedValues: number[], percentileValue: number): number {
  if (sortedValues.length === 1) return sortedValues[0];
  const rank = (percentileValue / 100) * (sortedValues.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const weight = rank - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}