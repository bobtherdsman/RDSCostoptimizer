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
    $serverCredentials += [PSCustomObject]@{ ServerName=$serverlist; Auth=$auth; Login=$login; Password=$password; Database=$database }
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
            }
        }
        Write-Host "Multi-credential mode: $($serverCredentials.Count) servers from CSV" -ForegroundColor Cyan
    } else {
        # Plain text - one server per line (original behavior)
        if (-not $auth) { Write-Error "-auth is required for plain text server list"; exit 1 }
        if ($auth -eq "s" -and (-not $login -or -not $password)) { Write-Error "SQL auth requires -login and -password"; exit 1 }
        $lines = Get-Content $serverlist | Where-Object { $_.Trim() -ne "" }
        foreach ($line in $lines) {
            $serverCredentials += [PSCustomObject]@{ ServerName=$line.Trim(); Auth=$auth; Login=$login; Password=$password; Database=$database }
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
            Invoke-Sqlcmd -ServerInstance $server -Database $database -Query $query -QueryTimeout 300 -ErrorAction Stop
        } else {
            Invoke-Sqlcmd -ServerInstance $server -Database $database -Query $query -QueryTimeout 300 -ErrorAction Stop
        }
    } else {
        if ($NoResults) {
            Invoke-Sqlcmd -ServerInstance $server -Database $database -Username $login -Password $password -Query $query -QueryTimeout 300 -ErrorAction Stop
        } else {
            Invoke-Sqlcmd -ServerInstance $server -Database $database -Username $login -Password $password -Query $query -QueryTimeout 300 -ErrorAction Stop
        }
    }
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
                $cpuInfoData = Run-Query -server $server -query "SELECT '$server' as ServerName, cpu_count AS [Logical CPU Count], hyperthread_ratio AS [Hyperthread Ratio], cpu_count/hyperthread_ratio AS [Physical CPU Count], virtual_machine_type_desc AS VM_type, CAST(SERVERPROPERTY('Edition') AS NVARCHAR(128)) AS [SQL Edition], CAST(SERVERPROPERTY('ProductVersion') AS NVARCHAR(128)) AS [SQL Version] FROM sys.dm_os_sys_info WITH (NOLOCK)"
                if ($cpuInfoData) {
                    $cpuInfoFile = Join-Path $outputpath "${serverClean}_CPUINFO_${timestamp}.csv"
                    $cpuInfoData | Export-Csv -Path $cpuInfoFile -NoTypeInformation
                    Write-Host "→ CPU Info exported" -ForegroundColor Green
                    $exportedFiles += $cpuInfoFile
                }
            } catch { Write-Host "→ CPU Info export skipped" -ForegroundColor Gray }
            
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
            try {
                $storageData = Run-Query -server $server -query "SELECT '$server' as ServerName, ISNULL(ROUND(SUM((CAST(size AS BIGINT)*8))/1024.0/1024.0, 2), 0) AS TotalDBSizeGB FROM master.sys.master_files WHERE database_id > 4"
                if ($storageData) {
                    $storageFile = Join-Path $outputpath "${serverClean}_STORAGE_${timestamp}.csv"
                    $storageData | Export-Csv -Path $storageFile -NoTypeInformation
                    Write-Host "→ Storage exported" -ForegroundColor Green
                    $exportedFiles += $storageFile
                }
            } catch { Write-Host "→ Storage export skipped" -ForegroundColor Gray }

            
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
            $cpuInfoData = Run-Query -server $server -query "SELECT '$server' as ServerName, cpu_count AS [Logical CPU Count], hyperthread_ratio AS [Hyperthread Ratio], cpu_count/hyperthread_ratio AS [Physical CPU Count], virtual_machine_type_desc AS VM_type, CAST(SERVERPROPERTY('Edition') AS NVARCHAR(128)) AS [SQL Edition], CAST(SERVERPROPERTY('ProductVersion') AS NVARCHAR(128)) AS [SQL Version] FROM sys.dm_os_sys_info WITH (NOLOCK)"
            if ($cpuInfoData) {
                $cpuInfoFile = Join-Path $outputpath "${serverClean}_CPUINFO_${timestamp}.csv"
                $cpuInfoData | Export-Csv -Path $cpuInfoFile -NoTypeInformation
                Write-Host "→ CPU Info exported" -ForegroundColor Green
                $exportedFiles += $cpuInfoFile
            }
        } catch { Write-Host "→ CPU Info export failed: $($_.Exception.Message)" -ForegroundColor Red }
        
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

-- Create tables
CREATE TABLE SQL_CPUCollection (SqlSerCpuUT int, SystemIdle int, OtherProCpuUT int, Collectiontime datetime)
CREATE TABLE SQL_MemCollection (SQL_CollectionTime Datetime, SQLCurrMemUsageMB decimal(12,2), SQLMaxMemTargetMB int, OSTotalMemoryMB int, OSAVAMemoryMB int, PLE int, StolenServerMem int, MemoryClerksData NVARCHAR(MAX))
CREATE TABLE SQL_CollectionStatus (JobStatus nvarchar(10), SPID int, CollectionStartTime datetime, CollectionEndTime datetime, Max_Sample_ID bigint, Current_Sample_ID bigint)
CREATE TABLE SQL_DBIOTotal (Sample_ID bigint, Database_ID int, DBName nvarchar(400), [Read] bigint, [Written] bigint, BRead bigint, BWritten bigint, Throughput bigint, TotalIOPs bigint, NetPackets bigint, CollectionTime datetime)
CREATE TABLE SQL_DBIO (Sample_ID bigint, Database_ID bigint, DBName nvarchar(400), [Read] bigint, [Written] bigint, BRead bigint, BWritten bigint, TotalB bigint, TotalIOPs bigint, Throuput bigint, Netpackets bigint, CollectionTime datetime)

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
DECLARE @CurrentLogin NVARCHAR(128) = SUSER_SNAME()
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
    @command=N'SET QUOTED_IDENTIFIER ON
