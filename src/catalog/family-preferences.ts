import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type CandidateFamilyPreferenceRole = "lead" | "fallback" | "standard" | "avoid" | "deprecated";

export interface CandidateFamilyPreference {
  family: string;
  role: CandidateFamilyPreferenceRole;
  rank: number;
  reason?: string;
}

export interface CandidateFamilyPreferenceConfig {
  version: number;
  description?: string;
  families: CandidateFamilyPreference[];
}

export interface CandidateFamilyPreferenceFields {
  familyPreferenceRole?: CandidateFamilyPreferenceRole;
  familyPreferenceRank?: number;
  familyPreferenceSource?: "catalog" | "catalog-adjacent-config" | "default";
}

export const DEFAULT_FAMILY_PREFERENCE_RANK = 2;

let cachedConfig: CandidateFamilyPreferenceConfig | undefined;

export function loadCandidateFamilyPreferenceConfig(): CandidateFamilyPreferenceConfig {
  if (cachedConfig) return cachedConfig;
  const source = familyPreferenceConfigPaths().find((candidate) => existsSync(candidate));
  if (!source) {
    cachedConfig = { version: 1, families: [] };
    return cachedConfig;
  }
  const parsed = JSON.parse(readFileSync(source, "utf8")) as CandidateFamilyPreferenceConfig;
  cachedConfig = {
    version: parsed.version,
    description: parsed.description,
    families: parsed.families.map((entry) => ({
      family: entry.family.trim().toLowerCase(),
      role: entry.role,
      rank: entry.rank,
      reason: entry.reason
    }))
  };
  return cachedConfig;
}

export function familyPreferenceForFamily(
  family: string,
  config: CandidateFamilyPreferenceConfig = loadCandidateFamilyPreferenceConfig()
): CandidateFamilyPreference {
  const normalized = family.trim().toLowerCase();
  const configured = config.families.find((entry) => entry.family === normalized);
  return configured ?? {
    family: normalized || "unknown",
    role: "standard",
    rank: DEFAULT_FAMILY_PREFERENCE_RANK
  };
}

export function familyPreferenceFieldsForFamily(
  family: string,
  config: CandidateFamilyPreferenceConfig = loadCandidateFamilyPreferenceConfig()
): Required<CandidateFamilyPreferenceFields> {
  const preference = familyPreferenceForFamily(family, config);
  return {
    familyPreferenceRole: preference.role,
    familyPreferenceRank: preference.rank,
    familyPreferenceSource: config.families.some((entry) => entry.family === preference.family)
      ? "catalog-adjacent-config"
      : "default"
  };
}

export function familyPreferenceForEntry(
  entry: { family: string } & CandidateFamilyPreferenceFields,
  config: CandidateFamilyPreferenceConfig = loadCandidateFamilyPreferenceConfig()
): CandidateFamilyPreference {
  if (entry.familyPreferenceRole && entry.familyPreferenceRank !== undefined) {
    return {
      family: entry.family,
      role: entry.familyPreferenceRole,
      rank: entry.familyPreferenceRank
    };
  }
  return familyPreferenceForFamily(entry.family, config);
}

export function familyPreferenceRankForEntry(
  entry: { family: string } & CandidateFamilyPreferenceFields,
  config?: CandidateFamilyPreferenceConfig
): number {
  return familyPreferenceForEntry(entry, config).rank;
}

export function familyPreferenceRoleForEntry(
  entry: { family: string } & CandidateFamilyPreferenceFields,
  config?: CandidateFamilyPreferenceConfig
): CandidateFamilyPreferenceRole {
  return familyPreferenceForEntry(entry, config).role;
}

function familyPreferenceConfigPaths(): string[] {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  return [
    join(process.cwd(), "src/catalog/data/family-preferences.json"),
    join(process.cwd(), "dist/catalog/data/family-preferences.json"),
    join(__dirname, "data/family-preferences.json")
  ];
}
