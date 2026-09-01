import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  candidateAvailabilityFailures,
  catalogForRegion,
  catalogForSqlServerConfiguration,
  findCheapestValidByCatalogOrder,
  instanceCatalogFromConsolidatedRows,
  instanceCatalogFromOrderableOptions,
  isOrderableProcessorConfiguration,
  isOrderableCandidate,
  parseSqlMajorVersion,
  sqlProductVersionMatches,
  type InstanceCatalogEntry
} from "../src/catalog/index.js";

const catalog: InstanceCatalogEntry[] = [
  {
    instanceClass: "db.m8i.4xlarge",
    region: "us-east-1",
    family: "m8i",
    size: "4xlarge",
    vcpu: 16,
    sqlServerDefaultVcpuSource: "aws-processor-features",
    memoryGb: 64,
    maxIops: 50000,
    maxThroughputMbps: 1250,
    supportedEditions: ["Enterprise", "Standard", "Web"],
    minSqlMajorVersion: 14,
    engine: "sqlserver-se",
    engineVersion: "16.00.4215.2.v1",
    sqlServerEdition: "Standard",
    orderable: true
  },
  {
    instanceClass: "db.r8i.4xlarge",
    region: "us-east-1",
    family: "r8i",
    size: "4xlarge",
    vcpu: 16,
    sqlServerDefaultVcpuSource: "aws-processor-features",
    memoryGb: 128,
    maxIops: 50000,
    maxThroughputMbps: 1250,
    supportedEditions: ["Enterprise", "Standard"],
    minSqlMajorVersion: 14,
    engine: "sqlserver-se",
    engineVersion: "16.00.4215.2.v1",
    sqlServerEdition: "Standard",
    orderable: true
  },
  {
    instanceClass: "db.x2m.16xlarge",
    region: "us-east-1",
    family: "x2m",
    size: "16xlarge",
    vcpu: 64,
    sqlServerDefaultVcpuSource: "aws-processor-features",
    defaultCpuCores: 32,
    defaultThreadsPerCore: 2,
    memoryGb: 2048,
    maxIops: 130000,
    maxThroughputMbps: 5000,
    supportedEditions: ["Enterprise"],
    minSqlMajorVersion: 14,
    engine: "sqlserver-ee",
    engineVersion: "16.00.4215.2.v1",
    sqlServerEdition: "Enterprise",
    orderable: true
  },
  {
    instanceClass: "db.x2iedn.8xlarge",
    region: "us-east-1",
    family: "x2iedn",
    size: "8xlarge",
    vcpu: 32,
    sqlServerDefaultVcpuSource: "aws-processor-features",
    memoryGb: 1024,
    maxIops: 65000,
    maxThroughputMbps: 2500,
    supportedEditions: ["Enterprise", "Standard"],
    minSqlMajorVersion: 15,
    engine: "sqlserver-se",
    engineVersion: "16.00.4215.2.v1",
    sqlServerEdition: "Standard",
    orderable: true
  }
];

const standardSql2022 = {
  region: "us-east-1",
  sqlServerEdition: "Standard" as const,
  sqlServerVersion: "16.00.4215.2"
};

