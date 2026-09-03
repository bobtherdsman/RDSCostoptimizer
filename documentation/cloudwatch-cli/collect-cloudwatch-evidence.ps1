# CloudWatch -> Collector-format evidence collector (customer-run, read-only) - Windows / PowerShell.
# Auto-discovers every RDS SQL Server instance across all enabled regions and writes evidence in the
# EXACT collector file layout/column names, populated ONLY from real AWS data. Columns that AWS does
# not collect are left BLANK (never fabricated) and are listed in _COLLECTION_NOTES.txt.
# Run: double-click RunMe.bat  (or)  powershell -ExecutionPolicy Bypass -File .\collect-cloudwatch-evidence.ps1
param(
  [int]$Days = 14,
  [string[]]$Regions,
  [string]$AwsProfile,
  [int]$PeriodSeconds = 300
)
$ErrorActionPreference = "Stop"
if ($AwsProfile) { $env:AWS_PROFILE = $AwsProfile }

$End    = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$Start  = (Get-Date).ToUniversalTime().AddDays(-$Days).ToString("yyyy-MM-ddTHH:mm:ssZ")
$Stamp  = (Get-Date).ToUniversalTime().ToString("yyyyMMdd_HHmmss")
$Out    = "cw-collector_$Stamp"
New-Item -ItemType Directory -Force $Out | Out-Null
$SqlEngines = "sqlserver-ee,sqlserver-se,sqlserver-ex,sqlserver-web"

if (-not $Regions -or $Regions.Count -eq 0) {
  try { $Regions = (aws ec2 describe-regions --query "Regions[].RegionName" --output text) -split "\s+" | Where-Object { $_ } }
  catch { $Regions = @("us-east-1","us-east-2","us-west-1","us-west-2","ca-central-1","eu-west-1","eu-west-2","eu-central-1","eu-north-1","ap-south-1","ap-southeast-1","ap-southeast-2","ap-northeast-1","sa-east-1") }
}
Write-Host ">> Scanning $($Regions.Count) region(s), window $Start .. $End UTC, period ${PeriodSeconds}s"

# Collector column contracts (exact names/order).
$MANIFEST_HDR = "ServerName,RDSSize,StorageType,ProvisionedIops,ProvisionedThroughputMbps,AllocatedStorageGb,MultiAz,VendorSupportsStandardEdition,MigrationPathAccepted,MigrationPath"
$CPU_HDR      = "ServerName,SqlSerCpuUT,SystemIdle,OtherProCpuUT,Collectiontime"
$CPUINFO_HDR  = "ServerName,Logical CPU Count,Socket Count,Hyperthread Ratio,Physical CPU Count,VM_type,SQL Edition,SQL Version"
$STORAGE_HDR  = "ServerName,DBName,SizeGB"
$WS_COLS = @("ServerName","Sample_ID","CollectionTime","SampleType","SqlCommittedMemoryMb","SqlTargetMemoryMb","OsTotalMemoryMb","OsAvailableMemoryMb","MemoryGrantsPending","MemoryGrantsOutstanding","GrantedWorkspaceMemoryKb","PhysicalMemoryInUseKb","StolenServerMemoryMb","MemoryClerksData","ProcessPhysicalMemoryLow","ProcessVirtualMemoryLow","SystemLowMemorySignalState","SystemHighMemorySignalState","SystemMemoryStateDesc","OverallPleSeconds","NumaPleJson","BufferCacheHitRatio","BufferCacheHitRatioBase","PageReadsPerSec","PageWritesPerSec","LazyWritesPerSec","BatchRequestsPerSec","DBName","database_id","file_id","file_type","logical_name","num_of_reads","num_of_bytes_read","io_stall_read_ms","num_of_writes","num_of_bytes_written","io_stall_write_ms","size_on_disk_bytes")

function Edition-From-Engine($e) {
  switch ($e) { "sqlserver-ee" {"Enterprise Edition (64-bit)"} "sqlserver-se" {"Standard Edition (64-bit)"} "sqlserver-ex" {"Express Edition (64-bit)"} "sqlserver-web" {"Web Edition (64-bit)"} default {""} }
}
# Sorted (timestamp, value) pairs for a get-metric-data result Id.
function Series($mdr, $id) {
  $r = $mdr | Where-Object { $_.Id -eq $id } | Select-Object -First 1
  if (-not $r) { return @() }
  $pairs = for ($i=0; $i -lt $r.Timestamps.Count; $i++) { [pscustomobject]@{ t = [datetime]$r.Timestamps[$i]; v = [double]$r.Values[$i] } }
  return $pairs | Sort-Object t
}
function WsLine($h) { ($WS_COLS | ForEach-Object { if ($h.ContainsKey($_)) { $h[$_] } else { "" } }) -join "," }

$manifestRows = @($MANIFEST_HDR)
$fleetCount = 0

