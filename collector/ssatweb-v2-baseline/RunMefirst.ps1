# RunMefirst.ps1 - SSAT Collector GUI Launcher
# Runs from any directory - uses $PSScriptRoot for all paths

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$scriptDir = $PSScriptRoot

$form = New-Object System.Windows.Forms.Form
$form.Text = "SSAT Collector V2 - SQL Server Assessment Tool"
$form.Size = New-Object System.Drawing.Size(620, 720)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false

# Auth Type
$lblAuth = New-Object System.Windows.Forms.Label
$lblAuth.Text = "Authentication:"
$lblAuth.Location = New-Object System.Drawing.Point(20, 20)
$lblAuth.Size = New-Object System.Drawing.Size(120, 20)
$form.Controls.Add($lblAuth)

$cmbAuth = New-Object System.Windows.Forms.ComboBox
$cmbAuth.Items.AddRange(@("Windows (W)", "SQL Server (S)", "From CSV File"))
$cmbAuth.SelectedIndex = 1
$cmbAuth.Location = New-Object System.Drawing.Point(150, 18)
$cmbAuth.Size = New-Object System.Drawing.Size(200, 20)
$cmbAuth.DropDownStyle = "DropDownList"
$form.Controls.Add($cmbAuth)

# Server List
$lblServer = New-Object System.Windows.Forms.Label
$lblServer.Text = "Server(s):"
$lblServer.Location = New-Object System.Drawing.Point(20, 55)
$lblServer.Size = New-Object System.Drawing.Size(120, 20)
$form.Controls.Add($lblServer)

$txtServer = New-Object System.Windows.Forms.TextBox
$txtServer.Location = New-Object System.Drawing.Point(150, 53)
$txtServer.Size = New-Object System.Drawing.Size(340, 20)
$txtServer.Text = ""
$form.Controls.Add($txtServer)

$btnBrowse = New-Object System.Windows.Forms.Button
$btnBrowse.Text = "..."
$btnBrowse.Location = New-Object System.Drawing.Point(495, 52)
$btnBrowse.Size = New-Object System.Drawing.Size(30, 22)
$form.Controls.Add($btnBrowse)

$lblServerHint = New-Object System.Windows.Forms.Label
$lblServerHint.Text = "Server name, servers.txt, or CSV credentials file (ServerName,Auth,Login,Password,Database)"
$lblServerHint.Location = New-Object System.Drawing.Point(150, 76)
$lblServerHint.Size = New-Object System.Drawing.Size(400, 15)
$lblServerHint.Font = New-Object System.Drawing.Font("Segoe UI", 7.5)
$lblServerHint.ForeColor = [System.Drawing.Color]::Gray
$form.Controls.Add($lblServerHint)

# Login
$lblLogin = New-Object System.Windows.Forms.Label
$lblLogin.Text = "Login:"
$lblLogin.Location = New-Object System.Drawing.Point(20, 100)
$lblLogin.Size = New-Object System.Drawing.Size(120, 20)
$form.Controls.Add($lblLogin)

$txtLogin = New-Object System.Windows.Forms.TextBox
$txtLogin.Location = New-Object System.Drawing.Point(150, 98)
$txtLogin.Size = New-Object System.Drawing.Size(200, 20)
$form.Controls.Add($txtLogin)

# Password
$lblPassword = New-Object System.Windows.Forms.Label
$lblPassword.Text = "Password:"
$lblPassword.Location = New-Object System.Drawing.Point(20, 135)
$lblPassword.Size = New-Object System.Drawing.Size(120, 20)
$form.Controls.Add($lblPassword)

$txtPassword = New-Object System.Windows.Forms.TextBox
$txtPassword.Location = New-Object System.Drawing.Point(150, 133)
$txtPassword.Size = New-Object System.Drawing.Size(200, 20)
$txtPassword.UseSystemPasswordChar = $true
$form.Controls.Add($txtPassword)

