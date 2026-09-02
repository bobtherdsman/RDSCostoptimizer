param(
    [Parameter(Mandatory=$true)]
    [string]$serverlist,
    
    [Parameter(Mandatory=$false)]
    [ValidateSet("w","s")]
    [string]$auth,
    
    [string]$login,
    [string]$password,
    
    [Parameter(Mandatory=$false)]
    [int]$collectiontime,
    
    [switch]$cleanup,
    [switch]$terminate,
    [switch]$export,
    [switch]$compress,
    [switch]$costoptimization,
    [string]$outputpath = ".",
    [string]$database = "msdb",
    [string]$customername = ""
)

function Compress-ExportedFiles {
    param(
        [array]$FilesToCompress,
        [string]$OutputPath,
        [string]$ServerName,
        [string]$Timestamp
    )
    
    if ($FilesToCompress.Count -eq 0) { return }
    
    $zipPrefix = if ($customername) { "${customername}_${ServerName}" } else { $ServerName }
    $zipFile = Join-Path $OutputPath "${zipPrefix}_SSAT_${Timestamp}.zip"
    
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zipArchive = [System.IO.Compression.ZipFile]::Open($zipFile, 'Create')
    
    foreach ($file in $FilesToCompress) {
        if (Test-Path $file) {
            $entryName = Split-Path $file -Leaf
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zipArchive, $file, $entryName, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
        }
    }
    $zipArchive.Dispose()
    
    # Remove individual files
    foreach ($file in $FilesToCompress) {
        if (Test-Path $file) { Remove-Item $file -Force }
    }
    
    $zipSize = [math]::Round((Get-Item $zipFile).Length / 1KB, 1)
    Write-Host "→ Compressed to: $zipFile ($zipSize KB)" -ForegroundColor Green
}

function Resolve-CustomerOutputPath {
    param(
        [string]$OutputPath,
        [string]$CustomerName
    )

    if (-not $CustomerName) { return $OutputPath }

    $selectedOutput = $OutputPath.Trim()
    $selectedLeaf = Split-Path -Leaf $selectedOutput
    if ($selectedLeaf -eq $CustomerName) { return $selectedOutput }

    return Join-Path $selectedOutput $CustomerName
}

function Get-OptionalValue {
    param(
        [object]$Source,
        [string[]]$Names
    )

    foreach ($name in $Names) {
        $property = $Source.PSObject.Properties[$name]
        if ($property -and $null -ne $property.Value -and "$($property.Value)".Trim()) {
            return "$($property.Value)".Trim()
        }
    }

    return ""
}

$outputpath = Resolve-CustomerOutputPath -OutputPath $outputpath -CustomerName $customername
if (-not (Test-Path $outputpath)) { New-Item -ItemType Directory -Path $outputpath -Force | Out-Null }
Write-Host "Kentra V2 collector package path: $PSScriptRoot" -ForegroundColor Cyan

# Validation
if (-not $cleanup -and -not $terminate -and -not $export -and -not $collectiontime) {
    Write-Error "Collection time is required for deployment mode. Use -collectiontime parameter."
    exit 1
}

# Detect CSV vs plain text server list
$multiAuthMode = $false
$serverCredentials = @()

if (-not (Test-Path $serverlist)) {
    # Single server name
    if (-not $auth) { Write-Error "-auth is required for single server mode"; exit 1 }
    if ($auth -eq "s" -and (-not $login -or -not $password)) { Write-Error "SQL auth requires -login and -password"; exit 1 }
    $serverCredentials += [PSCustomObject]@{ ServerName=$serverlist; Auth=$auth; Login=$login; Password=$password; Database=$database; RDSSize=""; StorageType=""; ProvisionedIops=""; ProvisionedThroughputMbps=""; AllocatedStorageGb=""; MultiAz=""; VendorSupportsStandardEdition=""; MigrationPathAccepted=""; MigrationPath="" }
} else {
    # Check if file is CSV (has header with ServerName)
    $firstLine = (Get-Content $serverlist -TotalCount 1).Trim()
    if ($firstLine -match "^ServerName" -or $firstLine -match ",Auth,") {
        # CSV with per-server credentials
        $multiAuthMode = $true
        $csvData = Import-Csv $serverlist
        foreach ($row in $csvData) {
            $serverCredentials += [PSCustomObject]@{
                ServerName = $row.ServerName.Trim()
                Auth = $(if ($row.Auth) { $row.Auth.Trim().ToLower() } elseif ($auth) { $auth } else { "s" })
                Login = $(if ($row.Login) { $row.Login.Trim() } else { $login })
                Password = $(if ($row.Password) { $row.Password.Trim() } else { $password })
                Database = $(if ($row.Database) { $row.Database.Trim() } else { $database })
                RDSSize = Get-OptionalValue -Source $row -Names @("RDSSize", "ExistingRdsInstanceClass", "ExistingInstanceClass", "InstanceClass")
                StorageType = Get-OptionalValue -Source $row -Names @("StorageType", "CurrentStorageType")
                ProvisionedIops = Get-OptionalValue -Source $row -Names @("ProvisionedIops", "ProvisionedIOPS", "CurrentProvisionedIops", "CurrentProvisionedIOPS", "Iops", "IOPS")
                ProvisionedThroughputMbps = Get-OptionalValue -Source $row -Names @("ProvisionedThroughputMbps", "ProvisionedThroughputMBps", "ProvisionedThroughput", "CurrentProvisionedThroughputMbps", "ThroughputMbps")
                AllocatedStorageGb = Get-OptionalValue -Source $row -Names @("AllocatedStorageGb", "AllocatedStorageGB", "StorageGB", "AllocatedStorage")
                MultiAz = Get-OptionalValue -Source $row -Names @("MultiAz", "MultiAZ", "CurrentMultiAz", "CurrentMultiAZ")
                VendorSupportsStandardEdition = Get-OptionalValue -Source $row -Names @("VendorSupportsStandardEdition", "VendorSupportsStandard", "StandardEditionVendorSupported")
                MigrationPathAccepted = Get-OptionalValue -Source $row -Names @("MigrationPathAccepted", "StandardMigrationPathAccepted")
                MigrationPath = Get-OptionalValue -Source $row -Names @("MigrationPath", "StandardMigrationPath")
            }
        }
        Write-Host "Multi-credential mode: $($serverCredentials.Count) servers from CSV" -ForegroundColor Cyan
    } else {
        # Plain text - one server per line (original behavior)
        if (-not $auth) { Write-Error "-auth is required for plain text server list"; exit 1 }
        if ($auth -eq "s" -and (-not $login -or -not $password)) { Write-Error "SQL auth requires -login and -password"; exit 1 }
        $lines = Get-Content $serverlist | Where-Object { $_.Trim() -ne "" }
        foreach ($line in $lines) {
            $serverCredentials += [PSCustomObject]@{ ServerName=$line.Trim(); Auth=$auth; Login=$login; Password=$password; Database=$database; RDSSize=""; StorageType=""; ProvisionedIops=""; ProvisionedThroughputMbps=""; AllocatedStorageGb=""; MultiAz=""; VendorSupportsStandardEdition=""; MigrationPathAccepted=""; MigrationPath="" }
        }
    }
}

