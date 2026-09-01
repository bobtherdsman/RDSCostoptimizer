# Kentra SQL Evidence Collector - desktop launcher
# Runs from any directory and resolves package files from $PSScriptRoot.

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$scriptDir = $PSScriptRoot

$colors = @{
    Ink = [System.Drawing.Color]::FromArgb(28, 33, 39)
    Muted = [System.Drawing.Color]::FromArgb(88, 99, 111)
    Panel = [System.Drawing.Color]::FromArgb(239, 244, 250)
    Card = [System.Drawing.Color]::White
    Border = [System.Drawing.Color]::FromArgb(218, 225, 233)
    Accent = [System.Drawing.Color]::FromArgb(28, 118, 196)
    AccentDark = [System.Drawing.Color]::FromArgb(20, 55, 96)
    Cyan = [System.Drawing.Color]::FromArgb(22, 148, 166)
    Violet = [System.Drawing.Color]::FromArgb(111, 78, 168)
    Amber = [System.Drawing.Color]::FromArgb(222, 142, 38)
    Rose = [System.Drawing.Color]::FromArgb(198, 68, 102)
    Mint = [System.Drawing.Color]::FromArgb(32, 151, 119)
    Success = [System.Drawing.Color]::FromArgb(24, 150, 96)
    Warning = [System.Drawing.Color]::FromArgb(205, 122, 24)
    Danger = [System.Drawing.Color]::FromArgb(190, 58, 70)
}

function New-Font {
    param(
        [float]$Size,
        [System.Drawing.FontStyle]$Style = [System.Drawing.FontStyle]::Regular
    )
    return New-Object System.Drawing.Font("Segoe UI", $Size, $Style)
}

function Add-Label {
    param(
        [System.Windows.Forms.Control]$Parent,
        [string]$Text,
        [int]$X,
        [int]$Y,
        [int]$W,
        [int]$H = 20,
        [float]$Size = 9,
        [System.Drawing.Color]$Color = $colors.Ink,
        [System.Drawing.FontStyle]$Style = [System.Drawing.FontStyle]::Regular
    )
    $label = New-Object System.Windows.Forms.Label
    $label.Text = $Text
    $label.Location = New-Object System.Drawing.Point($X, $Y)
    $label.Size = New-Object System.Drawing.Size($W, $H)
    $label.Font = New-Font $Size $Style
    $label.ForeColor = $Color
    $Parent.Controls.Add($label)
    return $label
}

function Add-Card {
    param(
        [System.Windows.Forms.Control]$Parent,
        [int]$X,
        [int]$Y,
        [int]$W,
        [int]$H,
        [System.Drawing.Color]$AccentColor = $colors.Accent
    )
    $panel = New-Object System.Windows.Forms.Panel
    $panel.Location = New-Object System.Drawing.Point($X, $Y)
    $panel.Size = New-Object System.Drawing.Size($W, $H)
    $panel.BackColor = $colors.Card
    $panel.BorderStyle = "FixedSingle"
    $Parent.Controls.Add($panel)

    $stripe = New-Object System.Windows.Forms.Panel
    $stripe.Location = New-Object System.Drawing.Point(0, 0)
    $stripe.Size = New-Object System.Drawing.Size(7, $H)
    $stripe.BackColor = $AccentColor
    $panel.Controls.Add($stripe)

    return $panel
}

function Add-Textbox {
    param(
        [System.Windows.Forms.Control]$Parent,
        [int]$X,
        [int]$Y,
        [int]$W,
        [string]$Text = "",
        [bool]$Password = $false
    )
    $textBox = New-Object System.Windows.Forms.TextBox
    $textBox.Location = New-Object System.Drawing.Point($X, $Y)
    $textBox.Size = New-Object System.Drawing.Size($W, 24)
    $textBox.Font = New-Font 9
    $textBox.Text = $Text
    $textBox.UseSystemPasswordChar = $Password
    $Parent.Controls.Add($textBox)
    return $textBox
}

