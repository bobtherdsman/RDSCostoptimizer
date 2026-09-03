import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

const collectorFiles = [
  "collector/costoptimization/RunMefirst.ps1",
  "collector/costoptimization/SSATcollector_launcher.ps1",
  "collector/costoptimization/SSATcollector.ps1",
  "collector/costoptimization/SSATcollector_compatible.ps1"
];

function read(path) {
  return readFileSync(path, "utf8");
}

describe("standalone Cost Optimization collector package", () => {
  it("COL-001: adds an explicit RunMefirst toggle that defaults off", () => {
    const runMeFirst = read("collector/costoptimization/RunMefirst.ps1");

    assert.match(runMeFirst, /Enable Cost Optimization diagnostics/);
    assert.match(runMeFirst, /\$chkCostOptimization\.Checked = \$false/);
    assert.match(runMeFirst, /\$params\.costoptimization = \$true/);
    assert.match(runMeFirst, /Kentra SQL Evidence Collector/);
    assert.match(runMeFirst, /Run commands/);
    assert.match(runMeFirst, /Activity log/);
    assert.match(runMeFirst, /Operational notes/);
    assert.doesNotMatch(runMeFirst, /SSAT Collector V2 - SQL Server Assessment Tool/);
    assert.doesNotMatch(runMeFirst, /RDS Cost Optimization Collector - SQL Server/);
  });

  it("COL-002: passes the costoptimization switch through launcher and collector scripts", () => {
    for (const file of collectorFiles.slice(1)) {
      const content = read(file);
      assert.match(content, /\[switch\]\$costoptimization/, `${file} should declare -costoptimization`);
    }

    const launcher = read("collector/costoptimization/SSATcollector_launcher.ps1");
    assert.match(launcher, /\$passArgs\.costoptimization = \$true/);
  });

  it("COL-003: exports only the required SQL-only Cost Optimization diagnostic CSV", () => {
    const collector = read("collector/costoptimization/SSATcollector.ps1");
    const compatibleCollector = read("collector/costoptimization/SSATcollector_compatible.ps1");

    assert.match(collector, /CO_EDITION_COMPATIBILITY/);
    for (const duplicateDiagnostic of [
      "CO_MEMORY_DIAGNOSTICS",
      "CO_WAIT_STATS",
      "CO_FILE_IO",
      "CO_DB_SIZE",
      "CO_TEMPDB_USAGE",
      "CO_DB_CPU_REQUEST_SAMPLE"
    ]) {
      assert.doesNotMatch(collector, new RegExp(duplicateDiagnostic));
    }

    assert.equal((collector.match(/Export-CostOptimizationDiagnostics -ServerName/g) ?? []).length, 2);
    assert.equal((compatibleCollector.match(/Export-CostOptimizationDiagnostics -ServerName/g) ?? []).length, 2);
  });

  it("COL-004: collects verified opt-in memory, file IO, and tempdb evidence in one table", () => {
    for (const file of collectorFiles.slice(2)) {
      const collector = read(file);

      assert.match(collector, /CREATE TABLE dbo\.CO_WorkloadSamples/, `${file} should create one consolidated CO table`);
      assert.doesNotMatch(collector, /CREATE TABLE dbo\.CO_MemorySamples/);
      assert.doesNotMatch(collector, /CREATE TABLE dbo\.CO_FileIoSamples/);
      assert.doesNotMatch(collector, /CREATE TABLE dbo\.CO_TempdbSamples/);
      assert.match(collector, /SampleType nvarchar\(32\) NOT NULL/);
      assert.match(collector, /N'memory'/);
      assert.match(collector, /N'file_io'/);
      assert.match(collector, /N'tempdb'/);

      for (const memorySignal of [
        "Memory Grants Pending",
        "Memory Grants Outstanding",
        "Granted Workspace Memory (KB)",
        "physical_memory_in_use_kb",
        "StolenServerMemoryMb",
        "MemoryClerksData",
        "sys.dm_os_memory_clerks",
        "process_physical_memory_low",
        "process_virtual_memory_low",
        "system_low_memory_signal_state",
        "Page life expectancy",
        "Buffer cache hit ratio",
        "Page reads/sec",
        "Page writes/sec",
        "Lazy writes/sec",
        "Batch Requests/sec"
      ]) {
        assert.equal(collector.includes(memorySignal), true, `${file} should collect ${memorySignal}`);
      }

      for (const fileIoSignal of [
        "num_of_reads",
        "num_of_writes",
        "num_of_bytes_read",
        "num_of_bytes_written",
        "io_stall_read_ms",
        "io_stall_write_ms",
        "size_on_disk_bytes",
        "file_type",
        "logical_name"
      ]) {
        assert.equal(collector.includes(fileIoSignal), true, `${file} should collect ${fileIoSignal}`);
      }

      assert.match(collector, /WHERE vfs\.database_id = 2 OR vfs\.database_id > 4/);
      assert.match(collector, /SUM\(allocated_extent_page_count\)/);
      assert.match(collector, /Name = "CO_WORKLOAD_SAMPLES"/);
      assert.equal((collector.match(/Export-CostOptimizationTimeSeries -ServerName/g) ?? []).length, 2);
    }
  });

  it("COL-005: keeps Cost Optimization time-series export and manifest export behind the opt-in toggle", () => {
    for (const file of collectorFiles.slice(2)) {
      const collector = read(file);
      const guardedExports = collector.match(/if \(\$costoptimization\) \{[\s\S]*?Export-CostOptimizationTimeSeries -ServerName[\s\S]*?Export-CostOptimizationDiagnostics -ServerName[\s\S]*?Export-CollectorRunManifest -ServerEntry[\s\S]*?\}/g) ?? [];

      assert.equal(guardedExports.length, 2, `${file} should guard both export paths`);
      assert.equal((collector.match(/Export-CostOptimizationTimeSeries -ServerName/g) ?? []).length, 2);
      assert.equal((collector.match(/Export-CollectorRunManifest -ServerEntry/g) ?? []).length, 2);
    }
  });

  it("COL-006: keeps per-minute additions behind the existing opt-in collection toggle", () => {
    for (const file of collectorFiles.slice(2)) {
      const collector = read(file);
      assert.match(collector, /\$costOptimizationCreateSql = ""/);
      assert.match(collector, /\$costOptimizationJobSql = ""/);
      assert.match(collector, /if \(\$costoptimization\) \{\s+\$costOptimizationCleanupSql = @"/s);
      assert.match(collector, /\$costOptimizationCreateSql = @"/);
      assert.match(collector, /\$costOptimizationJobSql = @"/);
    }
  });

  it("COL-007: uses compact Cost Optimization collection without legacy MEM and DBIO staging", () => {
    for (const file of collectorFiles.slice(2)) {
      const collector = read(file);
      const jobBlock = collector.match(/\$jobCommand = @"([\s\S]*?)"@\r?\n\s+\$jobCommandSql/)?.[1] ?? "";
      const finishBranch = jobBlock.slice(jobBlock.indexOf("set [JobStatus] = 'Finished'"));

      assert.match(collector, /\$legacyWorkloadCreateSql = @"/, `${file} should isolate legacy table creation`);
      assert.match(collector, /\$legacyWorkloadJobSql = @"/, `${file} should isolate legacy MEM and DBIO collection`);
      assert.match(collector, /if \(\$costoptimization\) \{\s+\$legacyWorkloadCreateSql = ""\s+\$legacyWorkloadJobSql = ""\s+\}/s);
      assert.match(collector, /CREATE TABLE SQL_CPUCollection[\s\S]*CREATE TABLE SQL_CollectionStatus[\s\S]*\$legacyWorkloadCreateSql[\s\S]*\$costOptimizationCreateSql/);
      assert.equal((collector.match(/CREATE TABLE SQL_MemCollection/g) ?? []).length, 1, `${file} should not create legacy MEM outside the conditional payload`);
      assert.equal((collector.match(/CREATE TABLE SQL_DBIOTotal/g) ?? []).length, 1, `${file} should not create legacy DBIOTotal outside the conditional payload`);
      assert.equal((collector.match(/CREATE TABLE SQL_DBIO \(/g) ?? []).length, 1, `${file} should not create legacy DBIO outside the conditional payload`);
      assert.equal((collector.match(/INSERT INTO SQL_MemCollection/g) ?? []).length, 1, `${file} should not collect legacy MEM outside the conditional payload`);
      assert.equal((collector.match(/INSERT dbo\.SQL_DBIOTotal/g) ?? []).length, 1, `${file} should not collect legacy DBIO outside the conditional payload`);
      assert.doesNotMatch(collector, /\$jobCommand = "\$jobCommand`r`n\$costOptimizationJobSql"/);
      assert.match(jobBlock, /\$legacyWorkloadJobSql[\s\S]*INSERT INTO SQL_CPUCollection[\s\S]*\$costOptimizationJobSql[\s\S]*END\s+ELSE/);
      assert.equal(finishBranch.includes("INSERT INTO SQL_CPUCollection"), false, `${file} should not collect CPU after marking the job finished`);
      assert.equal(finishBranch.includes("$costOptimizationJobSql"), false, `${file} should not collect CO samples after marking the job finished`);
    }
  });

  it("COL-008: preserves SQL Server-visible CPU metadata and existing CPU evidence", () => {
    for (const file of collectorFiles.slice(2)) {
      const collector = read(file);
      assert.match(collector, /cpu_count AS \[Logical CPU Count\]/);
      assert.match(collector, /socket_count AS \[Socket Count\]/);
      assert.match(collector, /FROM sys\.dm_os_sys_info WITH \(NOLOCK\)/);
      assert.match(collector, /SQLProcessUtilization AS \[SQL Server Process CPU Utilization\]/);
      assert.match(collector, /100 - SystemIdle - SQLProcessUtilization AS \[Other Process CPU Utilization\]/);
    }
  });

  it("COL-009: does not add forbidden high-impact capture patterns", () => {
    const combined = collectorFiles.map(read).join("\n").toLowerCase();

    for (const forbidden of [
      "sys.dm_exec_sql_text",
      "sys.dm_exec_query_plan",
      "query_store",
      "create event session",
      "from sys.fn_xe_file_target_read_file",
      "dbcc inputbuffer"
    ]) {
      assert.equal(combined.includes(forbidden), false, `${forbidden} should not be collected`);
    }

    for (const requiredReadOnlySource of [
      "sys.dm_os_performance_counters",
      "sys.dm_os_process_memory",
      "sys.dm_os_sys_memory",
      "sys.dm_io_virtual_file_stats",
      "tempdb.sys.dm_db_file_space_usage",
      "sys.dm_db_persisted_sku_features",
      "sys.dm_column_store_object_pool",
      "sys.dm_db_xtp_table_memory_stats"
    ]) {
      assert.equal(combined.includes(requiredReadOnlySource), true, `${requiredReadOnlySource} should provide verified evidence`);
    }
  });

  it("COL-010: keeps the collector spreadsheet SSAT-style with only approved current comparison fields", () => {
    const sample = read("collector/costoptimization/servers_credentials_sample.csv");
    const header = sample.split(/\r?\n/)[0];

    assert.equal(header, "ServerName,Login,Password,Database,RDSSize,StorageType,ProvisionedIops,ProvisionedThroughputMbps,AllocatedStorageGb,MultiAz,VendorSupportsStandardEdition,MigrationPathAccepted,MigrationPath");
    for (const forbidden of [
      "RequiredMemoryGb",
      "LicenseModel",
      "SqlServerEdition",
      "SqlServerVersion"
    ]) {
      assert.equal(sample.includes(forbidden), false, `${forbidden} must come from collector output, not spreadsheet input`);
    }
    assert.equal(sample.includes("CompareInstanceClass"), false);
    assert.equal(sample.includes("Auth"), false);
  });

  it("COL-011: exports a non-secret collector run manifest from the standalone collector", () => {
    for (const file of [
      "collector/costoptimization/SSATcollector.ps1",
      "collector/costoptimization/SSATcollector_compatible.ps1"
    ]) {
      const content = read(file);
      assert.match(content, /function Export-CollectorRunManifest/);
      assert.match(content, /COLLECTOR_RUN_MANIFEST/);
      assert.match(content, /ServerName = \$ServerEntry\.ServerName/);
      assert.match(content, /RDSSize = \$ServerEntry\.RDSSize/);
      assert.match(content, /VendorSupportsStandardEdition = \$ServerEntry\.VendorSupportsStandardEdition/);
      assert.match(content, /MigrationPathAccepted = \$ServerEntry\.MigrationPathAccepted/);
      assert.match(content, /MigrationPath = \$ServerEntry\.MigrationPath/);
      assert.doesNotMatch(content, /Login = \$ServerEntry\.Login/);
      assert.doesNotMatch(content, /Password = \$ServerEntry\.Password/);
    }
  });

  it("COL-012: uses an existing customer-named output directory instead of nesting another one", () => {
    const runMeFirst = read("collector/costoptimization/RunMefirst.ps1");
    const collector = read("collector/costoptimization/SSATcollector.ps1");
    const compatibleCollector = read("collector/costoptimization/SSATcollector_compatible.ps1");

    assert.match(runMeFirst, /function Resolve-OutputDirectory/);
    assert.match(runMeFirst, /\$selectedLeaf = Split-Path -Leaf \$selectedOutput/);
    assert.match(runMeFirst, /if \(\$selectedLeaf -ne \$custName\)/);
    assert.match(collector, /function Resolve-CustomerOutputPath/);
    assert.match(collector, /if \(\$selectedLeaf -eq \$CustomerName\) \{ return \$selectedOutput \}/);
    assert.match(compatibleCollector, /function Resolve-CustomerOutputPath/);
    assert.match(compatibleCollector, /if \(\$selectedLeaf -eq \$CustomerName\) \{ return \$selectedOutput \}/);
  });

});