$servers = $serverCredentials
$processedCount = 0

# Display mode
if ($cleanup) {
    Write-Host "Starting SSAT cleanup on $($servers.Count) servers"
} elseif ($terminate) {
    Write-Host "Starting SSAT job termination on $($servers.Count) servers"
} elseif ($export) {
    Write-Host "Starting SSAT data export on $($servers.Count) servers"
} else {
    Write-Host "Starting SSAT collection on $($servers.Count) servers for $collectiontime minutes"
}

if ($costoptimization) {
    Write-Host "Cost Optimization diagnostics enabled: per-minute SQL-only evidence and bounded export snapshots will be collected." -ForegroundColor Cyan
}

if (-not $multiAuthMode) {
    if ($auth -eq "w") { Write-Host "Authentication: Windows" } else { Write-Host "Authentication: SQL" }
} else {
    Write-Host "Authentication: Per-server (from CSV)"
}

# Helper function to run queries
function Run-Query {
    param($server, $query, [switch]$NoResults)
    if ($auth -eq 'w') {
        if ($NoResults) {
            Invoke-Sqlcmd -ServerInstance $server -Database $database -Query $query -TrustServerCertificate -QueryTimeout 300 -ErrorAction Stop
        } else {
            Invoke-Sqlcmd -ServerInstance $server -Database $database -Query $query -TrustServerCertificate -QueryTimeout 300 -ErrorAction Stop
        }
    } else {
        if ($NoResults) {
            Invoke-Sqlcmd -ServerInstance $server -Database $database -Username $login -Password $password -Query $query -TrustServerCertificate -QueryTimeout 300 -ErrorAction Stop
        } else {
            Invoke-Sqlcmd -ServerInstance $server -Database $database -Username $login -Password $password -Query $query -TrustServerCertificate -QueryTimeout 300 -ErrorAction Stop
        }
    }
}

function Export-CostOptimizationDiagnostics {
    param(
        [string]$ServerName,
        [string]$ServerClean,
        [string]$Timestamp,
        [string]$OutputPath,
        [array]$ExportedFiles
    )

    $files = @($ExportedFiles)
    Write-Host "-> Exporting Cost Optimization diagnostics..." -ForegroundColor Cyan

    $diagnostics = @(
        [PSCustomObject]@{
            Name = "CO_EDITION_COMPATIBILITY"
            Query = @"
SET NOCOUNT ON;
CREATE TABLE #EditionCompatibility (
    ServerName nvarchar(512) NOT NULL,
    CollectionTime datetime2(3) NOT NULL,
    DatabaseName sysname NOT NULL,
    EvidenceType nvarchar(64) NOT NULL,
    FeatureName nvarchar(128) NULL,
    FeatureId int NULL,
    ValueMb decimal(18,2) NULL,
    AuditStatus nvarchar(16) NOT NULL
);

DECLARE @DatabaseName sysname;
DECLARE @EditionSql nvarchar(max);
DECLARE EditionDatabaseCursor CURSOR LOCAL FAST_FORWARD FOR
SELECT name
FROM sys.databases WITH (NOLOCK)
WHERE database_id > 4
  AND state_desc = 'ONLINE'
  AND HAS_DBACCESS(name) = 1;

OPEN EditionDatabaseCursor;
FETCH NEXT FROM EditionDatabaseCursor INTO @DatabaseName;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @EditionSql = N'USE ' + QUOTENAME(@DatabaseName) + N';
BEGIN TRY
    INSERT #EditionCompatibility
        (ServerName, CollectionTime, DatabaseName, EvidenceType, FeatureName, FeatureId, ValueMb, AuditStatus)
    SELECT N''$ServerName'', SYSDATETIME(), DB_NAME(), N''PERSISTED_SKU_FEATURE'', feature_name, feature_id, NULL, N''complete''
    FROM sys.dm_db_persisted_sku_features;

    INSERT #EditionCompatibility
        (ServerName, CollectionTime, DatabaseName, EvidenceType, FeatureName, FeatureId, ValueMb, AuditStatus)
    SELECT N''$ServerName'', SYSDATETIME(), DB_NAME(), N''COLUMNSTORE_SEGMENT_CACHE'', NULL, NULL,
           CAST(ISNULL(SUM(CONVERT(decimal(38,2), memory_used_in_bytes)), 0) / 1048576.0 AS decimal(18,2)), N''complete''
    FROM sys.dm_column_store_object_pool
    WHERE database_id = DB_ID();

    INSERT #EditionCompatibility
        (ServerName, CollectionTime, DatabaseName, EvidenceType, FeatureName, FeatureId, ValueMb, AuditStatus)
    SELECT N''$ServerName'', SYSDATETIME(), DB_NAME(), N''MEMORY_OPTIMIZED_ALLOCATED'', NULL, NULL,
           CAST(ISNULL(SUM(CONVERT(decimal(38,2), memory_allocated_for_table_kb)), 0) / 1024.0 AS decimal(18,2)), N''complete''
    FROM sys.dm_db_xtp_table_memory_stats;

    INSERT #EditionCompatibility
        (ServerName, CollectionTime, DatabaseName, EvidenceType, FeatureName, FeatureId, ValueMb, AuditStatus)
    SELECT N''$ServerName'', SYSDATETIME(), DB_NAME(), N''MEMORY_OPTIMIZED_USED'', NULL, NULL,
           CAST(ISNULL(SUM(CONVERT(decimal(38,2), memory_used_by_table_kb)), 0) / 1024.0 AS decimal(18,2)), N''complete''
    FROM sys.dm_db_xtp_table_memory_stats;

    INSERT #EditionCompatibility
        (ServerName, CollectionTime, DatabaseName, EvidenceType, FeatureName, FeatureId, ValueMb, AuditStatus)
    VALUES (N''$ServerName'', SYSDATETIME(), DB_NAME(), N''DATABASE_AUDIT'', NULL, NULL, NULL, N''complete'');
END TRY
BEGIN CATCH
    DELETE FROM #EditionCompatibility WHERE DatabaseName = DB_NAME();
    INSERT #EditionCompatibility
        (ServerName, CollectionTime, DatabaseName, EvidenceType, FeatureName, FeatureId, ValueMb, AuditStatus)
    VALUES (N''$ServerName'', SYSDATETIME(), DB_NAME(), N''DATABASE_AUDIT'', NULL, NULL, NULL, N''failed'');
END CATCH;';
    EXEC sys.sp_executesql @EditionSql;
    FETCH NEXT FROM EditionDatabaseCursor INTO @DatabaseName;
END;

CLOSE EditionDatabaseCursor;
DEALLOCATE EditionDatabaseCursor;

SELECT ServerName, CollectionTime, DatabaseName, EvidenceType, FeatureName, FeatureId, ValueMb, AuditStatus
FROM #EditionCompatibility
ORDER BY DatabaseName, EvidenceType, FeatureName;
"@
        }
    )

    foreach ($diag in $diagnostics) {
        try {
            $data = Run-Query -server $ServerName -query $diag.Query
            if ($data) {
                $file = Join-Path $OutputPath "${ServerClean}_$($diag.Name)_${Timestamp}.csv"
                $data | Export-Csv -Path $file -NoTypeInformation
                Write-Host "-> $($diag.Name) exported ($($data.Count) rows)" -ForegroundColor Green
                $files += $file
            }
        } catch {
            Write-Host "-> $($diag.Name) export skipped: $($_.Exception.Message)" -ForegroundColor Gray
        }
    }

    return $files
}