function Add-Button {
    param(
        [System.Windows.Forms.Control]$Parent,
        [string]$Text,
        [int]$X,
        [int]$Y,
        [int]$W,
        [int]$H,
        [System.Drawing.Color]$BackColor,
        [System.Drawing.Color]$ForeColor = [System.Drawing.Color]::White
    )
    $button = New-Object System.Windows.Forms.Button
    $button.Text = $Text
    $button.Location = New-Object System.Drawing.Point($X, $Y)
    $button.Size = New-Object System.Drawing.Size($W, $H)
    $button.FlatStyle = "Flat"
    $button.FlatAppearance.BorderSize = 0
    $button.BackColor = $BackColor
    $button.ForeColor = $ForeColor
    $button.Font = New-Font 9 ([System.Drawing.FontStyle]::Bold)
    $Parent.Controls.Add($button)
    return $button
}

$form = New-Object System.Windows.Forms.Form
$form.Text = "Kentra SQL Evidence Collector"
$form.Size = New-Object System.Drawing.Size(940, 760)
$form.MinimumSize = New-Object System.Drawing.Size(940, 760)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.BackColor = $colors.Panel
$form.Font = New-Font 9

$header = New-Object System.Windows.Forms.Panel
$header.Location = New-Object System.Drawing.Point(0, 0)
$header.Size = New-Object System.Drawing.Size(940, 92)
$header.BackColor = [System.Drawing.Color]::FromArgb(16, 47, 82)
$form.Controls.Add($header)

$headerAccent = New-Object System.Windows.Forms.Panel
$headerAccent.Location = New-Object System.Drawing.Point(0, 0)
$headerAccent.Size = New-Object System.Drawing.Size(940, 7)
$headerAccent.BackColor = $colors.Amber
$header.Controls.Add($headerAccent)

$brandDot1 = New-Object System.Windows.Forms.Panel
$brandDot1.Location = New-Object System.Drawing.Point(24, 24)
$brandDot1.Size = New-Object System.Drawing.Size(12, 12)
$brandDot1.BackColor = $colors.Cyan
$header.Controls.Add($brandDot1)

$brandDot2 = New-Object System.Windows.Forms.Panel
$brandDot2.Location = New-Object System.Drawing.Point(40, 24)
$brandDot2.Size = New-Object System.Drawing.Size(12, 12)
$brandDot2.BackColor = $colors.Amber
$header.Controls.Add($brandDot2)

$brandDot3 = New-Object System.Windows.Forms.Panel
$brandDot3.Location = New-Object System.Drawing.Point(56, 24)
$brandDot3.Size = New-Object System.Drawing.Size(12, 12)
$brandDot3.BackColor = $colors.Rose
$header.Controls.Add($brandDot3)

Add-Label $header "Kentra SQL Evidence Collector" 82 16 420 30 16 ([System.Drawing.Color]::White) ([System.Drawing.FontStyle]::Bold) | Out-Null
Add-Label $header "Collect, export, and package SQL Server evidence for RDS workload optimization." 84 51 650 22 9 ([System.Drawing.Color]::FromArgb(218, 233, 247)) | Out-Null

$lblReady = Add-Label $header "READY" 812 25 82 26 10 ([System.Drawing.Color]::White) ([System.Drawing.FontStyle]::Bold)
$lblReady.TextAlign = "MiddleCenter"
$lblReady.BackColor = $colors.Success

$sourceCard = Add-Card $form 22 112 575 168 $colors.Cyan
Add-Label $sourceCard "1. Source and authentication" 18 14 300 24 11 $colors.Ink ([System.Drawing.FontStyle]::Bold) | Out-Null
Add-Label $sourceCard "Choose how the collector should connect and where the server list lives." 18 39 480 18 8.5 $colors.Muted | Out-Null

Add-Label $sourceCard "Authentication" 18 72 116 20 9 $colors.Muted | Out-Null
$cmbAuth = New-Object System.Windows.Forms.ComboBox
$cmbAuth.Items.AddRange(@("Windows (W)", "SQL Server (S)", "From CSV File"))
$cmbAuth.SelectedIndex = 1
$cmbAuth.Location = New-Object System.Drawing.Point(140, 69)
$cmbAuth.Size = New-Object System.Drawing.Size(170, 24)
$cmbAuth.DropDownStyle = "DropDownList"
$sourceCard.Controls.Add($cmbAuth)