describe("catalog/orderability validation", () => {
  it("parses SQL Server major versions", () => {
    assert.equal(parseSqlMajorVersion("16.00.4215.2"), 16);
    assert.equal(parseSqlMajorVersion("14"), 14);
    assert.equal(parseSqlMajorVersion("bad"), 0);
    assert.equal(sqlProductVersionMatches("16.00.4215.2", "16.00.4215.2.v1"), true);
    assert.equal(sqlProductVersionMatches("16.00.4215.2", "16.00.4215.3.v1"), false);
  });

  it("accepts a candidate that fits edition, version, memory, IOPS, and throughput", () => {
    const result = isOrderableCandidate(catalog, standardSql2022, "db.r8i.4xlarge", {
      memoryGb: 96,
      iops: 30000,
      throughputMbps: 900
    });

    assert.equal(result.valid, true);
    assert.deepEqual(result.failures, []);
    assert.equal(result.entry?.instanceClass, "db.r8i.4xlarge");
  });

  it("rejects memory underfit", () => {
    const result = isOrderableCandidate(catalog, standardSql2022, "db.m8i.4xlarge", {
      memoryGb: 96,
      iops: 30000,
      throughputMbps: 900
    });

    assert.equal(result.valid, false);
    assert.ok(result.failures.some((failure) => failure.startsWith("MEMORY_UNDERFIT")));
  });

  it("rejects IOPS and throughput underfit", () => {
    const result = isOrderableCandidate(catalog, standardSql2022, "db.r8i.4xlarge", {
      memoryGb: 96,
      iops: 70000,
      throughputMbps: 2000
    });

    assert.equal(result.valid, false);
    assert.ok(result.failures.some((failure) => failure.startsWith("IOPS_UNDERFIT")));
    assert.ok(result.failures.some((failure) => failure.startsWith("THROUGHPUT_UNDERFIT")));
  });

  it("rejects unsupported SQL version", () => {
    const result = isOrderableCandidate(catalog, { region: "us-east-1", sqlServerEdition: "Standard", sqlServerVersion: "14.00.3465.1" }, "db.x2iedn.8xlarge", {
      memoryGb: 512,
      iops: 40000,
      throughputMbps: 1200
    });

    assert.equal(result.valid, false);
    assert.ok(result.failures.some((failure) => failure.startsWith("SQL_VERSION_NOT_ORDERABLE")));
  });

  it("rejects unsupported edition and version-specific Standard core limit", () => {
    const result = isOrderableCandidate(catalog, standardSql2022, "db.x2m.16xlarge", {
      memoryGb: 512,
      iops: 40000,
      throughputMbps: 1200
    });

    assert.equal(result.valid, false);
    assert.ok(result.failures.some((failure) => failure.startsWith("EDITION_NOT_SUPPORTED")));
    assert.ok(result.failures.some((failure) => failure.startsWith("EDITION_CORE_LIMIT_EXCEEDED")));
  });

  it("explains why exact lower-vCPU candidate generation produced no candidates", () => {
    const failures = candidateAvailabilityFailures(catalog, {
      region: "us-east-1",
      sqlServerEdition: "Express",
      sqlServerVersion: "16.00"
    }, 64);

    assert.deepEqual(failures, [
      "EDITION_NOT_SUPPORTED: no lower-vCPU SQL Server candidate supports Express"
    ]);
  });

  it("returns the first valid candidate in catalog order supplied by caller", () => {
    const result = findCheapestValidByCatalogOrder(catalog, standardSql2022, ["db.m8i.4xlarge", "db.r8i.4xlarge"], {
      memoryGb: 96,
      iops: 30000,
      throughputMbps: 900
    });

    assert.equal(result.valid, true);
    assert.equal(result.entry?.instanceClass, "db.r8i.4xlarge");
  });

  it("rejects generic catalog rows that are not exact AWS SQL Server orderability evidence", () => {
    const result = isOrderableCandidate([{
      ...catalog[1],
      region: undefined,
      engine: undefined,
      engineVersion: undefined,
      sqlServerEdition: undefined,
      orderable: undefined
    }], standardSql2022, "db.r8i.4xlarge", {
      memoryGb: 96,
      iops: 30000,
      throughputMbps: 900
    });

    assert.equal(result.valid, false);
    assert.ok(result.failures.some((failure) => failure.startsWith("EXACT_ORDERABILITY_METADATA_REQUIRED")));
  });

  it("maps copied consolidated catalog rows into regional orderability entries", () => {
    const mapped = instanceCatalogFromConsolidatedRows([
      {
        instanceType: "db.r8i.4xlarge",
        region: "us-east-1",
        vcpu: 16,
        memory: 128,
        sqlServerEdition: "Standard",
        engineCode: "15",
        maximumIops: 50000,
        maximumThroughputMBps: 1250
      },
      {
        instanceType: "db.r8i.4xlarge",
        region: "us-east-1",
        vcpu: 16,
        memory: 128,
        sqlServerEdition: "Enterprise",
        engineCode: "14",
        maximumIops: 60000,
        maximumThroughputMBps: 1500
      },
      {
        instanceType: "db.r8i.4xlarge",
        region: "eu-west-1",
        vcpu: 16,
        memory: 128,
        sqlServerEdition: "Standard",
        engineCode: "15",
        maximumIops: 45000,
        maximumThroughputMBps: 1000
      }
    ]);

    const usEast = mapped.find((entry) => entry.region === "us-east-1");
    assert.equal(mapped.length, 2);
    assert.equal(usEast?.instanceClass, "db.r8i.4xlarge");
    assert.equal(usEast?.family, "r8i");
    assert.equal(usEast?.size, "4xlarge");
    assert.deepEqual(usEast?.supportedEditions.sort(), ["Enterprise", "Standard"]);
    assert.equal(usEast?.minSqlMajorVersion, 14);
    assert.equal(usEast?.maxIops, 60000);
    assert.equal(usEast?.maxThroughputMbps, 1500);
  });

  it("filters regional catalogs and validates orderability against current region", () => {
    const regionalCatalog: InstanceCatalogEntry[] = [
      { ...catalog[1], region: "us-east-1" },
      { ...catalog[1], region: "eu-west-1", maxIops: 1000 }
    ];

    assert.equal(catalogForRegion(regionalCatalog, "us-east-1").length, 1);
    assert.equal(catalogForRegion(catalog, "us-east-1").length, catalog.length);

    const result = isOrderableCandidate(regionalCatalog, { ...standardSql2022, region: "eu-west-1" }, "db.r8i.4xlarge", {
      memoryGb: 96,
      iops: 30000,
      throughputMbps: 900
    });

    assert.equal(result.valid, false);
    assert.ok(result.failures.some((failure) => failure.startsWith("IOPS_UNDERFIT")));
  });

  it("builds exact SQL Server-visible processor and capability entries from AWS orderability", () => {
    const mapped = instanceCatalogFromOrderableOptions([
      {
        Engine: "sqlserver-ee",
        EngineVersion: "16.00.4215.2.v1",
        DBInstanceClass: "db.r8i.4xlarge",
        LicenseModel: "license-included",
        MultiAZCapable: true,
        StorageType: "gp3",
        AvailableProcessorFeatures: [
          { Name: "coreCount", DefaultValue: "8", AllowedValues: "1,2,3,4,5,6,7,8" },
          { Name: "threadsPerCore", DefaultValue: "1", AllowedValues: "1" }
        ]
      },
      {
        Engine: "sqlserver-ee",
        EngineVersion: "16.00.4215.2.v1",
        DBInstanceClass: "db.r8i.4xlarge",
        LicenseModel: "license-included",
        MultiAZCapable: true,
        StorageType: "io2",
        AvailableProcessorFeatures: [
          { Name: "coreCount", DefaultValue: "8", AllowedValues: "1,2,3,4,5,6,7,8" },
          { Name: "threadsPerCore", DefaultValue: "1", AllowedValues: "1" }
        ]
      }
    ], [{
      instanceType: "db.r8i.4xlarge",
      region: "us-east-1",
      vcpu: 16,
      memory: 128,
      baselineIops: 40000,
      maximumIops: 80000,
      baselineThroughputMBps: 1250,
      maximumThroughputMBps: 2500
    }], "us-east-1", "2026-08-31T00:00:00.000Z");

    assert.equal(mapped.length, 1);
    assert.equal(mapped[0].hardwareVcpu, 16);
    assert.equal(mapped[0].sqlServerDefaultVcpu, 8);
    assert.equal(mapped[0].vcpu, 8);
    assert.equal(mapped[0].sqlServerDefaultVcpuSource, "aws-processor-features");
    assert.equal(mapped[0].optimizeCpuConfigurations?.length, 8);
    assert.equal(mapped[0].baselineIops, 40000);
    assert.equal(mapped[0].maxIops, 80000);
    assert.equal(mapped[0].baselineThroughputMbps, 1250);
    assert.equal(mapped[0].maxThroughputMbps, 2500);
    assert.equal(mapped[0].multiAzCapable, true);
    assert.deepEqual(mapped[0].supportedStorageTypes, ["gp3", "io2"]);
    assert.equal(isOrderableProcessorConfiguration(mapped[0], { coreCount: 4, threadsPerCore: 1 }), true);
    assert.equal(isOrderableProcessorConfiguration(mapped[0], { coreCount: 4, threadsPerCore: 2 }), false);
  });

  it("does not build or accept exact candidates from generic vCPU fallback metadata", () => {
    const mapped = instanceCatalogFromOrderableOptions([{
      Engine: "sqlserver-se",
      EngineVersion: "16.00.4215.2.v1",
      DBInstanceClass: "db.r8i.4xlarge",
      LicenseModel: "license-included",
      MultiAZCapable: true
    }], [{
      instanceType: "db.r8i.4xlarge",
      region: "us-east-1",
      vcpu: 16,
      memory: 128,
      baselineIops: 40000,
      maximumIops: 80000,
      baselineThroughputMBps: 1250,
      maximumThroughputMBps: 2500
    }], "us-east-1", "2026-08-31T00:00:00.000Z");

    assert.equal(mapped.length, 0);

    const validation = isOrderableCandidate([{
      ...catalog[1],
      region: "us-east-1",
      engineVersion: "16.00.4215.2.v1",
      sqlServerEdition: "Standard",
      supportedEditions: ["Standard"],
      sqlServerDefaultVcpuSource: "consolidated-vcpu",
      orderable: true
    }], {
      region: "us-east-1",
      sqlServerEdition: "Standard",
      sqlServerVersion: "16.00.4215.2"
    }, "db.r8i.4xlarge", {
      memoryGb: 64,
      iops: 1000,
      throughputMbps: 100
    });

    assert.equal(validation.valid, false);
    assert.ok(validation.failures.some((failure) =>
      failure.startsWith("EXACT_ORDERABILITY_METADATA_REQUIRED")
    ));
  });

  it("filters exact Region, edition, and SQL product build", () => {
    const exactCatalog: InstanceCatalogEntry[] = [
      {
        ...catalog[1],
        region: "us-east-1",
        engine: "sqlserver-ee",
        engineVersion: "16.00.4215.2.v1",
        sqlServerEdition: "Enterprise",
        sqlServerDefaultVcpuSource: "aws-processor-features",
        supportedEditions: ["Enterprise"],
        orderable: true
      },
      {
        ...catalog[1],
        region: "us-east-1",
        engine: "sqlserver-se",
        engineVersion: "16.00.4215.2.v1",
        sqlServerEdition: "Standard",
        sqlServerDefaultVcpuSource: "aws-processor-features",
        supportedEditions: ["Standard"],
        orderable: true
      },
      {
        ...catalog[1],
        region: "eu-west-1",
        engine: "sqlserver-se",
        engineVersion: "16.00.4215.2.v1",
        sqlServerEdition: "Standard",
        sqlServerDefaultVcpuSource: "aws-processor-features",
        supportedEditions: ["Standard"],
        orderable: true
      }
    ];

    const filtered = catalogForSqlServerConfiguration(exactCatalog, {
      region: "us-east-1",
      sqlServerEdition: "Standard",
      sqlServerVersion: "16.00.4215.2"
    });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].engine, "sqlserver-se");

    const result = isOrderableCandidate(exactCatalog, {
      region: "us-east-1",
      sqlServerEdition: "Standard",
      sqlServerVersion: "16.00.4215.3"
    }, "db.r8i.4xlarge", {
      memoryGb: 64,
      iops: 1000,
      throughputMbps: 100
    });
    assert.equal(result.valid, false);
    assert.ok(result.failures.some((failure) => failure.startsWith("SQL_VERSION_NOT_ORDERABLE")));
  });
});
