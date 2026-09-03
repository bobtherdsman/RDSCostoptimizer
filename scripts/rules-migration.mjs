import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const files = [
  "tests/access.test.ts",
  "tests/api.test.ts",
  "tests/catalog-refresh-summary.test.ts",
  "tests/catalog.test.ts",
  "tests/collector.test.js",
  "tests/cost-harness.test.ts",
  "tests/edition.test.ts",
  "tests/evidence-window.test.ts",
  "tests/harness/fixtures.test.js",
  "tests/io.test.ts",
  "tests/memory.test.ts",
  "tests/optimizer.test.ts",
  "tests/parser.test.ts",
  "tests/reports.test.ts",
  "tests/samples-regression.test.ts",
  "tests/server.test.ts",
  "tests/ui-html.test.ts",
  "tests/ui.test.ts",
  "tests/upload.test.ts",
  "tests/workload.test.ts"
];

const config = {
  "tests/access.test.ts": ["SRV-ACCESS", "access"],
  "tests/api.test.ts": ["API-API", "api"],
  "tests/upload.test.ts": ["API-UPLOAD", "api"],
  "tests/catalog-refresh-summary.test.ts": ["ENG-CATALOG-REFRESH", "catalog"],
  "tests/catalog.test.ts": ["ENG-CATALOG", "catalog"],
  "tests/collector.test.js": ["COL", "collector"],
  "tests/cost-harness.test.ts": ["CO-ADV", "harness"],
  "tests/edition.test.ts": ["ENG-EDITION", "edition"],
  "tests/evidence-window.test.ts": ["ENG-EVIDENCE", "evidence-window"],
  "tests/harness/fixtures.test.js": ["CO-FIX", "fixtures"],
  "tests/io.test.ts": ["ENG-IO", "io"],
  "tests/memory.test.ts": ["ENG-MEMORY", "memory"],
  "tests/optimizer.test.ts": ["ENG-OPTIMIZER", "optimizer"],
  "tests/parser.test.ts": ["R", "parser", 12],
  "tests/reports.test.ts": ["RPT", "reports"],
  "tests/samples-regression.test.ts": ["GOLD-SUITE", "fixtures"],
  "tests/server.test.ts": ["SRV-SERVER", "server"],
  "tests/ui-html.test.ts": ["UI-HTML", "ui"],
  "tests/ui.test.ts": ["UI-VIEW", "ui"],
  "tests/workload.test.ts": ["ENG-WORKLOAD", "workload"]
};

const existingPrefixPattern = /^(R\d+|F\d+|GOLD-\d+|GOLD-SUITE-\d+|CO-[A-Z0-9-]+|ENG-[A-Z0-9-]+|API-[A-Z0-9-]+|UI-[A-Z0-9-]+|SRV-[A-Z0-9-]+|COL-\d+|RPT-\d+): /;
const rows = [];