Add-Label $sourceCard "Server list" 18 108 116 20 9 $colors.Muted | Out-Null
$txtServer = Add-Textbox $sourceCard 140 105 360
$btnBrowse = Add-Button $sourceCard "Browse" 508 103 48 28 $colors.Cyan
Add-Label $sourceCard "Server name, comma list, TXT list, or CSV credentials file." 140 132 385 18 8 $colors.Muted | Out-Null

Add-Label $sourceCard "Login" 327 72 42 20 9 $colors.Muted | Out-Null
$txtLogin = Add-Textbox $sourceCard 371 69 84
Add-Label $sourceCard "Password" 462 72 64 20 9 $colors.Muted | Out-Null
$txtPassword = Add-Textbox $sourceCard 526 69 30 "" $true

$runCard = Add-Card $form 22 296 575 150 $colors.Violet
Add-Label $runCard "2. Collection settings" 18 14 300 24 11 $colors.Ink ([System.Drawing.FontStyle]::Bold) | Out-Null
Add-Label $runCard "Set the run length and SQL admin database used by Invoke-Sqlcmd." 18 39 480 18 8.5 $colors.Muted | Out-Null

Add-Label $runCard "Collection minutes" 18 79 120 20 9 $colors.Muted | Out-Null
$txtTime = Add-Textbox $runCard 145 76 80 "60"
Add-Label $runCard "Admin database" 260 79 105 20 9 $colors.Muted | Out-Null
$txtDB = Add-Textbox $runCard 370 76 100 "msdb"

$chkCostOptimization = New-Object System.Windows.Forms.CheckBox
$chkCostOptimization.Text = "Enable Cost Optimization diagnostics"
$chkCostOptimization.Location = New-Object System.Drawing.Point(18, 114)
$chkCostOptimization.Size = New-Object System.Drawing.Size(260, 24)
$chkCostOptimization.Font = New-Font 9 ([System.Drawing.FontStyle]::Bold)
$chkCostOptimization.ForeColor = $colors.Ink
$chkCostOptimization.Checked = $false
$chkCostOptimization.BackColor = [System.Drawing.Color]::FromArgb(244, 239, 255)
$runCard.Controls.Add($chkCostOptimization)
Add-Label $runCard "Off preserves original metrics. On adds verified per-minute memory, file I/O, tempdb, edition, and manifest evidence." 286 116 270 28 8 $colors.Muted | Out-Null

$outputCard = Add-Card $form 22 462 575 134 $colors.Mint
Add-Label $outputCard "3. Output package" 18 14 300 24 11 $colors.Ink ([System.Drawing.FontStyle]::Bold) | Out-Null
Add-Label $outputCard "Choose where exports and ZIP packages should be written." 18 39 480 18 8.5 $colors.Muted | Out-Null

Add-Label $outputCard "Customer name" 18 72 116 20 9 $colors.Muted | Out-Null
$txtCustomer = Add-Textbox $outputCard 140 69 154
Add-Label $outputCard "Output folder" 18 104 116 20 9 $colors.Muted | Out-Null
$txtOutput = Add-Textbox $outputCard 140 101 360 $scriptDir
$btnOutputBrowse = Add-Button $outputCard "Browse" 508 99 48 28 $colors.Mint

$actionCard = Add-Card $form 620 112 286 302 $colors.Amber
$actionCard.BackColor = [System.Drawing.Color]::FromArgb(255, 251, 244)
Add-Label $actionCard "Run commands" 18 16 220 24 12 $colors.Ink ([System.Drawing.FontStyle]::Bold) | Out-Null
Add-Label $actionCard "Use collection first, then export when the run has finished." 18 42 238 36 8.5 $colors.Muted | Out-Null

$btnStart = Add-Button $actionCard "Start collection" 18 86 250 42 ([System.Drawing.Color]::FromArgb(22, 130, 214))
$btnExport = Add-Button $actionCard "Export and ZIP" 18 140 250 42 $colors.Mint
$btnTerminate = Add-Button $actionCard "Terminate run" 18 194 118 38 $colors.Warning
$btnCleanup = Add-Button $actionCard "Cleanup" 150 194 118 38 $colors.Danger
$btnClose = Add-Button $actionCard "Close" 18 247 250 36 ([System.Drawing.Color]::FromArgb(98, 108, 119))