foreach ($region in $Regions) {
  try { $ids = (aws rds describe-db-instances --region $region --filters "Name=engine,Values=$SqlEngines" --query "DBInstances[].DBInstanceIdentifier" --output text) }
  catch { Write-Host "   (skip region ${region}: $_)"; continue }
  if (-not $ids -or $ids -eq "None") { continue }

  foreach ($id in ($ids -split "\s+")) {
    if (-not $id) { continue }
    Write-Host "   + $region / $id"
    $djson = aws rds describe-db-instances --db-instance-identifier $id --region $region --output json | ConvertFrom-Json
    $db = $djson.DBInstances[0]
    $ep = if ($db.Endpoint.Address) { $db.Endpoint.Address } else { "$id.$region.rds.amazonaws.com" }
    $resid = $db.DbiResourceId
    $emOn  = ($db.MonitoringInterval -gt 0)
    $edition = Edition-From-Engine $db.Engine

    # --- Enhanced Monitoring snapshot (real OS facts): vCPUs, total/free memory ---
    $numVCPUs = ""; $osTotalMb = ""; $osFreeMbSnap = ""
    if ($emOn -and $resid) {
      try {
        $ev = aws logs get-log-events --region $region --log-group-name RDSOSMetrics --log-stream-name $resid --limit 1 --output json | ConvertFrom-Json
        if ($ev.events.Count -gt 0) {
          $os = $ev.events[-1].message | ConvertFrom-Json
          if ($os.numVCPUs) { $numVCPUs = [int]$os.numVCPUs }
          if ($os.memory.total) { $osTotalMb = [math]::Round([double]$os.memory.total / 1024) }   # KB -> MB
          if ($os.memory.free)  { $osFreeMbSnap = [math]::Round([double]$os.memory.free / 1024) }
        }
      } catch { }
    }

    # --- CloudWatch time series (real instance metrics) ---
    $q = @(
      '{"Id":"cpu","MetricStat":{"Metric":{"Namespace":"AWS/RDS","MetricName":"CPUUtilization","Dimensions":[{"Name":"DBInstanceIdentifier","Value":"'+$id+'"}]},"Period":'+$PeriodSeconds+',"Stat":"Average"}}',
      '{"Id":"riops","MetricStat":{"Metric":{"Namespace":"AWS/RDS","MetricName":"ReadIOPS","Dimensions":[{"Name":"DBInstanceIdentifier","Value":"'+$id+'"}]},"Period":'+$PeriodSeconds+',"Stat":"Average"}}',
      '{"Id":"wiops","MetricStat":{"Metric":{"Namespace":"AWS/RDS","MetricName":"WriteIOPS","Dimensions":[{"Name":"DBInstanceIdentifier","Value":"'+$id+'"}]},"Period":'+$PeriodSeconds+',"Stat":"Average"}}',
      '{"Id":"rtput","MetricStat":{"Metric":{"Namespace":"AWS/RDS","MetricName":"ReadThroughput","Dimensions":[{"Name":"DBInstanceIdentifier","Value":"'+$id+'"}]},"Period":'+$PeriodSeconds+',"Stat":"Average"}}',
      '{"Id":"wtput","MetricStat":{"Metric":{"Namespace":"AWS/RDS","MetricName":"WriteThroughput","Dimensions":[{"Name":"DBInstanceIdentifier","Value":"'+$id+'"}]},"Period":'+$PeriodSeconds+',"Stat":"Average"}}',
      '{"Id":"freemem","MetricStat":{"Metric":{"Namespace":"AWS/RDS","MetricName":"FreeableMemory","Dimensions":[{"Name":"DBInstanceIdentifier","Value":"'+$id+'"}]},"Period":'+$PeriodSeconds+',"Stat":"Average"}}'
    )
    "[" + ($q -join ",") + "]" | Out-File "$Out/_q.json" -Encoding ascii
    $mdr = (aws cloudwatch get-metric-data --region $region --metric-data-queries file://"$Out/_q.json" --start-time $Start --end-time $End --output json | ConvertFrom-Json).MetricDataResults

    $cpu   = Series $mdr "cpu"
    $riops = Series $mdr "riops"; $wiops = Series $mdr "wiops"
    $rtput = Series $mdr "rtput"; $wtput = Series $mdr "wtput"
    $freem = Series $mdr "freemem"

    # --- <ep>_00_CPU.csv : SqlSerCpuUT = instance total CPU (real); OtherProCpuUT blank (not split by CW) ---
    $cpuOut = @($CPU_HDR)
    foreach ($p in $cpu) {
      $t = $p.t.ToUniversalTime().ToString("yyyy-MM-dd HH:mm:ss")
      $cpuOut += "$ep,$([math]::Round($p.v,2)),$([math]::Round(100-$p.v,2)),,$t"
    }
    $cpuOut -join "`n" | Out-File "$Out/${ep}_00_CPU.csv" -Encoding utf8

    # --- <ep>_CPUINFO.csv : Logical CPU Count from EM numVCPUs (real, blank if EM off); edition/version real ---
    "$CPUINFO_HDR`n$ep,$numVCPUs,,,,,$edition,$($db.EngineVersion)" | Out-File "$Out/${ep}_CPUINFO.csv" -Encoding utf8

    # --- <ep>_CO_WORKLOAD_SAMPLES.csv : memory rows (OS-level real) + file_io rows (instance-level real, cumulative from rates) ---
    $ws = @(( $WS_COLS -join "," ))
    $sid = 0
    foreach ($p in $freem) {
      $sid++
      $t = $p.t.ToUniversalTime().ToString("yyyy-MM-dd HH:mm:ss")
      $availMb = [math]::Round([double]$p.v / 1048576)   # FreeableMemory bytes -> MB (real)
      $ws += WsLine @{ ServerName=$ep; Sample_ID=$sid; CollectionTime=$t; SampleType="memory"; OsTotalMemoryMb=$osTotalMb; OsAvailableMemoryMb=$availMb }
    }
    # file_io: instance-level (AWS has no per-database split). Integrate real rates into cumulative counters.
    $cumR=0.0; $cumRB=0.0; $cumW=0.0; $cumWB=0.0; $sid=0
    for ($i=0; $i -lt $cpu.Count; $i++) {
      $sid++
      $t = $cpu[$i].t.ToUniversalTime().ToString("yyyy-MM-dd HH:mm:ss")
      if ($i -gt 0) {
        $cumR  += (($riops[$i].v)  * $PeriodSeconds)
        $cumW  += (($wiops[$i].v)  * $PeriodSeconds)
        $cumRB += (($rtput[$i].v)  * $PeriodSeconds)
        $cumWB += (($wtput[$i].v)  * $PeriodSeconds)
      }
      $ws += WsLine @{ ServerName=$ep; Sample_ID=$sid; CollectionTime=$t; SampleType="file_io";
        DBName="(instance-total)"; database_id=""; file_id="1"; file_type="ROWS"; logical_name="instance_total";
        num_of_reads=[long]$cumR; num_of_bytes_read=[long]$cumRB; io_stall_read_ms="";
        num_of_writes=[long]$cumW; num_of_bytes_written=[long]$cumWB; io_stall_write_ms="";
        size_on_disk_bytes=[long]([double]$db.AllocatedStorage * 1073741824) }
    }
    $ws -join "`n" | Out-File "$Out/${ep}_CO_WORKLOAD_SAMPLES.csv" -Encoding utf8

    # --- <ep>_STORAGE.csv : instance-total only (AWS has no per-database size) ---
    "$STORAGE_HDR`n$ep,(instance-total),$($db.AllocatedStorage)" | Out-File "$Out/${ep}_STORAGE.csv" -Encoding utf8

    # manifest row
    $ma = $db.MultiAZ.ToString().ToLower()
    $manifestRows += "$ep,$($db.DBInstanceClass),$($db.StorageType),$($db.Iops),$($db.StorageThroughput),$($db.AllocatedStorage),$ma,,,"
    $fleetCount++
  }
}

($manifestRows -join "`n") | Out-File "$Out/collector_run_manifest.csv" -Encoding utf8
Remove-Item "$Out/_q.json" -ErrorAction SilentlyContinue

@"
COLLECTION NOTES - fields NOT collected (left blank; not fabricated)

Source: real AWS data only (RDS API + CloudWatch + Enhanced Monitoring snapshot).
Window: $Start .. $End UTC, period ${PeriodSeconds}s. Instances: $fleetCount.

Populated from real data:
  - collector_run_manifest.csv: RDSSize, StorageType, ProvisionedIops, ProvisionedThroughputMbps, AllocatedStorageGb, MultiAz (RDS API)
  - CPUINFO: SQL Edition, SQL Version (RDS API); Logical CPU Count (Enhanced Monitoring numVCPUs, blank if EM disabled)
  - 00_CPU: SqlSerCpuUT = instance CPUUtilization (CloudWatch); SystemIdle = 100 - CPU
  - CO_WORKLOAD_SAMPLES memory rows: OsAvailableMemoryMb (CloudWatch FreeableMemory), OsTotalMemoryMb (Enhanced Monitoring)
  - CO_WORKLOAD_SAMPLES file_io rows: instance-level Read/Write IOPS and throughput (CloudWatch), integrated into cumulative counters

NOT available from AWS (left blank):
  - OtherProCpuUT: CloudWatch does not split SQL vs non-SQL CPU.
  - Per-database attribution: file_io and STORAGE are labelled "(instance-total)"; AWS has no per-database physical I/O or per-database size.
  - SQL memory internals: SqlCommittedMemoryMb, SqlTargetMemoryMb, PLE, buffer cache, memory grants (DMV-only; partial via Performance Insights, not included here).
  - tempdb internals, per-file latency, edition feature audit: DMV-only, not collected by CloudWatch.
  - Logical CPU Count / OsTotalMemoryMb are blank if Enhanced Monitoring is not enabled on the instance.
"@ | Out-File "$Out/_COLLECTION_NOTES.txt" -Encoding utf8

$Zip = "$Out.zip"
Compress-Archive -Path "$Out\*" -DestinationPath $Zip -Force
Write-Host ">> Done. $fleetCount instance(s). Upload: $Zip"