function Export-CostOptimizationTimeSeries {
    param(
        [string]$ServerName,
        [string]$ServerClean,
        [string]$Timestamp,
        [string]$OutputPath,
        [array]$ExportedFiles
    )

    $files = @($ExportedFiles)
    $seriesExports = @(
        [PSCustomObject]@{
            Name = "CO_WORKLOAD_SAMPLES"
            Query = "IF OBJECT_ID(N'dbo.CO_WorkloadSamples', N'U') IS NOT NULL SELECT '$ServerName' AS ServerName, * FROM dbo.CO_WorkloadSamples ORDER BY CollectionTime, Sample_ID, SampleType, database_id, file_id;"
        }
    )

    foreach ($seriesExport in $seriesExports) {
        try {
            $data = Run-Query -server $ServerName -query $seriesExport.Query
            if ($data) {
                $file = Join-Path $OutputPath "${ServerClean}_$($seriesExport.Name)_${Timestamp}.csv"
                $data | Export-Csv -Path $file -NoTypeInformation
                Write-Host "-> $($seriesExport.Name) exported ($($data.Count) rows)" -ForegroundColor Green
                $files += $file
            }
        } catch {
            Write-Host "-> $($seriesExport.Name) export skipped: $($_.Exception.Message)" -ForegroundColor Gray
        }
    }

    return $files
}

function Export-CollectorRunManifest {
    param(
        [object]$ServerEntry,
        [string]$ServerClean,
        [string]$Timestamp,
        [string]$OutputPath,
        [array]$ExportedFiles
    )

    $manifestFile = Join-Path $OutputPath "${ServerClean}_COLLECTOR_RUN_MANIFEST_${Timestamp}.csv"
    [PSCustomObject]@{
        ServerName = $ServerEntry.ServerName
        RDSSize = $ServerEntry.RDSSize
        StorageType = $ServerEntry.StorageType
        ProvisionedIops = $ServerEntry.ProvisionedIops
        ProvisionedThroughputMbps = $ServerEntry.ProvisionedThroughputMbps
        AllocatedStorageGb = $ServerEntry.AllocatedStorageGb
        MultiAz = $ServerEntry.MultiAz
        VendorSupportsStandardEdition = $ServerEntry.VendorSupportsStandardEdition
        MigrationPathAccepted = $ServerEntry.MigrationPathAccepted
        MigrationPath = $ServerEntry.MigrationPath
    } | Export-Csv -Path $manifestFile -NoTypeInformation

    Write-Host "-> Collector run manifest exported without credentials" -ForegroundColor Green
    $files = @($ExportedFiles)
    $files += $manifestFile
    return $files
}
function Test-Connection {
    param($server)
    try {
        $result = Run-Query -server $server -query "SELECT 1 AS test"
        return $true
    } catch {
        return $false
    }
}