GO 
Declare @Current_Sample_ID Bigint
If (Select Max_Sample_ID - Current_Sample_ID  from SQL_CollectionStatus) >  0
BEGIN
    update dbo.SQL_CollectionStatus
    set Current_Sample_ID  = Current_Sample_ID  + 1
    Set @Current_Sample_ID = (Select Current_Sample_ID from SQL_CollectionStatus);
    INSERT dbo.SQL_DBIOTotal
    SELECT
        @Current_Sample_ID,
        d.Database_ID,
        d.name,
        SUM(fs.num_of_reads ),
        SUM(fs.num_of_writes),
        SUM(fs.num_of_bytes_read ),
        SUM(fs.num_of_bytes_written),
        SUM((fs.num_of_bytes_read)+(fs.num_of_bytes_written)) ,
        SUM(fs.num_of_reads + fs.num_of_writes) ,
        (select Sum(net_packet_size) as Total_net_packets_used from sys.dm_exec_connections),
        GETDATE()
    FROM sys.dm_io_virtual_file_stats(default, default) AS fs
    INNER JOIN sys.databases d (NOLOCK) ON d.Database_ID = fs.Database_ID
    WHERE d.name NOT IN (''master'',''model'',''msdb'', ''distribution'', ''ReportServer'',''ReportServerTempDB'')
    and d.state = 0
    GROUP BY d.name, d.Database_ID;
    Insert into SQL_DBIO
    Select @Current_Sample_ID,
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
    from dbo.SQL_DBIOTotal as DR1
    Inner Join dbo.SQL_DBIOTotal as DR2 ON DR1.Database_ID = DR2.Database_ID
    where DR1.Sample_ID = @Current_Sample_ID -1
    and DR2.Sample_ID = @Current_Sample_ID;
END
Else
BEGIN
    update dbo.SQL_CollectionStatus
    set [JobStatus] = ''Finished'',
    [CollectionEndTime] = GETDATE()
    EXEC msdb.dbo.sp_update_job @job_name=N''SQL_IOCollection'',
    @enabled=0
END
go
DECLARE @ts_now bigint = (SELECT ms_ticks FROM sys.dm_os_sys_info WITH (NOLOCK)); 
insert into SQL_CPUCollection
SELECT TOP(1) SQLProcessUtilization AS [SQL Server Process CPU Utilization], 
               SystemIdle AS [System Idle Process], 
               100 - SystemIdle - SQLProcessUtilization AS [Other Process CPU Utilization], 
               DATEADD(ms, -1 * (@ts_now - [timestamp]), GETDATE()) AS [Event Time] 
FROM (SELECT record.value(''(./Record/@id)[1]'', ''int'') AS record_id, 
              record.value(''(./Record/SchedulerMonitorEvent/SystemHealth/SystemIdle)[1]'',''int'') 
                      AS [SystemIdle], 
              record.value(''(./Record/SchedulerMonitorEvent/SystemHealth/ProcessUtilization)[1]'', ''int'') 
                      AS [SQLProcessUtilization], [timestamp] 
         FROM (SELECT [timestamp], CONVERT(xml, record) AS [record] 
                      FROM sys.dm_os_ring_buffers WITH (NOLOCK)
                      WHERE ring_buffer_type = N''RING_BUFFER_SCHEDULER_MONITOR'' 
                      AND record LIKE N''%<SystemHealth>%'') AS x) AS y 
ORDER BY record_id DESC
go
insert into SQL_MemCollection
SELECT  x.*,y.*,z.*,a.*,c.*
FROM 
(SELECT getdate() as collectionTime,(committed_kb/1024) as Commited,(committed_target_kb/1024) as targetcommited FROM sys.dm_os_sys_info) as x,
(SELECT (total_physical_memory_kb/1024) as totalMem,(available_physical_memory_kb/1024) as AvaiMem FROM sys.dm_os_sys_memory) as y,
(SELECT sum(cntr_value)/count(*) as PLE FROM sys.dm_os_performance_counters WHERE counter_name like ''%Page life expectancy%'' AND object_name = ''SQLServer:Buffer Node'') as z,
(SELECT cntr_value/1024 as StolenServerMem FROM sys.dm_os_performance_counters WHERE object_name = ''SQLServer:Memory Manager'' AND counter_name LIKE ''%Stolen Server%'' ) as a,
(SELECT (SELECT TOP 15 [type] AS [ClerkType], SUM(pages_kb) / 1024 AS [SizeMb] FROM sys.dm_os_memory_clerks WITH (NOLOCK) GROUP BY [type] ORDER BY SUM(pages_kb) DESC FOR JSON PATH) as MemoryClerksData) as c',
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
        Write-Host "Failed to deploy to $server : $($_.Exception.Message)" -ForegroundColor Red
    }
}

# Summary
Write-Host "`nCompleted. Processed $processedCount server(s)." -ForegroundColor Cyan
if ($export -or $cleanup) {
    Write-Host "Data exported to: $outputpath" -ForegroundColor Cyan
}
