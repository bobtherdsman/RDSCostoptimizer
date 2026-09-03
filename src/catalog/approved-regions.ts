import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadApprovedCatalogRegions(path = "src/catalog/data/approved-regions.json"): string[] {
  const source = resolve(process.cwd(), path);
  const parsed = JSON.parse(readFileSync(source, "utf8")) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`Approved catalog Region list must be a JSON array: ${source}`);
  }

  const regions = parsed
    .map((value) => {
      if (typeof value !== "string") {
        throw new Error(`Approved catalog Region values must be strings: ${source}`);
      }
      return value.trim();
    })
    .filter(Boolean);

  const uniqueRegions = [...new Set(regions)];
  if (uniqueRegions.length === 0) {
    throw new Error(`Approved catalog Region list is empty: ${source}`);
  }
  return uniqueRegions;
}
