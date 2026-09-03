import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  instanceCatalogFromOrderableOptions,
  SQL_SERVER_ENGINES,
  type ConsolidatedInstanceCatalogRow,
  type LocalInstanceStorageSource,
  type RdsOrderableDbInstanceOption
} from "./index.js";
import { loadApprovedCatalogRegions } from "./approved-regions.js";

interface RefreshArguments {
  regions: string[];
  hardwarePath: string;
  localStoragePath: string;
  outputPath: string;
}

export function refreshRdsSqlServerCatalog(args: RefreshArguments): number {
  const hardwareRows = JSON.parse(readFileSync(args.hardwarePath, "utf8")) as ConsolidatedInstanceCatalogRow[];
  const localStorage = JSON.parse(readFileSync(args.localStoragePath, "utf8")) as LocalInstanceStorageSource;
  const refreshedAt = new Date().toISOString();
  const catalog = args.regions.flatMap((region) => {
    const options = SQL_SERVER_ENGINES.flatMap((engine) => describeOrderableOptions(region, engine));
    return instanceCatalogFromOrderableOptions(options, hardwareRows, region, refreshedAt, localStorage);
  });

  if (catalog.length === 0) {
    throw new Error("RDS returned no SQL Server catalog entries with matching standalone hardware capability data.");
  }

  mkdirSync(dirname(args.outputPath), { recursive: true });
  const outputCatalog = existsSync(args.outputPath)
    ? preserveUnchangedCatalogTimestamps(catalog, JSON.parse(readFileSync(args.outputPath, "utf8")) as ReturnType<typeof instanceCatalogFromOrderableOptions>)
    : catalog;
  writeFileSync(args.outputPath, `${JSON.stringify(outputCatalog, null, 2)}\n`, "utf8");
  return catalog.length;
}

function describeOrderableOptions(region: string, engine: string): RdsOrderableDbInstanceOption[] {
  const output = execFileSync("aws", [
    "rds",
    "describe-orderable-db-instance-options",
    "--engine",
    engine,
    "--region",
    region,
    "--output",
    "json",
    "--no-cli-pager"
  ], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024
  });
  const parsed = JSON.parse(output) as { OrderableDBInstanceOptions?: RdsOrderableDbInstanceOption[] };
  return parsed.OrderableDBInstanceOptions ?? [];
}

function argumentsFromProcess(argv: string[]): RefreshArguments {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) {
      throw new Error(`Invalid catalog refresh argument near ${key ?? "<end>"}.`);
    }
    values.set(key, value);
  }

  const root = resolve(process.cwd());
  const regionsFile = values.get("--regions-file");
  const regions = regionsFile
    ? loadApprovedCatalogRegions(regionsFile)
    : (values.get("--regions") ?? process.env.AWS_REGION ?? "us-east-1")
      .split(",")
      .map((region) => region.trim())
      .filter(Boolean);
  const hardwarePath = resolve(root, values.get("--hardware") ?? "src/catalog/data/aws-instances-consolidated.json");
  const localStoragePath = resolve(root, values.get("--local-storage") ?? "src/catalog/data/sqlserver-local-instance-storage.json");
  const outputPath = resolve(root, values.get("--output") ?? "src/catalog/data/rds-sqlserver-orderable.json");

  for (const path of [hardwarePath, localStoragePath]) {
    if (!existsSync(path)) throw new Error(`Catalog refresh input not found: ${path}`);
  }

  return { regions, hardwarePath, localStoragePath, outputPath };
}

function preserveUnchangedCatalogTimestamps(
  refreshedCatalog: ReturnType<typeof instanceCatalogFromOrderableOptions>,
  existingCatalog: ReturnType<typeof instanceCatalogFromOrderableOptions>
): ReturnType<typeof instanceCatalogFromOrderableOptions> {
  const existingByKey = new Map(existingCatalog.map((entry) => [catalogEntryIdentity(entry), entry]));
  return refreshedCatalog.map((entry) => {
    const existing = existingByKey.get(catalogEntryIdentity(entry));
    if (!existing || !catalogEntriesMatchIgnoringRefreshTime(entry, existing)) return entry;
    return {
      ...entry,
      catalogRefreshedAt: existing.catalogRefreshedAt
    };
  });
}

function catalogEntriesMatchIgnoringRefreshTime(
  left: ReturnType<typeof instanceCatalogFromOrderableOptions>[number],
  right: ReturnType<typeof instanceCatalogFromOrderableOptions>[number]
): boolean {
  const { catalogRefreshedAt: _leftRefreshedAt, ...leftComparable } = left;
  const { catalogRefreshedAt: _rightRefreshedAt, ...rightComparable } = right;
  return stableStringify(leftComparable) === stableStringify(rightComparable);
}

function catalogEntryIdentity(entry: ReturnType<typeof instanceCatalogFromOrderableOptions>[number]): string {
  return [
    entry.region ?? "",
    entry.instanceClass,
    entry.engine ?? "",
    entry.engineVersion ?? "",
    entry.licenseModel ?? "",
    entry.multiAzCapable === undefined ? "" : String(entry.multiAzCapable)
  ].join("|");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

if (process.argv[1] && process.argv[1].endsWith("refresh.js")) {
  const args = argumentsFromProcess(process.argv.slice(2));
  const count = refreshRdsSqlServerCatalog(args);
  console.log(`Wrote ${count} exact RDS for SQL Server catalog entries to ${args.outputPath}.`);
}