# Collection Time
$lblTime = New-Object System.Windows.Forms.Label
$lblTime.Text = "Collection Time (min):"
$lblTime.Location = New-Object System.Drawing.Point(20, 170)
$lblTime.Size = New-Object System.Drawing.Size(120, 20)
$form.Controls.Add($lblTime)

$txtTime = New-Object System.Windows.Forms.TextBox
$txtTime.Location = New-Object System.Drawing.Point(150, 168)
$txtTime.Size = New-Object System.Drawing.Size(80, 20)
$txtTime.Text = "60"
$form.Controls.Add($txtTime)

# Database
$lblDB = New-Object System.Windows.Forms.Label
$lblDB.Text = "Admin Database:"
$lblDB.Location = New-Object System.Drawing.Point(270, 170)
$lblDB.Size = New-Object System.Drawing.Size(100, 20)
$form.Controls.Add($lblDB)

$txtDB = New-Object System.Windows.Forms.TextBox
$txtDB.Location = New-Object System.Drawing.Point(380, 168)
$txtDB.Size = New-Object System.Drawing.Size(100, 20)
$txtDB.Text = "msdb"
$form.Controls.Add($txtDB)

# Customer Name
$lblCustomer = New-Object System.Windows.Forms.Label
$lblCustomer.Text = "Customer Name:"
$lblCustomer.Location = New-Object System.Drawing.Point(20, 205)
$lblCustomer.Size = New-Object System.Drawing.Size(120, 20)
$form.Controls.Add($lblCustomer)

$txtCustomer = New-Object System.Windows.Forms.TextBox
$txtCustomer.Location = New-Object System.Drawing.Point(150, 203)
$txtCustomer.Size = New-Object System.Drawing.Size(200, 20)
$txtCustomer.Text = ""
$form.Controls.Add($txtCustomer)

$lblCustomerHint = New-Object System.Windows.Forms.Label
$lblCustomerHint.Text = "Used in output folder and ZIP filename"
$lblCustomerHint.Location = New-Object System.Drawing.Point(360, 207)
$lblCustomerHint.Size = New-Object System.Drawing.Size(220, 15)
$lblCustomerHint.Font = New-Object System.Drawing.Font("Segoe UI", 7.5)
$lblCustomerHint.ForeColor = [System.Drawing.Color]::Gray
$form.Controls.Add($lblCustomerHint)

# Output Path
$lblOutput = New-Object System.Windows.Forms.Label
$lblOutput.Text = "Output Path:"
$lblOutput.Location = New-Object System.Drawing.Point(20, 240)
$lblOutput.Size = New-Object System.Drawing.Size(120, 20)
$form.Controls.Add($lblOutput)

$txtOutput = New-Object System.Windows.Forms.TextBox
$txtOutput.Location = New-Object System.Drawing.Point(150, 238)
$txtOutput.Size = New-Object System.Drawing.Size(340, 20)
$txtOutput.Text = $scriptDir
$form.Controls.Add($txtOutput)

$btnOutputBrowse = New-Object System.Windows.Forms.Button
$btnOutputBrowse.Text = "..."
$btnOutputBrowse.Location = New-Object System.Drawing.Point(495, 237)
$btnOutputBrowse.Size = New-Object System.Drawing.Size(30, 22)
$form.Controls.Add($btnOutputBrowse)

# (Options handled by buttons directly)

# Buttons
$btnStart = New-Object System.Windows.Forms.Button
$btnStart.Text = "Start Collection"
$btnStart.Location = New-Object System.Drawing.Point(20, 315)
$btnStart.Size = New-Object System.Drawing.Size(140, 35)
$btnStart.BackColor = [System.Drawing.Color]::FromArgb(255, 153, 0)
$btnStart.ForeColor = [System.Drawing.Color]::White
$btnStart.FlatStyle = "Flat"
$btnStart.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
$form.Controls.Add($btnStart)