$noteCard = Add-Card $form 620 430 286 166 $colors.Rose
$noteCard.BackColor = [System.Drawing.Color]::FromArgb(255, 247, 249)
Add-Label $noteCard "Operational notes" 18 14 220 24 11 $colors.Ink ([System.Drawing.FontStyle]::Bold) | Out-Null
Add-Label $noteCard "Cost Optimization diagnostics are opt-in and default off." 18 48 238 34 8.5 $colors.Muted | Out-Null
Add-Label $noteCard "Cleanup exports and zips data, then removes collector-owned tables and the SQL_IOCollection job." 18 88 238 52 8.5 $colors.Muted | Out-Null

$noteChip = Add-Label $noteCard "SAFE DEFAULT" 170 17 84 22 8 ([System.Drawing.Color]::White) ([System.Drawing.FontStyle]::Bold)
$noteChip.TextAlign = "MiddleCenter"
$noteChip.BackColor = $colors.Rose

$logCard = Add-Card $form 22 612 884 96 $colors.Accent
Add-Label $logCard "Activity log" 14 9 140 18 9 $colors.Accent ([System.Drawing.FontStyle]::Bold) | Out-Null
$txtLog = New-Object System.Windows.Forms.TextBox
$txtLog.Location = New-Object System.Drawing.Point(14, 30)
$txtLog.Size = New-Object System.Drawing.Size(856, 52)
$txtLog.Multiline = $true
$txtLog.ScrollBars = "Vertical"
$txtLog.ReadOnly = $true
$txtLog.BorderStyle = "FixedSingle"
$txtLog.Font = New-Object System.Drawing.Font("Consolas", 8.5)
$txtLog.BackColor = [System.Drawing.Color]::FromArgb(17, 24, 31)
$txtLog.ForeColor = [System.Drawing.Color]::FromArgb(216, 230, 242)
$logCard.Controls.Add($txtLog)

function Write-Log {
    param([object]$Message)
    $txtLog.AppendText("$(Get-Date -Format 'HH:mm:ss') $Message`r`n")
    $txtLog.SelectionStart = $txtLog.TextLength
    $txtLog.ScrollToCaret()
    $form.Refresh()
}

function Set-Status {
    param(
        [string]$Text,
        [System.Drawing.Color]$BackColor
    )
    $lblReady.Text = $Text
    $lblReady.BackColor = $BackColor
    $form.Refresh()
}

function Resolve-OutputDirectory {
    $selectedOutput = $txtOutput.Text.Trim()
    $outputDir = $selectedOutput
    $custName = $txtCustomer.Text.Trim()

    if ($custName) {
        $selectedLeaf = Split-Path -Leaf $selectedOutput
        if ($selectedLeaf -ne $custName) {
            $outputDir = Join-Path $selectedOutput $custName
        }
    }

    if (-not (Test-Path $outputDir)) {
        New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
    }

    return $outputDir
}

function Resolve-ServerList {
    $serverText = $txtServer.Text.Trim()
    if (-not $serverText) {
        throw "Server list is required."
    }

    if (Test-Path $serverText) {
        return $serverText
    }

    $tempFile = Join-Path $env:TEMP "kentra_servers_$(Get-Date -Format 'yyyyMMddHHmmss').txt"
    $serverText -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Out-File $tempFile -Encoding utf8
    return $tempFile
}

