<#
  SSATcollector_launcher.ps1 (V2)
  Auto-detects PowerShell version and runs appropriate collector.
  Supports both plain text server lists and CSV credential files.
#>
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

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Auto-detect: check if SqlServer module supports TrustServerCertificate
$useCompatible = $false
try {
    $cmdInfo = Get-Command Invoke-Sqlcmd -ErrorAction Stop
    $params = $cmdInfo.Parameters
    if (-not $params.ContainsKey('TrustServerCertificate')) {
        $useCompatible = $true
    }
} catch {
    $useCompatible = $true
}

if ($useCompatible) {
    $collector = Join-Path $scriptDir "SSATcollector_compatible.ps1"
    Write-Host "Using compatible version (older PowerShell)" -ForegroundColor Yellow
} else {
    $collector = Join-Path $scriptDir "SSATcollector.ps1"
}

if (-not (Test-Path $collector)) {
    Write-Error "Cannot find collector script: $collector"
    exit 1
}

# Build args to pass through
$passArgs = @{
    serverlist = $serverlist
}

if ($auth) { $passArgs.auth = $auth }
if ($login) { $passArgs.login = $login }
if ($password) { $passArgs.password = $password }
if ($collectiontime) { $passArgs.collectiontime = $collectiontime }
if ($cleanup) { $passArgs.cleanup = $true }
if ($terminate) { $passArgs.terminate = $true }
if ($export) { $passArgs.export = $true }
if ($compress) { $passArgs.compress = $true }
if ($outputpath -ne ".") { $passArgs.outputpath = $outputpath }
if ($database -ne "msdb") { $passArgs.database = $database }
if ($customername) { $passArgs.customername = $customername }

& $collector @passArgs