$btnExport = New-Object System.Windows.Forms.Button
$btnExport.Text = "Export && ZIP"
$btnExport.Location = New-Object System.Drawing.Point(170, 315)
$btnExport.Size = New-Object System.Drawing.Size(120, 35)
$btnExport.FlatStyle = "Flat"
$form.Controls.Add($btnExport)

$btnTerminate = New-Object System.Windows.Forms.Button
$btnTerminate.Text = "Terminate"
$btnTerminate.Location = New-Object System.Drawing.Point(300, 315)
$btnTerminate.Size = New-Object System.Drawing.Size(100, 35)
$btnTerminate.FlatStyle = "Flat"
$form.Controls.Add($btnTerminate)

$btnCleanup = New-Object System.Windows.Forms.Button
$btnCleanup.Text = "Cleanup"
$btnCleanup.Location = New-Object System.Drawing.Point(410, 315)
$btnCleanup.Size = New-Object System.Drawing.Size(100, 35)
$btnCleanup.FlatStyle = "Flat"
$form.Controls.Add($btnCleanup)

$btnClose = New-Object System.Windows.Forms.Button
$btnClose.Text = "Close"
$btnClose.Location = New-Object System.Drawing.Point(520, 315)
$btnClose.Size = New-Object System.Drawing.Size(60, 35)
$btnClose.FlatStyle = "Flat"
$form.Controls.Add($btnClose)

# Status Log
$lblLog = New-Object System.Windows.Forms.Label
$lblLog.Text = "Status:"
$lblLog.Location = New-Object System.Drawing.Point(20, 365)
$lblLog.Size = New-Object System.Drawing.Size(120, 20)
$form.Controls.Add($lblLog)

$txtLog = New-Object System.Windows.Forms.TextBox
$txtLog.Location = New-Object System.Drawing.Point(20, 385)
$txtLog.Size = New-Object System.Drawing.Size(560, 250)
$txtLog.Multiline = $true
$txtLog.ScrollBars = "Vertical"
$txtLog.ReadOnly = $true
$txtLog.Font = New-Object System.Drawing.Font("Consolas", 8.5)
$form.Controls.Add($txtLog)

# Helper function to log
function Write-Log($msg) {
    $txtLog.AppendText("$(Get-Date -Format 'HH:mm:ss') $msg`r`n")
    $txtLog.SelectionStart = $txtLog.TextLength
    $txtLog.ScrollToCaret()
    $form.Refresh()
}