function Run-Collector {
    param([string]$Mode)

    try {
        Set-Status "RUNNING" $colors.Warning

        $launcherScript = Join-Path $scriptDir "SSATcollector_launcher.ps1"
        if (-not (Test-Path $launcherScript)) {
            throw "SSATcollector_launcher.ps1 not found in $scriptDir"
        }

        $isCSVMode = $cmbAuth.SelectedIndex -eq 2
        $authVal = if ($cmbAuth.SelectedIndex -eq 0) { "w" } elseif ($cmbAuth.SelectedIndex -eq 1) { "s" } else { $null }

        $params = @{
            serverlist = Resolve-ServerList
            database = $txtDB.Text.Trim().ToLower()
            outputpath = Resolve-OutputDirectory
        }

        if ($authVal) {
            $params.auth = $authVal
        }

        if ($authVal -eq "s") {
            if (-not $txtLogin.Text -or $txtLogin.Text -eq "(from CSV)") {
                throw "Login is required for SQL Server authentication."
            }
            if (-not $txtPassword.Text -or $txtPassword.Text -eq "(from CSV)") {
                throw "Password is required for SQL Server authentication."
            }
            $params.login = $txtLogin.Text
            $params.password = $txtPassword.Text
        }

        if ($isCSVMode) {
            Write-Log "CSV credential mode selected."
        }

        if ($chkCostOptimization.Checked) {
            $params.costoptimization = $true
            Write-Log "Cost Optimization diagnostics enabled."
        }

        switch ($Mode) {
            "collect" {
                $time = [int]$txtTime.Text
                if ($time -lt 1) {
                    throw "Collection minutes must be at least 1."
                }
                $params.collectiontime = $time
                Write-Log "Starting collection for $time minute(s)."
            }
            "export" {
                $params.export = $true
                $params.compress = $true
                Write-Log "Exporting and creating ZIP package."
            }
            "terminate" {
                $params.terminate = $true
                Write-Log "Terminating active collection."
            }
            "cleanup" {
                $params.cleanup = $true
                $params.compress = $true
                Write-Log "Exporting, zipping, and cleaning collector artifacts."
            }
        }

        Write-Log "Running launcher with parameters: $($params.Keys -join ', ')"
        & $launcherScript @params 2>&1 | ForEach-Object { Write-Log $_ }
        Set-Status "READY" $colors.Success
        Write-Log "Completed."
    } catch {
        Set-Status "ERROR" $colors.Danger
        Write-Log "ERROR: $($_.Exception.Message)"
    }
}

$cmbAuth.Add_SelectedIndexChanged({
    $isSql = $cmbAuth.SelectedIndex -eq 1
    $isCSV = $cmbAuth.SelectedIndex -eq 2

    $txtLogin.Enabled = $isSql
    $txtPassword.Enabled = $isSql

    if ($isCSV) {
        $txtLogin.Text = "(from CSV)"
        $txtPassword.Text = "(from CSV)"
    } elseif (-not $isSql) {
        $txtLogin.Text = ""
        $txtPassword.Text = ""
    } elseif ($txtLogin.Text -eq "(from CSV)") {
        $txtLogin.Text = ""
        $txtPassword.Text = ""
    }
})

$btnBrowse.Add_Click({
    $dlg = New-Object System.Windows.Forms.OpenFileDialog
    $dlg.Filter = "Server files (*.txt;*.csv)|*.txt;*.csv|CSV credentials (*.csv)|*.csv|Text files (*.txt)|*.txt|All files (*.*)|*.*"
    $dlg.Title = "Select server list or credentials CSV"
    if ($dlg.ShowDialog() -eq "OK") {
        $txtServer.Text = $dlg.FileName
    }
})

$btnOutputBrowse.Add_Click({
    $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
    $dlg.Description = "Select output folder"
    if ($dlg.ShowDialog() -eq "OK") {
        $txtOutput.Text = $dlg.SelectedPath
    }
})

$btnStart.Add_Click({ Run-Collector -Mode "collect" })
$btnExport.Add_Click({ Run-Collector -Mode "export" })
$btnTerminate.Add_Click({
    $confirm = [System.Windows.Forms.MessageBox]::Show(
        "Terminate the active collection job?",
        "Confirm termination",
        [System.Windows.Forms.MessageBoxButtons]::YesNo,
        [System.Windows.Forms.MessageBoxIcon]::Warning
    )
    if ($confirm -eq "Yes") {
        Run-Collector -Mode "terminate"
    }
})
$btnCleanup.Add_Click({
    $confirm = [System.Windows.Forms.MessageBox]::Show(
        "Cleanup exports and zips data, then removes collector-owned tables and the SQL_IOCollection job. Continue?",
        "Confirm cleanup",
        [System.Windows.Forms.MessageBoxButtons]::YesNo,
        [System.Windows.Forms.MessageBoxIcon]::Warning
    )
    if ($confirm -eq "Yes") {
        Run-Collector -Mode "cleanup"
    }
})
$btnClose.Add_Click({ $form.Close() })

Write-Log "Launcher ready."
Write-Log "Package path: $scriptDir"
$form.ShowDialog() | Out-Null
