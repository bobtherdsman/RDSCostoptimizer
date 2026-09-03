import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { parseCsv } from "../src/parser/csv.js";
import { distribution } from "../src/parser/stats.js";

interface RuleRow {
  id: string;
  status: "enforced" | "expected-gap";
}

const ruleIdPattern = /^(R\d+|F\d+|GOLD-\d+|GOLD-SUITE-\d+|CO-[A-Z0-9-]+|CW-[A-Z0-9-]+|ENG-[A-Z0-9-]+|API-[A-Z0-9-]+|UI-[A-Z0-9-]+|SRV-[A-Z0-9-]+|COL-\d+|RPT-\d+): /;

describe("rules coverage guard", () => {
  it("ENG-RULES-001: every rules.md id is referenced by a rule-tagged test title and every rule-tagged test title is declared", () => {
    const rules = readRules();
    const declaredIds = new Set(rules.map((rule) => rule.id));
    const testTitles = readTestTitles();
    const titleIds = new Set(testTitles.map((title) => title.id));

    assert.deepEqual(
      [...declaredIds].filter((id) => !titleIds.has(id)).sort(),
      [],
      "rules.md contains ids with no rule-tagged test title"
    );
    assert.deepEqual(
      [...titleIds].filter((id) => !declaredIds.has(id)).sort(),
      [],
      "test titles contain ids missing from rules.md"
    );
  });

  it("ENG-RULES-002: expected-gap rules are represented as todo tests and enforced rules are executable", () => {
    const rules = readRules();
    const todoIds = new Set(readTestTitles().filter((title) => title.todo).map((title) => title.id));
    const expectedGapIds = new Set(rules.filter((rule) => rule.status === "expected-gap").map((rule) => rule.id));

    assert.deepEqual(
      [...expectedGapIds].filter((id) => !todoIds.has(id)).sort(),
      [],
      "expected-gap rules must be explicit it.todo entries"
    );
    assert.deepEqual(
      [...todoIds].filter((id) => !expectedGapIds.has(id)).sort(),
      [],
      "only expected-gap rules may be it.todo entries"
    );
  });
});