for (const file of files) {
  let text = readFileSync(file, "utf8");
  const [prefix, area, start = 1] = config[file];
  let index = start;
  text = text.replace(/\bit\(\s*(["`])([^"`]*?)\1/g, (match, quote, title) => {
    if (existingPrefixPattern.test(title)) return match;
    const id = prefix === "R" ? `R${index++}` : `${prefix}-${String(index++).padStart(3, "0")}`;
    rows.push({ id, area, file, title: clean(title) });
    return `it(${quote}${id}: ${title}${quote}`;
  });
  writeFileSync(file, text, "utf8");
}

mkdirSync("documentation", { recursive: true });

const seedRules = [
  ["R1", "parser", "expected-gap", "Duplicate headers have defined, documented behavior", "two columns with same name", "documented duplicate-header handling, not silent surprise", "csv.ts:13"],
  ["R2", "parser", "expected-gap", "Stray unescaped quote mid-field must not corrupt following rows", "a,b\"c,d\\n1,2,3", "structured diagnostic or isolated affected field", "csv.ts:34"],
  ["R3", "parser", "expected-gap", "Unterminated quote surfaces a diagnostic, not a giant cell", "field opens quote and never closes", "structured error or flagged row", "csv.ts parseCsvRows"],
  ["R4", "parser", "enforced", "BOM and CRLF/LF/CR parse identically", "same data in line-ending variants", "identical parsed rows", "parser.test.ts"],
  ["R5", "parser", "expected-gap", "Row column-count mismatch handled explicitly", "rows with extra or fewer columns", "documented explicit mismatch handling", "csv.ts:13"],
  ["R6", "parser", "expected-gap", "Non-numeric where numeric expected is not a legitimate zero", "abc in numeric metric cell", "rejected or marked missing, not silently zero", "stats.ts:44"],
  ["R7", "parser", "expected-gap", "Decimal comma is not mis-scaled", "\"1,5\"", "not parsed as 15", "stats.ts:43"],
  ["R8", "parser", "expected-gap", "IOPS and throughput use actual inter-sample delta", "samples at 30s cadence", "rates use real elapsed seconds", "index.ts:253,274"],
  ["R9", "parser", "expected-gap", "Sample bucketing is deterministic regardless of host timezone", "bare timestamps under UTC and New York", "identical alignment/results", "synchronized-samples.ts:532"],
  ["R10", "parser", "enforced", "Counter reset or negative delta drops that interval", "descending cumulative counter", "interval dropped, not negative rate", "io.test.ts"],
  ["R11", "parser", "expected-gap", "Missing Sample_ID and CollectionTime must not collapse to one bucket", "IO rows lacking both keys", "not a single single-bucket distribution", "index.ts:278"],
  ["F1", "parser", "enforced", "Parser never throws unhandled", "seeded randomized CSV", "returns rows or structured result", "fuzz"],
  ["F2", "parser", "enforced", "No stat or percentile returns NaN/Infinity for finite input", "seeded randomized numeric sets", "always finite", "fuzz"],
  ["F3", "parser", "enforced", "IOPS/throughput/memory-floor outputs are finite non-negative or unavailable", "seeded randomized samples", "never negative or NaN silently", "fuzz"],
  ["F4", "parser", "enforced", "Parsed rows stay bounded and do not coerce undefined as number", "seeded randomized CSV", "bounded rows and no silent undefined number", "fuzz"],
  ["F5", "parser", "enforced", "Benign CSV mutations preserve parsed evidence", "valid fixture plus whitespace/quote/CRLF mutations", "same parsed evidence", "fuzz"]
];

const goldRules = [
  ["GOLD-01", "fixtures", "enforced", "safe downsize fixture outcome", "gold-01-safe-downsize.zip", "status=recommended and selected db.r8i.8xlarge", "samples-regression.test.ts"],
  ["GOLD-02", "fixtures", "enforced", "memory pressure blocks fixture outcome", "gold-02-memory-blocked.zip", "blocker MEMORY_PRESSURE_DETECTED", "samples-regression.test.ts"],
  ["GOLD-03", "fixtures", "enforced", "IOPS blocks fixture outcome", "gold-03-iops-blocked.zip", "blocker IOPS_P95_EFFECTIVE_CAPABILITY_EXCEEDED", "samples-regression.test.ts"],
  ["GOLD-04", "fixtures", "enforced", "throughput blocks fixture outcome", "gold-04-throughput-blocked.zip", "blocker THROUGHPUT_P95_EFFECTIVE_CAPABILITY_EXCEEDED", "samples-regression.test.ts"],
  ["GOLD-05", "fixtures", "enforced", "CPU blocks fixture outcome", "gold-05-cpu-blocked.zip", "blocker CPU_P95_TARGET_EXCEEDED", "samples-regression.test.ts"],
  ["GOLD-06", "fixtures", "enforced", "short collection blocks fixture outcome", "gold-06-short-collection.zip", "blocker COLLECTION_WINDOW_TOO_SHORT", "samples-regression.test.ts"],
  ["GOLD-07", "fixtures", "enforced", "SQL version not orderable blocks fixture outcome", "gold-07-sql-version-blocked.zip", "blocker SQL_VERSION_NOT_ORDERABLE", "samples-regression.test.ts"],
  ["GOLD-08", "fixtures", "enforced", "edition not supported blocks fixture outcome", "gold-08-edition-blocked.zip", "blocker EDITION_NOT_SUPPORTED", "samples-regression.test.ts"],
  ["GOLD-09", "fixtures", "enforced", "catalog gap and storage capability unknown fixture outcome", "gold-09-catalog-gap-fallback.zip", "blocker IOPS_STORAGE_CAPABILITY_UNKNOWN", "samples-regression.test.ts"],
  ["GOLD-10", "fixtures", "enforced", "tempdb-dominant fixture still optimizes", "gold-10-tempdb-dominant.zip", "status=recommended and selected db.r8i.8xlarge", "samples-regression.test.ts"],
  ["GOLD-11", "fixtures", "expected-gap", "multi-server mixed fixture exists", "NEW multi-server-mixed.zip", "per-server outcomes and fleet counts", "pending fixture creation"],
  ["GOLD-12", "fixtures", "expected-gap", "cross-family fixture exercises confidence/fallback path", "NEW cross-family.zip", "low-confidence/aggressive flag and fallback justification", "pending fixture creation"],
  ["GOLD-13", "fixtures", "expected-gap", "Enterprise edition fixture exercises EE to SE eligibility", "NEW enterprise-edition.zip", "edition-change decision correct", "pending fixture creation"],
  ["GOLD-14", "fixtures", "expected-gap", "Multi-AZ fixture carries Multi-AZ through analysis", "NEW multi-az.zip", "Multi-AZ in result and sizing unaffected", "pending fixture creation"]
];

const migratedRules = rows.map((row) => [
  row.id,
  row.area,
  "enforced",
  row.title,
  "unit or fixture from existing test",
  `Existing assertion remains enforced: ${row.title}`,
  row.file
]);

const allRules = [...seedRules, ...goldRules, ...migratedRules];
writeFileSync("documentation/rules.md", [
  "# Rules",
  "",
  "| id | area | status | invariant | input/fixture | expected | pins |",
  "| --- | --- | --- | --- | --- | --- | --- |",
  ...allRules.map((row) => `| ${row.map(markdownCell).join(" | ")} |`),
  ""
].join("\n"), "utf8");

writeFileSync("documentation/rules-migration-map.md", [
  "# Rules Migration Map",
  "",
  "Every row maps one existing test case to the rule id now prefixed in that test title. Seed parser/fuzz and future GOLD expected-gap rules live in `documentation/rules.md` and are referenced by the rules guard tests.",
  "",
  "| old test file | rule id | old test behavior |",
  "| --- | --- | --- |",
  ...rows.map((row) => `| ${markdownCell(row.file)} | ${row.id} | ${markdownCell(row.title)} |`),
  ""
].join("\n"), "utf8");

console.log(`Prefixed ${rows.length} tests and wrote documentation/rules.md plus documentation/rules-migration-map.md.`);

function clean(value) {
  return String(value).replace(/\r?\n/g, " ").trim();
}

function markdownCell(value) {
  return clean(value).replace(/\|/g, "\\|");
}