foreach ($serverEntry in $servers) {
    $server = $serverEntry.ServerName
    if (-not $server) { continue }
    
    # Set per-server credentials
    $auth = $serverEntry.Auth
    $login = $serverEntry.Login
    $password = $serverEntry.Password
    $database = $serverEntry.Database
    
    Write-Host "`nProcessing server: $server (auth=$auth, db=$database)"
    
    # Test connection
    if (Test-Connection -server $server) {
        Write-Host "→ Connection successful" -ForegroundColor Green
    } else {
        Write-Host "→ Connection failed" -ForegroundColor Red
        continue
    }
    
    # TERMINATE MODE
    if ($terminate) {
        Write-Host "Terminating SSAT collection on $server..." -ForegroundColor Yellow
        try {
            Run-Query -server $server -query "UPDATE dbo.SQL_CollectionStatus SET JobStatus='Finished', Current_Sample_ID=Max_Sample_ID" -NoResults
            Write-Host "→ Collection terminated on $server" -ForegroundColor Cyan
            $processedCount++
        } catch {
            Write-Host "→ Failed to terminate: $($_.Exception.Message)" -ForegroundColor Red
        }
        continue
    }
    
    # CLEANUP MODE
    if ($cleanup) {
        Write-Host "Cleaning up $server..." -ForegroundColor Cyan
        
        # Check if tables exist
        try {
            $tableCheck = Run-Query -server $server -query "SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME IN ('SQL_CPUCollection', 'SQL_MemCollection', 'SQL_DBIO')"
            $tableCount = $tableCheck.cnt
        } catch { $tableCount = 0 }
        
        if ($tableCount -eq 0) {
            Write-Host "→ No SSAT tables found. Cleaning up job only..." -ForegroundColor Yellow
            try {
                Run-Query -server $server -query "IF (EXISTS(SELECT * FROM msdb.dbo.sysjobs WHERE (name = N'SQL_IOCollection'))) EXEC msdb.dbo.sp_delete_job @job_name=N'SQL_IOCollection'" -NoResults
                Write-Host "→ Job cleaned up" -ForegroundColor Cyan
            } catch { }
            continue
        }
        
        # Export if also requested
        if ($export) {
            Write-Host "→ Exporting data before cleanup..." -ForegroundColor Green
            $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
            $serverClean = $server -replace '[\\/:*?"<>|]', '_'
            $exportedFiles = @()
            
            try {
                $cpuData = Run-Query -server $server -query "SELECT '$server' as ServerName, * FROM SQL_CPUCollection ORDER BY Collectiontime"
                if ($cpuData) {
                    $cpuFile = Join-Path $outputpath "${serverClean}_CPU_${timestamp}.csv"
                    $cpuData | Export-Csv -Path $cpuFile -NoTypeInformation
                    Write-Host "→ CPU exported ($($cpuData.Count) rows)" -ForegroundColor Green
                    $exportedFiles += $cpuFile
                }
            } catch { Write-Host "→ CPU export skipped" -ForegroundColor Gray }
            
            try {
                $cpuInfoData = Run-Query -server $server -query "SELECT '$server' as ServerName, cpu_count AS [Logical CPU Count], socket_count AS [Socket Count], hyperthread_ratio AS [Hyperthread Ratio], cpu_count/hyperthread_ratio AS [Physical CPU Count], virtual_machine_type_desc AS VM_type, CAST(SERVERPROPERTY('Edition') AS NVARCHAR(128)) AS [SQL Edition], CAST(SERVERPROPERTY('ProductVersion') AS NVARCHAR(128)) AS [SQL Version] FROM sys.dm_os_sys_info WITH (NOLOCK)"
                if ($cpuInfoData) {
                    $cpuInfoFile = Join-Path $outputpath "${serverClean}_CPUINFO_${timestamp}.csv"
                    $cpuInfoData | Export-Csv -Path $cpuInfoFile -NoTypeInformation
                    Write-Host "→ CPU Info exported" -ForegroundColor Green
                    $exportedFiles += $cpuInfoFile
                }
            } catch { Write-Host "→ CPU Info export skipped" -ForegroundColor Gray }
            
            if (-not $costoptimization) {
                try {
                    $memData = Run-Query -server $server -query "SELECT '$server' as ServerName, * FROM SQL_MemCollection ORDER BY SQL_CollectionTime"
                    if ($memData) {
                        $memFile = Join-Path $outputpath "${serverClean}_MEM_${timestamp}.csv"
                        $memData | Export-Csv -Path $memFile -NoTypeInformation
                        Write-Host "→ Memory exported ($($memData.Count) rows)" -ForegroundColor Green
                        $exportedFiles += $memFile
                    }
                } catch { Write-Host "→ Memory export skipped" -ForegroundColor Gray }
                
                try {
                    $ioData = Run-Query -server $server -query "SELECT '$server' as ServerName, * FROM SQL_DBIO ORDER BY CollectionTime"
                    if ($ioData) {
                        $ioFile = Join-Path $outputpath "${serverClean}_IO_${timestamp}.csv"
                        $ioData | Export-Csv -Path $ioFile -NoTypeInformation
                        Write-Host "→ IO exported ($($ioData.Count) rows)" -ForegroundColor Green
                        $exportedFiles += $ioFile
                    }
                } catch { Write-Host "→ IO export skipped" -ForegroundColor Gray }
            }
            try {
                $storageData = Run-Query -server $server -query "SELECT '$server' as ServerName, ISNULL(ROUND(SUM((CAST(size AS BIGINT)*8))/1024.0/1024.0, 2), 0) AS TotalDBSizeGB FROM master.sys.master_files WHERE database_id > 4"
                if ($storageData) {
                    $storageFile = Join-Path $outputpath "${serverClean}_STORAGE_${timestamp}.csv"
                    $storageData | Export-Csv -Path $storageFile -NoTypeInformation
                    Write-Host "→ Storage exported" -ForegroundColor Green
                    $exportedFiles += $storageFile
                }
            } catch { Write-Host "→ Storage export skipped" -ForegroundColor Gray }

            if ($costoptimization) {
                $exportedFiles = Export-CostOptimizationTimeSeries -ServerName $server -ServerClean $serverClean -Timestamp $timestamp -OutputPath $outputpath -ExportedFiles $exportedFiles
                $exportedFiles = Export-CostOptimizationDiagnostics -ServerName $server -ServerClean $serverClean -Timestamp $timestamp -OutputPath $outputpath -ExportedFiles $exportedFiles
                $exportedFiles = Export-CollectorRunManifest -ServerEntry $serverEntry -ServerClean $serverClean -Timestamp $timestamp -OutputPath $outputpath -ExportedFiles $exportedFiles
            }

            if ($compress -and $exportedFiles.Count -gt 0) {
                Compress-ExportedFiles -FilesToCompress $exportedFiles -OutputPath $outputpath -ServerName $serverClean -Timestamp $timestamp
            }
        }
        
        # Drop tables and delete job
        $cleanupSql = @"
IF (EXISTS(SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='SQL_DBIOTotal'))
    DROP TABLE [dbo].[SQL_DBIOTotal];
IF (EXISTS(SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='SQL_DBIO'))
    DROP TABLE [dbo].[SQL_DBIO];
IF (EXISTS(SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='SQL_CollectionStatus'))
    DROP TABLE [dbo].[SQL_CollectionStatus];
IF (EXISTS(SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='SQL_CPUCollection'))
    DROP TABLE [dbo].[SQL_CPUCollection];
IF (EXISTS(SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='SQL_MemCollection'))
    DROP TABLE [dbo].[SQL_MemCollection];
IF OBJECT_ID(N'dbo.CO_WorkloadSamples', N'U') IS NOT NULL
    DROP TABLE [dbo].[CO_WorkloadSamples];
IF (EXISTS(SELECT * FROM msdb.dbo.sysjobs WHERE (name = N'SQL_IOCollection')))
    EXEC msdb.dbo.sp_delete_job @job_name=N'SQL_IOCollection'
"@
        try {
            Run-Query -server $server -query $cleanupSql -NoResults
            Write-Host "→ Cleanup completed on $server" -ForegroundColor Cyan
            $processedCount++
        } catch {
            Write-Host "→ Cleanup failed: $($_.Exception.Message)" -ForegroundColor Red
        }
        continue
    }
    
    # EXPORT ONLY MODE
    if ($export -and -not $cleanup) {
        Write-Host "Exporting data from $server..." -ForegroundColor Green
        $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
        $serverClean = $server -replace '[\\/:*?"<>|]', '_'
        $exportedFiles = @()
        
        try {
            $cpuData = Run-Query -server $server -query "SELECT '$server' as ServerName, * FROM SQL_CPUCollection ORDER BY Collectiontime"
            if ($cpuData) {
                $cpuFile = Join-Path $outputpath "${serverClean}_CPU_${timestamp}.csv"
                $cpuData | Export-Csv -Path $cpuFile -NoTypeInformation
                Write-Host "→ CPU exported ($($cpuData.Count) rows)" -ForegroundColor Green
                $exportedFiles += $cpuFile
            }
        } catch { Write-Host "→ CPU export failed: $($_.Exception.Message)" -ForegroundColor Red }
        
        try {
            $cpuInfoData = Run-Query -server $server -query "SELECT '$server' as ServerName, cpu_count AS [Logical CPU Count], socket_count AS [Socket Count], hyperthread_ratio AS [Hyperthread Ratio], cpu_count/hyperthread_ratio AS [Physical CPU Count], virtual_machine_type_desc AS VM_type, CAST(SERVERPROPERTY('Edition') AS NVARCHAR(128)) AS [SQL Edition], CAST(SERVERPROPERTY('ProductVersion') AS NVARCHAR(128)) AS [SQL Version] FROM sys.dm_os_sys_info WITH (NOLOCK)"
            if ($cpuInfoData) {
                $cpuInfoFile = Join-Path $outputpath "${serverClean}_CPUINFO_${timestamp}.csv"
                $cpuInfoData | Export-Csv -Path $cpuInfoFile -NoTypeInformation
                Write-Host "→ CPU Info exported" -ForegroundColor Green
                $exportedFiles += $cpuInfoFile
            }
        } catch { Write-Host "→ CPU Info export failed: $($_.Exception.Message)" -ForegroundColor Red }
        
        if (-not $costoptimization) {
            try {
                $memData = Run-Query -server $server -query "SELECT '$server' as ServerName, * FROM SQL_MemCollection ORDER BY SQL_CollectionTime"
                if ($memData) {
                    $memFile = Join-Path $outputpath "${serverClean}_MEM_${timestamp}.csv"
                    $memData | Export-Csv -Path $memFile -NoTypeInformation
                    Write-Host "→ Memory exported ($($memData.Count) rows)" -ForegroundColor Green
                    $exportedFiles += $memFile
                }
            } catch { Write-Host "→ Memory export failed: $($_.Exception.Message)" -ForegroundColor Red }
            
            try {
                $ioData = Run-Query -server $server -query "SELECT '$server' as ServerName, * FROM SQL_DBIO ORDER BY CollectionTime"
                if ($ioData) {
                    $ioFile = Join-Path $outputpath "${serverClean}_IO_${timestamp}.csv"
                    $ioData | Export-Csv -Path $ioFile -NoTypeInformation
                    Write-Host "→ IO exported ($($ioData.Count) rows)" -ForegroundColor Green
                    $exportedFiles += $ioFile
                }
            } catch { Write-Host "→ IO export failed: $($_.Exception.Message)" -ForegroundColor Red }
        }

        if ($costoptimization) {
            $exportedFiles = Export-CostOptimizationTimeSeries -ServerName $server -ServerClean $serverClean -Timestamp $timestamp -OutputPath $outputpath -ExportedFiles $exportedFiles
            $exportedFiles = Export-CostOptimizationDiagnostics -ServerName $server -ServerClean $serverClean -Timestamp $timestamp -OutputPath $outputpath -ExportedFiles $exportedFiles
            $exportedFiles = Export-CollectorRunManifest -ServerEntry $serverEntry -ServerClean $serverClean -Timestamp $timestamp -OutputPath $outputpath -ExportedFiles $exportedFiles
        }

            if ($compress -and $exportedFiles.Count -gt 0) {
            Compress-ExportedFiles -FilesToCompress $exportedFiles -OutputPath $outputpath -ServerName $serverClean -Timestamp $timestamp
        }
        
        $processedCount++
        continue
    }
    
    # DEPLOY MODE - Check status first
    try {
        $status = Run-Query -server $server -query "IF EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='SQL_CollectionStatus') SELECT JobStatus, Max_Sample_ID, Current_Sample_ID, Max_Sample_ID - Current_Sample_ID as TimeRemaining FROM SQL_CollectionStatus WHERE JobStatus IN ('Running', 'Finished') ELSE SELECT 'New' as JobStatus, 0 as TimeRemaining"
        
        if ($status.JobStatus -eq "Running") {
            $remaining = $status.TimeRemaining
            Write-Host "Collection still running on $server for another $remaining minutes." -ForegroundColor Yellow
            continue
        } elseif ($status.JobStatus -eq "Finished") {
            Write-Host "Previous collection completed on $server. Use -export to get data, -cleanup to redeploy." -ForegroundColor Green
            continue
        }
    } catch {
        # Table doesn't exist, proceed with deployment
    }
    
    # Deploy collection
    Write-Host "Deploying SSAT collection to $server..." -ForegroundColor Green

    $costOptimizationCleanupSql = ""
    $costOptimizationCreateSql = ""
    $costOptimizationJobSql = ""
    if ($costoptimization) {
        $costOptimizationCleanupSql = @"
IF OBJECT_ID(N'dbo.CO_WorkloadSamples', N'U') IS NOT NULL
    DROP TABLE [dbo].[CO_WorkloadSamples];
"@

        $costOptimizationCreateSql = @"
CREATE TABLE dbo.CO_WorkloadSamples (
    Sample_ID bigint NOT NULL,
    CollectionTime datetime2(3) NOT NULL,
    SampleType nvarchar(32) NOT NULL,
    SqlCommittedMemoryMb decimal(18,2) NULL,
    SqlTargetMemoryMb decimal(18,2) NULL,
    OsTotalMemoryMb decimal(18,2) NULL,
    OsAvailableMemoryMb decimal(18,2) NULL,
    MemoryGrantsPending bigint NULL,
    MemoryGrantsOutstanding bigint NULL,
    GrantedWorkspaceMemoryKb bigint NULL,
    PhysicalMemoryInUseKb bigint NULL,
    ProcessPhysicalMemoryLow bit NULL,
    ProcessVirtualMemoryLow bit NULL,
    SystemLowMemorySignalState bit NULL,
    SystemHighMemorySignalState bit NULL,
    SystemMemoryStateDesc nvarchar(256) NULL,
    OverallPleSeconds bigint NULL,
    NumaPleJson nvarchar(max) NULL,
    BufferCacheHitRatio bigint NULL,
    BufferCacheHitRatioBase bigint NULL,
    PageReadsPerSec bigint NULL,
    PageWritesPerSec bigint NULL,
    LazyWritesPerSec bigint NULL,
    BatchRequestsPerSec bigint NULL,
    ColumnstoreSegmentCacheMb decimal(18,2) NULL,
    DBName sysname NULL,
    database_id int NULL,
    file_id int NULL,
    file_type nvarchar(60) NULL,
    logical_name sysname NULL,
    num_of_reads bigint NULL,
    num_of_bytes_read bigint NULL,
    io_stall_read_ms bigint NULL,
    num_of_writes bigint NULL,
    num_of_bytes_written bigint NULL,
    io_stall_write_ms bigint NULL,
    size_on_disk_bytes bigint NULL,
    TotalMb decimal(18,2) NULL,
    AllocatedMb decimal(18,2) NULL,
    UserObjectMb decimal(18,2) NULL,
    InternalObjectMb decimal(18,2) NULL,
    VersionStoreMb decimal(18,2) NULL
);
"@

        $costOptimizationJobSql = @"
DECLARE @CO_Sample_ID bigint = (SELECT Current_Sample_ID FROM dbo.SQL_CollectionStatus);
DECLARE @CO_CollectionTime datetime2(3) = SYSDATETIME();

INSERT dbo.CO_WorkloadSamples (
    Sample_ID, CollectionTime, SampleType, SqlCommittedMemoryMb, SqlTargetMemoryMb,
    OsTotalMemoryMb, OsAvailableMemoryMb, MemoryGrantsPending,
    MemoryGrantsOutstanding, GrantedWorkspaceMemoryKb, PhysicalMemoryInUseKb,
    ProcessPhysicalMemoryLow, ProcessVirtualMemoryLow, SystemLowMemorySignalState,
    SystemHighMemorySignalState, SystemMemoryStateDesc, OverallPleSeconds,
    NumaPleJson, BufferCacheHitRatio, BufferCacheHitRatioBase,
    PageReadsPerSec, PageWritesPerSec, LazyWritesPerSec, BatchRequestsPerSec,
    ColumnstoreSegmentCacheMb
)
SELECT
    @CO_Sample_ID,
    @CO_CollectionTime,
    N'memory',
    CAST(osi.committed_kb / 1024.0 AS decimal(18,2)),
    CAST(osi.committed_target_kb / 1024.0 AS decimal(18,2)),
    CAST(osm.total_physical_memory_kb / 1024.0 AS decimal(18,2)),
    CAST(osm.available_physical_memory_kb / 1024.0 AS decimal(18,2)),
    (SELECT MAX(CASE WHEN counter_name = ''Memory Grants Pending'' THEN cntr_value END) FROM sys.dm_os_performance_counters WITH (NOLOCK) WHERE object_name LIKE ''%:Memory Manager''),
    (SELECT MAX(CASE WHEN counter_name = ''Memory Grants Outstanding'' THEN cntr_value END) FROM sys.dm_os_performance_counters WITH (NOLOCK) WHERE object_name LIKE ''%:Memory Manager''),
    (SELECT MAX(CASE WHEN counter_name = ''Granted Workspace Memory (KB)'' THEN cntr_value END) FROM sys.dm_os_performance_counters WITH (NOLOCK) WHERE object_name LIKE ''%:Memory Manager''),
    opm.physical_memory_in_use_kb,
    opm.process_physical_memory_low,
    opm.process_virtual_memory_low,
    osm.system_low_memory_signal_state,
    osm.system_high_memory_signal_state,
    osm.system_memory_state_desc,
    (SELECT MAX(cntr_value) FROM sys.dm_os_performance_counters WITH (NOLOCK) WHERE object_name LIKE ''%:Buffer Manager'' AND counter_name = ''Page life expectancy''),
    ISNULL((SELECT instance_name AS NumaNode, cntr_value AS PageLifeExpectancySeconds FROM sys.dm_os_performance_counters WITH (NOLOCK) WHERE object_name LIKE ''%:Buffer Node'' AND counter_name = ''Page life expectancy'' ORDER BY instance_name FOR JSON PATH), N''[]''),
    (SELECT MAX(cntr_value) FROM sys.dm_os_performance_counters WITH (NOLOCK) WHERE object_name LIKE ''%:Buffer Manager'' AND counter_name = ''Buffer cache hit ratio''),
    (SELECT MAX(cntr_value) FROM sys.dm_os_performance_counters WITH (NOLOCK) WHERE object_name LIKE ''%:Buffer Manager'' AND counter_name = ''Buffer cache hit ratio base''),
    (SELECT MAX(cntr_value) FROM sys.dm_os_performance_counters WITH (NOLOCK) WHERE object_name LIKE ''%:Buffer Manager'' AND counter_name = ''Page reads/sec''),
    (SELECT MAX(cntr_value) FROM sys.dm_os_performance_counters WITH (NOLOCK) WHERE object_name LIKE ''%:Buffer Manager'' AND counter_name = ''Page writes/sec''),
    (SELECT MAX(cntr_value) FROM sys.dm_os_performance_counters WITH (NOLOCK) WHERE object_name LIKE ''%:Buffer Manager'' AND counter_name = ''Lazy writes/sec''),
    (SELECT MAX(cntr_value) FROM sys.dm_os_performance_counters WITH (NOLOCK) WHERE object_name LIKE ''%:SQL Statistics'' AND counter_name = ''Batch Requests/sec''),
    CAST(ISNULL((SELECT SUM(CONVERT(decimal(38,2), memory_used_in_bytes)) FROM sys.dm_column_store_object_pool), 0) / 1048576.0 AS decimal(18,2))
FROM sys.dm_os_sys_info AS osi
CROSS JOIN sys.dm_os_sys_memory AS osm
CROSS JOIN sys.dm_os_process_memory AS opm;

INSERT dbo.CO_WorkloadSamples (
    Sample_ID, CollectionTime, SampleType, DBName, database_id, file_id, file_type,
    logical_name, num_of_reads, num_of_bytes_read, io_stall_read_ms,
    num_of_writes, num_of_bytes_written, io_stall_write_ms, size_on_disk_bytes
)
SELECT
    @CO_Sample_ID,
    @CO_CollectionTime,
    N'file_io',
    DB_NAME(vfs.database_id),
    vfs.database_id,
    vfs.file_id,
    mf.type_desc,
    mf.name,
    vfs.num_of_reads,
    vfs.num_of_bytes_read,
    vfs.io_stall_read_ms,
    vfs.num_of_writes,
    vfs.num_of_bytes_written,
    vfs.io_stall_write_ms,
    vfs.size_on_disk_bytes
FROM sys.dm_io_virtual_file_stats(NULL, NULL) AS vfs
JOIN master.sys.master_files AS mf
  ON mf.database_id = vfs.database_id
 AND mf.file_id = vfs.file_id
WHERE vfs.database_id = 2 OR vfs.database_id > 4;

INSERT dbo.CO_WorkloadSamples (
    Sample_ID, CollectionTime, SampleType, TotalMb, AllocatedMb,
    UserObjectMb, InternalObjectMb, VersionStoreMb
)
SELECT
    @CO_Sample_ID,
    @CO_CollectionTime,
    N'tempdb',
    CAST(SUM(total_page_count) * 8.0 / 1024.0 AS decimal(18,2)),
    CAST(SUM(allocated_extent_page_count) * 8.0 / 1024.0 AS decimal(18,2)),
    CAST(SUM(user_object_reserved_page_count) * 8.0 / 1024.0 AS decimal(18,2)),
    CAST(SUM(internal_object_reserved_page_count) * 8.0 / 1024.0 AS decimal(18,2)),
    CAST(SUM(version_store_reserved_page_count) * 8.0 / 1024.0 AS decimal(18,2))
FROM tempdb.sys.dm_db_file_space_usage WITH (NOLOCK);
"@
        $costOptimizationJobSql = $costOptimizationJobSql -replace "''", "'"
    }

    $legacyWorkloadCreateSql = @"
CREATE TABLE SQL_MemCollection (SQL_CollectionTime Datetime, SQLCurrMemUsageMB decimal(12,2), SQLMaxMemTargetMB int, OSTotalMemoryMB int, OSAVAMemoryMB int, PLE int, StolenServerMem int, MemoryClerksData NVARCHAR(MAX))
CREATE TABLE SQL_DBIOTotal (Sample_ID bigint, Database_ID int, DBName nvarchar(400), [Read] bigint, [Written] bigint, BRead bigint, BWritten bigint, Throughput bigint, TotalIOPs bigint, NetPackets bigint, CollectionTime datetime)
CREATE TABLE SQL_DBIO (Sample_ID bigint, Database_ID bigint, DBName nvarchar(400), [Read] bigint, [Written] bigint, BRead bigint, BWritten bigint, TotalB bigint, TotalIOPs bigint, Throuput bigint, Netpackets bigint, CollectionTime datetime)
"@
    $legacyWorkloadJobSql = @"
    INSERT dbo.SQL_DBIOTotal
    SELECT
        @Current_Sample_ID,
        d.Database_ID,
        d.name,
        SUM(fs.num_of_reads),
        SUM(fs.num_of_writes),
        SUM(fs.num_of_bytes_read),
        SUM(fs.num_of_bytes_written),
        SUM((fs.num_of_bytes_read) + (fs.num_of_bytes_written)),
        SUM(fs.num_of_reads + fs.num_of_writes),
        (select Sum(net_packet_size) as Total_net_packets_used from sys.dm_exec_connections),
        GETDATE()
    FROM sys.dm_io_virtual_file_stats(default, default) AS fs
    INNER JOIN sys.databases d WITH (NOLOCK) ON d.Database_ID = fs.Database_ID
    WHERE d.name NOT IN ('master','model','msdb','distribution','ReportServer','ReportServerTempDB')
    and d.state = 0
    GROUP BY d.name, d.Database_ID;

    INSERT dbo.SQL_DBIO
    SELECT
        @Current_Sample_ID,
        DR1.Database_ID,
        DR1.DBName,
        DR2.[Read] - DR1.[Read],
        DR2.[Written] - DR1.[Written],
        DR2.[BRead] - DR1.[BRead],
        DR2.[BWritten] - DR1.[BWritten],
        DR2.Throughput - DR1.Throughput,
        DR2.TotalIOPs - DR1.TotalIOPs,
        0,
        DR2.NetPackets - DR1.NetPackets,
        DR2.CollectionTime
    FROM dbo.SQL_DBIOTotal AS DR1
    INNER JOIN dbo.SQL_DBIOTotal AS DR2 ON DR1.Database_ID = DR2.Database_ID
    WHERE DR1.Sample_ID = @Current_Sample_ID - 1
    AND DR2.Sample_ID = @Current_Sample_ID;

INSERT INTO SQL_MemCollection
SELECT x.*, y.*, z.*, a.*, c.*
FROM
(SELECT getdate() as collectionTime, (committed_kb / 1024) as Commited, (committed_target_kb / 1024) as targetcommited FROM sys.dm_os_sys_info) as x,
(SELECT (total_physical_memory_kb / 1024) as totalMem, (available_physical_memory_kb / 1024) as AvaiMem FROM sys.dm_os_sys_memory) as y,
(SELECT sum(cntr_value) / count(*) as PLE FROM sys.dm_os_performance_counters WHERE counter_name like '%Page life expectancy%' AND object_name = 'SQLServer:Buffer Node') as z,
(SELECT cntr_value / 1024 as StolenServerMem FROM sys.dm_os_performance_counters WHERE object_name = 'SQLServer:Memory Manager' AND counter_name LIKE '%Stolen Server%') as a,
(SELECT (SELECT TOP 15 [type] AS [ClerkType], SUM(pages_kb) / 1024 AS [SizeMb] FROM sys.dm_os_memory_clerks WITH (NOLOCK) GROUP BY [type] ORDER BY SUM(pages_kb) DESC FOR JSON PATH) as MemoryClerksData) as c;
"@
    if ($costoptimization) {
        $legacyWorkloadCreateSql = ""
        $legacyWorkloadJobSql = ""
    }

    $jobCommand = @"
SET QUOTED_IDENTIFIER ON;
Declare @Current_Sample_ID Bigint;
If (Select Max_Sample_ID - Current_Sample_ID from SQL_CollectionStatus) > 0
BEGIN
    update dbo.SQL_CollectionStatus
    set Current_Sample_ID = Current_Sample_ID + 1;
    Set @Current_Sample_ID = (Select Current_Sample_ID from SQL_CollectionStatus);
$legacyWorkloadJobSql

DECLARE @ts_now bigint = (SELECT ms_ticks FROM sys.dm_os_sys_info WITH (NOLOCK));
INSERT INTO SQL_CPUCollection
SELECT TOP(1) SQLProcessUtilization AS [SQL Server Process CPU Utilization],
               SystemIdle AS [System Idle Process],
               100 - SystemIdle - SQLProcessUtilization AS [Other Process CPU Utilization],
               DATEADD(ms, -1 * (@ts_now - [timestamp]), GETDATE()) AS [Event Time]
FROM (SELECT record.value('(./Record/@id)[1]', 'int') AS record_id,
              record.value('(./Record/SchedulerMonitorEvent/SystemHealth/SystemIdle)[1]', 'int') AS [SystemIdle],
              record.value('(./Record/SchedulerMonitorEvent/SystemHealth/ProcessUtilization)[1]', 'int') AS [SQLProcessUtilization],
              [timestamp]
      FROM (SELECT [timestamp], CONVERT(xml, record) AS [record]
            FROM sys.dm_os_ring_buffers WITH (NOLOCK)
            WHERE ring_buffer_type = N'RING_BUFFER_SCHEDULER_MONITOR'
            AND record LIKE N'%<SystemHealth>%') AS x) AS y
ORDER BY record_id DESC;
$costOptimizationJobSql
END
ELSE
BEGIN
    update dbo.SQL_CollectionStatus
    set [JobStatus] = 'Finished',
    [CollectionEndTime] = GETDATE();
    EXEC msdb.dbo.sp_update_job @job_name=N'SQL_IOCollection',
    @enabled=0;
END;
"@
    $jobCommandSql = $jobCommand.Replace("'", "''")

    $deployScript = @"
-- Cleanup existing
IF (EXISTS(SELECT * FROM msdb.dbo.sysjobs WHERE (name = N'SQL_IOCollection')))
    EXEC msdb.dbo.sp_delete_job @job_name=N'SQL_IOCollection'
IF (EXISTS(SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='SQL_CPUCollection'))
    DROP TABLE [dbo].[SQL_CPUCollection];
IF (EXISTS(SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='SQL_MemCollection'))
    DROP TABLE [dbo].[SQL_MemCollection];
IF (EXISTS(SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='SQL_DBIO'))
    DROP TABLE [dbo].[SQL_DBIO];
IF (EXISTS(SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='SQL_DBIOTotal'))
    DROP TABLE [dbo].[SQL_DBIOTotal];
IF (EXISTS(SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='SQL_CollectionStatus'))
    DROP TABLE [dbo].[SQL_CollectionStatus];
$costOptimizationCleanupSql

-- Create tables
CREATE TABLE SQL_CPUCollection (SqlSerCpuUT int, SystemIdle int, OtherProCpuUT int, Collectiontime datetime)
CREATE TABLE SQL_CollectionStatus (JobStatus nvarchar(10), SPID int, CollectionStartTime datetime, CollectionEndTime datetime, Max_Sample_ID bigint, Current_Sample_ID bigint)
$legacyWorkloadCreateSql
$costOptimizationCreateSql

-- Insert status
INSERT SQL_CollectionStatus (JobStatus, SPID, CollectionStartTime, Max_Sample_ID, Current_Sample_ID)
SELECT 'Running', @@SPID, GETDATE(), $collectiontime, 0

declare @admindb varchar(30)
set @admindb ='$database'
/****** Create SQL_IOCollection Agent  ******/
BEGIN TRANSACTION
DECLARE @ReturnCode INT
SELECT @ReturnCode = 0
IF NOT EXISTS (SELECT name FROM msdb.dbo.syscategories WHERE name=N'[Uncategorized (Local)]' AND category_class=1)
BEGIN
EXEC @ReturnCode = msdb.dbo.sp_add_category @class=N'JOB', @type=N'LOCAL', @name=N'[Uncategorized (Local)]'
IF (@@ERROR <> 0 OR @ReturnCode <> 0) GOTO QuitWithRollback
END
DECLARE @CurrentLogin NVARCHAR(128)
SELECT @CurrentLogin = SUSER_SNAME()
DECLARE @jobId BINARY(16)
EXEC @ReturnCode =  msdb.dbo.sp_add_job @job_name=N'SQL_IOCollection',
    @enabled=1,
    @notify_level_eventlog=0,
    @notify_level_email=0,
    @notify_level_netsend=0,
    @notify_level_page=0,
    @delete_level=0,
    @category_name=N'[Uncategorized (Local)]',
    @owner_login_name=@CurrentLogin, @job_id = @jobId OUTPUT
IF (@@ERROR <> 0 OR @ReturnCode <> 0) GOTO QuitWithRollback
EXEC @ReturnCode = msdb.dbo.sp_add_jobstep @job_id=@jobId, @step_name=N'Check_Status',
    @step_id=1,
    @cmdexec_success_code=0,
    @on_success_action=1,
    @on_success_step_id=0,
    @on_fail_action=2,
    @on_fail_step_id=0,
    @retry_attempts=0,
    @retry_interval=0,
    @os_run_priority=0, @subsystem=N'TSQL',
    @command=N'$jobCommandSql',
    @database_name=@admindb,
    @flags=0
IF (@@ERROR <> 0 OR @ReturnCode <> 0) GOTO QuitWithRollback
EXEC @ReturnCode = msdb.dbo.sp_update_job @job_id = @jobId, @start_step_id = 1
IF (@@ERROR <> 0 OR @ReturnCode <> 0) GOTO QuitWithRollback
EXEC @ReturnCode = msdb.dbo.sp_add_jobschedule @job_id=@jobId, @name=N'EveryMinute',
    @enabled=1,
    @freq_type=4, 
    @freq_interval=1, 
    @freq_subday_type=4, 
    @freq_subday_interval=1, 
    @freq_relative_interval=0, 
    @freq_recurrence_factor=0,
    @active_start_date=20160426,
    @active_end_date=99991231,
    @active_start_time=0,
    @active_end_time=235959
IF (@@ERROR <> 0 OR @ReturnCode <> 0) GOTO QuitWithRollback
EXEC @ReturnCode = msdb.dbo.sp_add_jobserver @job_id = @jobId, @server_name = N'(local)'
IF (@@ERROR <> 0 OR @ReturnCode <> 0) GOTO QuitWithRollback
COMMIT TRANSACTION
GOTO EndSave
QuitWithRollback:
IF (@@TRANCOUNT > 0) ROLLBACK TRANSACTION
EndSave:
"@

    try {
        Run-Query -server $server -query $deployScript -NoResults
        Write-Host "→ Successfully deployed to $server" -ForegroundColor Green
        Write-Host "→ Collection will run for $collectiontime minutes" -ForegroundColor Green
        $processedCount++
    } catch {
        try {
            $debugFile = Join-Path $outputpath ("deploy_debug_{0}_{1}.sql" -f $serverClean, (Get-Date -Format "yyyyMMdd_HHmmss"))
            $deployScript | Out-File -FilePath $debugFile -Encoding utf8
            Write-Host "Deploy debug SQL written to: $debugFile" -ForegroundColor Yellow
        } catch {
            Write-Host "Deploy debug SQL could not be written: $($_.Exception.Message)" -ForegroundColor Yellow
        }
        Write-Host "Failed to deploy to $server : $($_.Exception.Message)" -ForegroundColor Red
    }
}

# Summary
Write-Host "`nCompleted. Processed $processedCount server(s)." -ForegroundColor Cyan
if ($export -or $cleanup) {
    Write-Host "Data exported to: $outputpath" -ForegroundColor Cyan
}



