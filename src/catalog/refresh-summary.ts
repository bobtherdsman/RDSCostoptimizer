import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { InstanceCatalogEntry, OptimizeCpuConfiguration } from "./index.js";

export interface CatalogRefreshChangedEntry {
  key: string;
  instanceClass: string;
  region?: string;
  engine?: string;
  engineVersion?: string;
  fields: string[];
}

export interface CatalogRefreshSummary {
  beforeCount: number;
  afterCount: number;
  delta: number;
  newFamilies: string[];
  removedFamilies: string[];
  newClasses: string[];
  removedClasses: string[];
  changedEntries: CatalogRefreshChangedEntry[];
}

const COMPARED_FIELDS: Array<keyof InstanceCatalogEntry> = [
  "vcpu",
  "sqlServerDefaultVcpu",
  "defaultCpuCores",
  "defaultThreadsPerCore",
  "optimizeCpuConfigurations",
  "memoryGb",
  "baselineIops",
  "maxIops",
  "baselineThroughputMbps",
  "maxThroughputMbps",
  "localInstanceStorage"
];

export function summarizeCatalogRefresh(
  before: readonly InstanceCatalogEntry[],
  after: readonly InstanceCatalogEntry[]
): CatalogRefreshSummary {
  const beforeClasses = classSet(before);
  const afterClasses = classSet(after);
  const beforeFamilies = familySet(before);
  const afterFamilies = familySet(after);
  const beforeByKey = new Map(before.map((entry) => [catalogEntryKey(entry), entry]));
  const afterByKey = new Map(after.map((entry) => [catalogEntryKey(entry), entry]));

  const changedEntries: CatalogRefreshChangedEntry[] = [];
  for (const [key, afterEntry] of [...afterByKey.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const beforeEntry = beforeByKey.get(key);
    if (!beforeEntry) continue;
    const fields = COMPARED_FIELDS.filter((field) => !sameCatalogValue(beforeEntry[field], afterEntry[field]))
      .map((field) => String(field));
    if (fields.length > 0) {
      changedEntries.push({
        key,
        instanceClass: afterEntry.instanceClass,
        region: afterEntry.region,
        engine: afterEntry.engine,
        engineVersion: afterEntry.engineVersion,
        fields
      });
    }
  }

  return {
    beforeCount: before.length,
    afterCount: after.length,
    delta: after.length - before.length,
    newFamilies: difference(afterFamilies, beforeFamilies),
    removedFamilies: difference(beforeFamilies, afterFamilies),
    newClasses: difference(afterClasses, beforeClasses),
    removedClasses: difference(beforeClasses, afterClasses),
    changedEntries
  };
}

export function catalogRefreshSummaryMarkdown(summary: CatalogRefreshSummary): string {
  const lines = [
    "# Catalog Refresh Summary",
    "",
    `- Entries before: ${summary.beforeCount}`,
    `- Entries after: ${summary.afterCount}`,
    `- Entry delta: ${formatDelta(summary.delta)}`,
    `- New families: ${formatList(summary.newFamilies)}`,
    `- Removed families: ${formatList(summary.removedFamilies)}`,
    `- New classes: ${formatList(summary.newClasses)}`,
    `- Removed/no-longer-orderable classes: ${formatList(summary.removedClasses)}`,
    `- Rows with changed capability facts: ${summary.changedEntries.length}`,
    ""
  ];

  if (summary.changedEntries.length > 0) {
    lines.push("| Instance class | Region | Engine | Engine version | Changed fields |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const entry of summary.changedEntries) {
      lines.push([
        entry.instanceClass,
        entry.region ?? "",
        entry.engine ?? "",
        entry.engineVersion ?? "",
        entry.fields.join(", ")
      ].join(" | ").replace(/^/, "| ").replace(/$/, " |"));
    }
    lines.push("");
  }

  lines.push(
    "Human review is required before refreshed catalog data can affect production optimization outcomes."
  );
  return `${lines.join("\n")}\n`;
}

export function readCatalog(path: string): InstanceCatalogEntry[] {
  return JSON.parse(readFileSync(path, "utf8")) as InstanceCatalogEntry[];
}

function catalogEntryKey(entry: InstanceCatalogEntry): string {
  return [
    entry.region ?? "",
    entry.instanceClass,
    entry.engine ?? "",
    entry.engineVersion ?? "",
    entry.licenseModel ?? "",
    entry.multiAzCapable === undefined ? "" : String(entry.multiAzCapable)
  ].join("|");
}

function classSet(entries: readonly InstanceCatalogEntry[]): string[] {
  return [...new Set(entries.map((entry) => entry.instanceClass))].sort();
}

function familySet(entries: readonly InstanceCatalogEntry[]): string[] {
  return [...new Set(entries.map((entry) => entry.family))].sort();
}

function difference(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((value) => !rightSet.has(value)).sort();
}

function sameCatalogValue(left: unknown, right: unknown): boolean {
  return stableStringify(normalizeCatalogValue(left)) === stableStringify(normalizeCatalogValue(right));
}

function normalizeCatalogValue(value: unknown): unknown {
  if (Array.isArray(value) && value.every(isOptimizeCpuConfiguration)) {
    return [...value].sort((left, right) =>
      left.coreCount - right.coreCount
      || left.threadsPerCore - right.threadsPerCore
      || left.sqlServerVisibleVcpu - right.sqlServerVisibleVcpu
      || Number(left.isDefault) - Number(right.isDefault)
    );
  }
  return value;
}

function isOptimizeCpuConfiguration(value: unknown): value is OptimizeCpuConfiguration {
  return Boolean(
    value
    && typeof value === "object"
    && "coreCount" in value
    && "threadsPerCore" in value
    && "sqlServerVisibleVcpu" in value
  );
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

function formatDelta(delta: number): string {
  return delta > 0 ? `+${delta}` : String(delta);
}

function formatList(values: readonly string[]): string {
  return values.length > 0 ? values.join(", ") : "None";
}

function cliArguments(argv: string[]): { before: string; after: string; output?: string } {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) {
      throw new Error(`Invalid catalog summary argument near ${key ?? "<end>"}.`);
    }
    values.set(key, value);
  }
  const before = values.get("--before");
  const after = values.get("--after");
  if (!before || !after) {
    throw new Error("Usage: node dist/catalog/refresh-summary.js --before <old.json> --after <new.json> [--output <summary.md>]");
  }
  return {
    before: resolve(process.cwd(), before),
    after: resolve(process.cwd(), after),
    output: values.get("--output") ? resolve(process.cwd(), values.get("--output")!) : undefined
  };
}

if (process.argv[1] && process.argv[1].endsWith("refresh-summary.js")) {
  const args = cliArguments(process.argv.slice(2));
  for (const path of [args.before, args.after]) {
    if (!existsSync(path)) throw new Error(`Catalog summary input not found: ${path}`);
  }
  const markdown = catalogRefreshSummaryMarkdown(summarizeCatalogRefresh(readCatalog(args.before), readCatalog(args.after)));
  if (args.output) {
    mkdirSync(dirname(args.output), { recursive: true });
    writeFileSync(args.output, markdown, "utf8");
  }
  process.stdout.write(markdown);
}