# Helper function to build and run command
function Run-Collector {
    param([string]$mode)
    
    $server = $txtServer.Text.Trim()
    if (-not $server) { Write-Log "ERROR: Server list is required"; return }
    
    $isCSVMode = $cmbAuth.SelectedIndex -eq 2
    $authVal = if ($cmbAuth.SelectedIndex -eq 0) { "w" } elseif ($cmbAuth.SelectedIndex -eq 1) { "s" } else { $null }
    
    # Determine script to use via launcher logic
    $launcherScript = Join-Path $scriptDir "SSATcollector_launcher.ps1"
    if (-not (Test-Path $launcherScript)) {
        Write-Log "ERROR: SSATcollector_launcher.ps1 not found in $scriptDir"
        return
    }
    
    # Build serverlist - if it's a file path, use it; otherwise create temp file
    $serverlistParam = $server
    if (-not (Test-Path $server)) {
        $tempFile = Join-Path $env:TEMP "ssat_servers_$(Get-Date -Format 'yyyyMMddHHmmss').txt"
        $server -split ',' | ForEach-Object { $_.Trim() } | Out-File $tempFile -Encoding utf8
        $serverlistParam = $tempFile
    }
    
    # Build parameters
    $params = @{
        serverlist = $serverlistParam
    }
    
    if ($authVal) { $params.auth = $authVal }
    
    if ($authVal -eq "s") {
        if (-not $txtLogin.Text -or $txtLogin.Text -eq "(from CSV)") { Write-Log "ERROR: Login required for SQL auth"; return }
        if (-not $txtPassword.Text -or $txtPassword.Text -eq "(from CSV)") { Write-Log "ERROR: Password required for SQL auth"; return }
        $params.login = $txtLogin.Text
        $params.password = $txtPassword.Text
    }
    
    if ($isCSVMode) {
        Write-Log "Multi-credential mode: reading per-server auth from CSV"
    }
    
    $params.database = $txtDB.Text.ToLower()
    
    # Create customer directory if customer name provided
    $outputDir = $txtOutput.Text
    $custName = $txtCustomer.Text.Trim()
    if ($custName) {
        $outputDir = Join-Path $txtOutput.Text $custName
        if (-not (Test-Path $outputDir)) { New-Item -ItemType Directory -Path $outputDir -Force | Out-Null }
    }
    $params.outputpath = $outputDir
    
    switch ($mode) {
        "collect" {
            $time = [int]$txtTime.Text
            if ($time -lt 1) { Write-Log "ERROR: Collection time must be >= 1"; return }
            $params.collectiontime = $time
            Write-Log "Starting collection for $time minutes..."
        }
        "export" {
            $params.export = $true
            $params.compress = $true
            Write-Log "Exporting and compressing data..."
        }
        "terminate" {
            $params.terminate = $true
            Write-Log "Terminating collection..."
        }
        "cleanup" {
            $params.cleanup = $true
            $params.compress = $true
            Write-Log "Exporting, compressing, and cleaning up..."
        }
    }
    
    Write-Log "Running: SSATcollector_launcher.ps1 with params: $($params.Keys -join ', ')"
    
    try {
        & $launcherScript @params 2>&1 | ForEach-Object { Write-Log $_ }
        Write-Log "--- Completed ---"
    } catch {
        Write-Log "ERROR: $($_.Exception.Message)"
    }
}

# Event handlers
$cmbAuth.Add_SelectedIndexChanged({
    $isSql = $cmbAuth.SelectedIndex -eq 1
    $isCSV = $cmbAuth.SelectedIndex -eq 2
    $txtLogin.Enabled = $isSql
    $txtPassword.Enabled = $isSql
    if ($isCSV) {
        $txtLogin.Enabled = $false
        $txtPassword.Enabled = $false
        $txtLogin.Text = "(from CSV)"
        $txtPassword.Text = "(from CSV)"
    }
})

$btnBrowse.Add_Click({
    $dlg = New-Object System.Windows.Forms.OpenFileDialog
    $dlg.Filter = "Server files (*.txt;*.csv)|*.txt;*.csv|CSV credentials (*.csv)|*.csv|Text files (*.txt)|*.txt|All files (*.*)|*.*"
    $dlg.Title = "Select Server List or Credentials CSV"
    if ($dlg.ShowDialog() -eq "OK") { $txtServer.Text = $dlg.FileName }
})

$btnOutputBrowse.Add_Click({
    $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
    $dlg.Description = "Select Output Directory"
    if ($dlg.ShowDialog() -eq "OK") { $txtOutput.Text = $dlg.SelectedPath }
})

$btnStart.Add_Click({ Run-Collector -mode "collect" })
$btnExport.Add_Click({ Run-Collector -mode "export" })
$btnTerminate.Add_Click({
    $confirm = [System.Windows.Forms.MessageBox]::Show("Are you sure you want to terminate the running collection?", "Confirm Terminate", [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Warning)
    if ($confirm -eq "Yes") { Run-Collector -mode "terminate" }
})
$btnCleanup.Add_Click({
    $confirm = [System.Windows.Forms.MessageBox]::Show("This will export data, compress to ZIP, then remove all collection tables and jobs. Are you sure?", "Confirm Cleanup", [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Warning)
    if ($confirm -eq "Yes") { Run-Collector -mode "cleanup" }
})

$btnClose.Add_Click({ $form.Close() })

# Show form
Write-Log "SSAT Collector GUI Ready"
Write-Log "Script directory: $scriptDir"
$form.ShowDialog() | Out-Null