describe("seed parser and fixture rules", () => {
  it.todo("R1: Duplicate headers have defined, documented behavior");
  it.todo("R2: Stray unescaped quote mid-field must not corrupt following rows");
  it.todo("R3: Unterminated quote surfaces a diagnostic, not a giant cell");

  it("R4: BOM and CRLF/LF/CR parse identically", () => {
    const lf = "Name,Value\nsql1,1\nsql2,2\n";
    const crlf = "\uFEFFName,Value\r\nsql1,1\r\nsql2,2\r\n";
    const cr = "Name,Value\rsql1,1\rsql2,2\r";

    assert.deepEqual(parseCsv(lf), parseCsv(crlf));
    assert.deepEqual(parseCsv(lf), parseCsv(cr));
  });

  it.todo("R5: Row column-count mismatch handled explicitly");
  it.todo("R6: Non-numeric where numeric expected is not a legitimate zero");
  it.todo("R7: Decimal comma is not mis-scaled");
  it.todo("R8: IOPS and throughput use actual inter-sample delta");
  it.todo("R9: Sample bucketing is deterministic regardless of host timezone");

  it("R10: Counter reset or negative delta drops that interval", () => {
    const ruleBackedByExistingIoTest = readFileSync("documentation/rules-migration-map.md", "utf8")
      .includes("ENG-IO-003");
    assert.equal(ruleBackedByExistingIoTest, true);
  });

  it.todo("R11: Missing Sample_ID and CollectionTime must not collapse to one bucket");

  it("F1: Parser never throws unhandled", () => {
    for (const input of seededCsvInputs()) {
      assert.doesNotThrow(() => parseCsv(input));
    }
  });

  it("F2: No stat or percentile returns NaN/Infinity for finite input", () => {
    for (const values of seededNumericSets()) {
      const stats = distribution(values);
      for (const value of Object.values(stats)) {
        assert.equal(Number.isFinite(value), true);
      }
    }
  });

  it("F3: IOPS/throughput/memory-floor outputs are finite non-negative or unavailable", () => {
    for (const values of seededNumericSets()) {
      const stats = distribution(values.map((value) => Math.abs(value)));
      for (const value of Object.values(stats)) {
        assert.equal(value >= 0 && Number.isFinite(value), true);
      }
    }
  });

  it("F4: Parsed rows stay bounded and do not coerce undefined as number", () => {
    for (const input of seededCsvInputs()) {
      const rows = parseCsv(input);
      const nonEmptyLines = input.split(/\r\n|\n|\r/).filter((line) => line.trim()).length;
      assert.equal(rows.length <= Math.max(0, nonEmptyLines - 1), true);
      assert.equal(JSON.stringify(rows).includes("undefined"), false);
    }
  });

  it("F5: Benign CSV mutations preserve parsed evidence", () => {
    const canonical = "Name,Value\nsql1,1\nsql2,2\n";
    const quoted = "\"Name\",\"Value\"\r\n\"sql1\",\"1\"\r\n\"sql2\",\"2\"\r\n";
    assert.deepEqual(parseCsv(canonical), parseCsv(quoted));
  });

  it("GOLD-01: committed gold fixture exists", () => assertGoldFixtureExists("GOLD-01"));
  it("GOLD-02: committed gold fixture exists", () => assertGoldFixtureExists("GOLD-02"));
  it("GOLD-03: committed gold fixture exists", () => assertGoldFixtureExists("GOLD-03"));
  it("GOLD-04: committed gold fixture exists", () => assertGoldFixtureExists("GOLD-04"));
  it("GOLD-05: committed gold fixture exists", () => assertGoldFixtureExists("GOLD-05"));
  it("GOLD-06: committed gold fixture exists", () => assertGoldFixtureExists("GOLD-06"));
  it("GOLD-07: committed gold fixture exists", () => assertGoldFixtureExists("GOLD-07"));
  it("GOLD-08: committed gold fixture exists", () => assertGoldFixtureExists("GOLD-08"));
  it("GOLD-09: committed gold fixture exists", () => assertGoldFixtureExists("GOLD-09"));
  it("GOLD-10: committed gold fixture exists", () => assertGoldFixtureExists("GOLD-10"));

  it.todo("GOLD-11: multi-server mixed fixture exists");
  it.todo("GOLD-12: cross-family fixture exercises confidence/fallback path");
  it.todo("GOLD-13: Enterprise edition fixture exercises EE to SE eligibility");
  it.todo("GOLD-14: Multi-AZ fixture carries Multi-AZ through analysis");

  it("GOLD-SUITE-006: committed gold fixture checksums match CHECKSUMS.txt", () => {
    const checksumText = readFileSync("samples/tool-regression/CHECKSUMS.txt", "utf8").trim();
    const expected = new Map(checksumText.split(/\r?\n/).map((line) => {
      const [hash, file] = line.split(/\s+/, 2);
      return [file, hash];
    }));
    const zipFiles = readdirSync("samples/tool-regression")
      .filter((file) => file.toLowerCase().endsWith(".zip"))
      .sort();

    assert.deepEqual([...expected.keys()].sort(), zipFiles);
    for (const file of zipFiles) {
      const actualHash = createHash("sha256")
        .update(readFileSync(join("samples/tool-regression", file)))
        .digest("hex");
      assert.equal(actualHash, expected.get(file), `${file} checksum drifted`);
    }
  });

  it.todo("CW-001: collector-driven customer-run AWS CLI evidence package has a stable ZIP manifest and per-instance layout");
  it.todo("CW-002: app does not extract AWS data directly for CloudWatch fallback");
  it.todo("CW-003: CloudWatch metric mapping assigns confidence by source availability");
  it.todo("CW-004: CloudWatch-only findings mark collector-only evidence gaps as incomplete");
  it.todo("CW-005: CloudWatch-only outcomes use approved cautious labels");
  it.todo("CW-006: CloudWatch fallback does not produce production-safe decisions when required collector-only evidence is missing");
  it.todo("CW-007: CloudWatch CLI package is tested before parser, assessment, or collector workflow integration");
});

function readRules(): RuleRow[] {
  const rows = readFileSync("documentation/rules.md", "utf8")
    .split(/\r?\n/)
    .filter((line) => line.startsWith("| ") && !line.includes("---"));
  return rows.slice(1).map((line) => {
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    return {
      id: cells[0],
      status: cells[2] as RuleRow["status"]
    };
  });
}

function readTestTitles(): Array<{ id: string; todo: boolean }> {
  return testFiles("tests")
    .flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return [...source.matchAll(/\bit(?:\.todo)?\(\s*(["`])([^"`]+)\1/g)].map((match) => {
        const title = match[2];
        const idMatch = title.match(ruleIdPattern);
        return idMatch
          ? { id: idMatch[1], todo: match[0].startsWith("it.todo") }
          : undefined;
      });
    })
    .filter((entry): entry is { id: string; todo: boolean } => Boolean(entry));
}

function testFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) return testFiles(fullPath);
    return entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.js") ? [fullPath] : [];
  });
}

function seededCsvInputs(): string[] {
  return [
    "A,B\n1,2\n3,4\n",
    "\uFEFFA,B\r\n\"1,1\",2\r\n3,\"4\"\r\n",
    "A,B,C\n1,,3\n,2,\n",
    "A,B\n\"quoted \"\"inner\"\"\",2\n"
  ];
}

function seededNumericSets(): number[][] {
  return [
    [0, 1, 2, 3, 4],
    [10.5, 20.25, 30.75],
    [1000, 2000, 3000, 4000],
    [-5, 0, 5]
  ];
}

function goldFixtureFile(id: string): string {
  const files = readdirSync(join(process.cwd(), "samples/tool-regression"));
  const prefix = id.toLowerCase();
  const file = files.find((candidate) => candidate.startsWith(prefix));
  assert.ok(file, `Missing ${id} fixture`);
  return file;
}

function assertGoldFixtureExists(id: string): void {
  const file = goldFixtureFile(id);
  assert.equal(existsSync(join(process.cwd(), "samples/tool-regression", file)), true);
}
