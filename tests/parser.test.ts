import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCsv } from "../src/parser/csv.js";
import { normalizeExistingCollectorCsvs } from "../src/parser/index.js";

describe("parseCsv", () => {
  it("handles BOM, quoted headers, quoted commas, and escaped quotes", () => {
    const rows = parseCsv('\uFEFF"Name","Value","Note"\n"app,db",42,"has ""quotes"""');

    assert.deepEqual(rows, [
      {
        Name: "app,db",
        Value: "42",
        Note: 'has "quotes"'
      }
    ]);
  });
});

describe("normalizeExistingCollectorCsvs", () => {
  const cpuCsv = [
    "ServerName,SqlSerCpuUT,SystemIdle,OtherProCpuUT,Collectiontime",
    "sql1,20,70,10,2026-08-28 00:00:00",
    "sql1,30,60,10,2026-08-28 00:01:00",
    "sql1,40,50,10,2026-08-28 00:02:00"
  ].join("\n");

  const memoryCsv = [
    "ServerName,SQL_CollectionTime,SQLCurrMemUsageMB,SQLMaxMemTargetMB,OSTotalMemoryMB,OSAVAMemoryMB,PLE,StolenServerMem,MemoryClerksData",
    "sql1,2026-08-28 00:00:00,8000,16000,32768,12000,10000,100,{}",
    "sql1,2026-08-28 00:01:00,9000,16000,32768,11000,12000,100,{}",
    "sql1,2026-08-28 00:02:00,10000,16000,32768,10000,14000,100,{}"
  ].join("\n");

  const ioCsv = [
    "ServerName,Sample_ID,Database_ID,DBName,Read,Written,BRead,BWritten,TotalB,TotalIOPs,Throuput,Netpackets,CollectionTime",
    "sql1,1,5,orders,0,0,314572800,314572800,0,6000,0,0,2026-08-28 00:00:00",
    "sql1,1,6,billing,0,0,62914560,62914560,0,1200,0,0,2026-08-28 00:00:00",
    "sql1,2,5,orders,0,0,629145600,629145600,0,12000,0,0,2026-08-28 00:01:00",
    "sql1,2,6,billing,0,0,125829120,125829120,0,2400,0,0,2026-08-28 00:01:00",
    "sql1,3,5,orders,0,0,943718400,943718400,0,18000,0,0,2026-08-28 00:02:00",
    "sql1,3,6,billing,0,0,188743680,188743680,0,3600,0,0,2026-08-28 00:02:00"
  ].join("\n");

  const storageCsv = [
    "ServerName,DBName,SizeGB",
    "sql1,orders,500",
    "sql1,billing,120"
  ].join("\n");

  it("normalizes existing collector CPU, memory, IO, throughput, and DB attribution", () => {
    const profile = normalizeExistingCollectorCsvs({ cpuCsv, memoryCsv, ioCsv, storageCsv });

    assert.equal(profile.cpuPct.p95, 39);
    assert.equal(profile.memoryPressurePct?.p95, 61.88);
    assert.equal(profile.pageLifeExpectancySeconds?.p95, 13800);

    // TotalIOPs is a 60-second delta in the collector output, so the parser converts it to per-second IOPS.
    assert.equal(profile.iops.p95, 348);

    // Throughput is derived from BRead+BWritten when legacy Throuput is zero.
    assert.equal(profile.throughputMbps.p95, 34.8);

    assert.equal(profile.totalDatabaseSizeGb, 620);
    assert.equal(profile.databases[0].databaseName, "orders");
    assert.equal(profile.databases[0].sizeGb, 500);
    assert.equal(profile.databases[0].iops?.p95, 290);
    assert.equal(profile.databases[1].databaseName, "billing");
  });
});