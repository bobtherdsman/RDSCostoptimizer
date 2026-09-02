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
$form.Size = New-Object System.Drawing.Size(1024, 820)
$form.MinimumSize = New-Object System.Drawing.Size(1024, 820)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.BackColor = [System.Drawing.Color]::FromArgb(246, 248, 251)
$form.Font = New-Font 9

$leftRail = New-Object System.Windows.Forms.Panel
$leftRail.Location = New-Object System.Drawing.Point(0, 0)
$leftRail.Size = New-Object System.Drawing.Size(246, 820)
$leftRail.BackColor = [System.Drawing.Color]::FromArgb(12, 22, 36)
$form.Controls.Add($leftRail)

$brandBlock = New-Object System.Windows.Forms.Panel
$brandBlock.Location = New-Object System.Drawing.Point(24, 24)
$brandBlock.Size = New-Object System.Drawing.Size(198, 118)
$brandBlock.BackColor = [System.Drawing.Color]::FromArgb(19, 34, 53)
$leftRail.Controls.Add($brandBlock)

$brandMark = Add-Label $brandBlock "RDS" 18 16 54 34 13 ([System.Drawing.Color]::White) ([System.Drawing.FontStyle]::Bold)
$brandMark.TextAlign = "MiddleCenter"
$brandMark.BackColor = $colors.Accent
Add-Label $brandBlock "Kentra SQL Evidence Collector" 18 58 166 34 12 ([System.Drawing.Color]::White) ([System.Drawing.FontStyle]::Bold) | Out-Null
Add-Label $brandBlock "Collector package launcher" 18 94 154 18 8 ([System.Drawing.Color]::FromArgb(151, 165, 184)) | Out-Null

Add-Label $leftRail "WORKFLOW" 26 170 120 18 8 ([System.Drawing.Color]::FromArgb(128, 146, 168)) ([System.Drawing.FontStyle]::Bold) | Out-Null

$stepOne = New-Object System.Windows.Forms.Panel
$stepOne.Location = New-Object System.Drawing.Point(24, 198)
$stepOne.Size = New-Object System.Drawing.Size(198, 64)
$stepOne.BackColor = [System.Drawing.Color]::FromArgb(22, 43, 67)
$leftRail.Controls.Add($stepOne)
Add-Label $stepOne "01" 14 12 34 28 11 $colors.Cyan ([System.Drawing.FontStyle]::Bold) | Out-Null
Add-Label $stepOne "Connect" 54 10 120 20 10 ([System.Drawing.Color]::White) ([System.Drawing.FontStyle]::Bold) | Out-Null
Add-Label $stepOne "Endpoint or CSV credentials" 54 33 128 18 8 ([System.Drawing.Color]::FromArgb(160, 174, 194)) | Out-Null

$stepTwo = New-Object System.Windows.Forms.Panel
$stepTwo.Location = New-Object System.Drawing.Point(24, 274)
$stepTwo.Size = New-Object System.Drawing.Size(198, 64)
$stepTwo.BackColor = [System.Drawing.Color]::FromArgb(22, 43, 67)
$leftRail.Controls.Add($stepTwo)
Add-Label $stepTwo "02" 14 12 34 28 11 $colors.Amber ([System.Drawing.FontStyle]::Bold) | Out-Null
Add-Label $stepTwo "Collect" 54 10 120 20 10 ([System.Drawing.Color]::White) ([System.Drawing.FontStyle]::Bold) | Out-Null
Add-Label $stepTwo "Run bounded SQL evidence" 54 33 128 18 8 ([System.Drawing.Color]::FromArgb(160, 174, 194)) | Out-Null

$stepThree = New-Object System.Windows.Forms.Panel
$stepThree.Location = New-Object System.Drawing.Point(24, 350)
$stepThree.Size = New-Object System.Drawing.Size(198, 64)
$stepThree.BackColor = [System.Drawing.Color]::FromArgb(22, 43, 67)
$leftRail.Controls.Add($stepThree)
Add-Label $stepThree "03" 14 12 34 28 11 $colors.Mint ([System.Drawing.FontStyle]::Bold) | Out-Null
Add-Label $stepThree "Package" 54 10 120 20 10 ([System.Drawing.Color]::White) ([System.Drawing.FontStyle]::Bold) | Out-Null
Add-Label $stepThree "Export customer ZIP" 54 33 128 18 8 ([System.Drawing.Color]::FromArgb(160, 174, 194)) | Out-Null

$statusPanel = New-Object System.Windows.Forms.Panel
$statusPanel.Location = New-Object System.Drawing.Point(24, 702)
$statusPanel.Size = New-Object System.Drawing.Size(198, 76)
$statusPanel.BackColor = [System.Drawing.Color]::FromArgb(19, 34, 53)
$leftRail.Controls.Add($statusPanel)
Add-Label $statusPanel "STATUS" 16 12 80 18 8 ([System.Drawing.Color]::FromArgb(151, 165, 184)) ([System.Drawing.FontStyle]::Bold) | Out-Null
$lblReady = Add-Label $statusPanel "READY" 16 36 166 26 10 ([System.Drawing.Color]::White) ([System.Drawing.FontStyle]::Bold)
$lblReady.TextAlign = "MiddleCenter"
$lblReady.BackColor = $colors.Success

$hero = New-Object System.Windows.Forms.Panel
$hero.Location = New-Object System.Drawing.Point(272, 24)
$hero.Size = New-Object System.Drawing.Size(710, 104)
$hero.BackColor = [System.Drawing.Color]::FromArgb(255, 255, 255)
$hero.BorderStyle = "FixedSingle"
$form.Controls.Add($hero)

$heroAccent = New-Object System.Windows.Forms.Panel
$heroAccent.Location = New-Object System.Drawing.Point(0, 0)
$heroAccent.Size = New-Object System.Drawing.Size(710, 8)
$heroAccent.BackColor = $colors.Cyan
$hero.Controls.Add($heroAccent)
Add-Label $hero "RDS workload evidence launcher" 24 25 390 30 17 $colors.Ink ([System.Drawing.FontStyle]::Bold) | Out-Null
Add-Label $hero "Run the standalone SQL Server collector, then export a customer ZIP for cost optimization assessment." 26 63 560 22 9 $colors.Muted | Out-Null

$safeChip = Add-Label $hero "SAFE DEFAULT: COST OPTIMIZATION OFF" 472 28 206 26 8 ([System.Drawing.Color]::White) ([System.Drawing.FontStyle]::Bold)
$safeChip.TextAlign = "MiddleCenter"
$safeChip.BackColor = $colors.Mint

$connectionPanel = New-Object System.Windows.Forms.Panel
$connectionPanel.Location = New-Object System.Drawing.Point(272, 150)
$connectionPanel.Size = New-Object System.Drawing.Size(455, 232)
$connectionPanel.BackColor = [System.Drawing.Color]::White
$connectionPanel.BorderStyle = "FixedSingle"
$form.Controls.Add($connectionPanel)
Add-Label $connectionPanel "Connection" 20 16 180 24 12 $colors.Ink ([System.Drawing.FontStyle]::Bold) | Out-Null
Add-Label $connectionPanel "Choose authentication and point the launcher at a server list or credentials CSV." 20 43 392 18 8.5 $colors.Muted | Out-Null

Add-Label $connectionPanel "Authentication" 20 78 120 20 9 $colors.Muted | Out-Null
$cmbAuth = New-Object System.Windows.Forms.ComboBox
$cmbAuth.Items.AddRange(@("Windows (W)", "SQL Server (S)", "From CSV File"))
$cmbAuth.SelectedIndex = 1
$cmbAuth.Location = New-Object System.Drawing.Point(154, 75)
$cmbAuth.Size = New-Object System.Drawing.Size(176, 24)
$cmbAuth.DropDownStyle = "DropDownList"
$connectionPanel.Controls.Add($cmbAuth)

Add-Label $connectionPanel "Login" 20 116 74 20 9 $colors.Muted | Out-Null
$txtLogin = Add-Textbox $connectionPanel 154 113 126
Add-Label $connectionPanel "Password" 294 116 70 20 9 $colors.Muted | Out-Null
$txtPassword = Add-Textbox $connectionPanel 365 113 52 "" $true

Add-Label $connectionPanel "Server list" 20 154 120 20 9 $colors.Muted | Out-Null
$txtServer = Add-Textbox $connectionPanel 154 151 220
$btnBrowse = Add-Button $connectionPanel "..." 383 149 34 28 $colors.Cyan
Add-Label $connectionPanel "Server name, comma list, TXT file, or CSV credentials file." 154 181 260 18 8 $colors.Muted | Out-Null

$settingsPanel = New-Object System.Windows.Forms.Panel
$settingsPanel.Location = New-Object System.Drawing.Point(747, 150)
$settingsPanel.Size = New-Object System.Drawing.Size(235, 232)
$settingsPanel.BackColor = [System.Drawing.Color]::White
$settingsPanel.BorderStyle = "FixedSingle"
$form.Controls.Add($settingsPanel)
Add-Label $settingsPanel "Collection" 18 16 160 24 12 $colors.Ink ([System.Drawing.FontStyle]::Bold) | Out-Null
Add-Label $settingsPanel "Bounded run settings." 18 43 170 18 8.5 $colors.Muted | Out-Null

Add-Label $settingsPanel "Minutes" 18 78 90 20 9 $colors.Muted | Out-Null
$txtTime = Add-Textbox $settingsPanel 118 75 72 "60"
Add-Label $settingsPanel "Admin DB" 18 116 90 20 9 $colors.Muted | Out-Null
$txtDB = Add-Textbox $settingsPanel 118 113 72 "msdb"

$chkCostOptimization = New-Object System.Windows.Forms.CheckBox
$chkCostOptimization.Text = "Enable Cost Optimization diagnostics"
$chkCostOptimization.Location = New-Object System.Drawing.Point(18, 154)
$chkCostOptimization.Size = New-Object System.Drawing.Size(202, 24)
$chkCostOptimization.Font = New-Font 8.5 ([System.Drawing.FontStyle]::Bold)
$chkCostOptimization.ForeColor = $colors.Ink
$chkCostOptimization.Checked = $false
$chkCostOptimization.BackColor = [System.Drawing.Color]::FromArgb(240, 253, 250)
$settingsPanel.Controls.Add($chkCostOptimization)
Add-Label $settingsPanel "On adds verified memory, file I/O, tempdb, edition, and manifest evidence." 18 184 200 34 8 $colors.Muted | Out-Null

$outputPanel = New-Object System.Windows.Forms.Panel
$outputPanel.Location = New-Object System.Drawing.Point(272, 402)
$outputPanel.Size = New-Object System.Drawing.Size(455, 146)
$outputPanel.BackColor = [System.Drawing.Color]::White
$outputPanel.BorderStyle = "FixedSingle"
$form.Controls.Add($outputPanel)
Add-Label $outputPanel "Customer output" 20 16 180 24 12 $colors.Ink ([System.Drawing.FontStyle]::Bold) | Out-Null
Add-Label $outputPanel "Exports are written under the selected customer directory." 20 43 360 18 8.5 $colors.Muted | Out-Null

Add-Label $outputPanel "Customer" 20 78 100 20 9 $colors.Muted | Out-Null
$txtCustomer = Add-Textbox $outputPanel 120 75 130
Add-Label $outputPanel "Folder" 20 112 100 20 9 $colors.Muted | Out-Null
$txtOutput = Add-Textbox $outputPanel 120 109 254 $scriptDir
$btnOutputBrowse = Add-Button $outputPanel "..." 383 107 34 28 $colors.Mint

$commandPanel = New-Object System.Windows.Forms.Panel
$commandPanel.Location = New-Object System.Drawing.Point(747, 402)
$commandPanel.Size = New-Object System.Drawing.Size(235, 146)
$commandPanel.BackColor = [System.Drawing.Color]::FromArgb(255, 252, 246)
$commandPanel.BorderStyle = "FixedSingle"
$form.Controls.Add($commandPanel)
Add-Label $commandPanel "Run commands" 18 14 160 24 12 $colors.Ink ([System.Drawing.FontStyle]::Bold) | Out-Null
Add-Label $commandPanel "Collect first. Export after the run finishes." 18 40 190 18 8.5 $colors.Muted | Out-Null

$btnStart = Add-Button $commandPanel "Start collection" 18 70 198 32 ([System.Drawing.Color]::FromArgb(22, 130, 214))
$btnExport = Add-Button $commandPanel "Export and ZIP" 18 108 198 32 $colors.Mint

$opsPanel = New-Object System.Windows.Forms.Panel
$opsPanel.Location = New-Object System.Drawing.Point(272, 568)
$opsPanel.Size = New-Object System.Drawing.Size(455, 100)
$opsPanel.BackColor = [System.Drawing.Color]::FromArgb(255, 248, 250)
$opsPanel.BorderStyle = "FixedSingle"
$form.Controls.Add($opsPanel)
Add-Label $opsPanel "Operational notes" 20 14 180 22 11 $colors.Ink ([System.Drawing.FontStyle]::Bold) | Out-Null
Add-Label $opsPanel "Cost Optimization diagnostics are opt-in and default off. Cleanup exports and zips data, then removes collector-owned tables and the SQL_IOCollection job." 20 42 400 36 8.5 $colors.Muted | Out-Null

$maintenancePanel = New-Object System.Windows.Forms.Panel
$maintenancePanel.Location = New-Object System.Drawing.Point(747, 568)
$maintenancePanel.Size = New-Object System.Drawing.Size(235, 100)
$maintenancePanel.BackColor = [System.Drawing.Color]::White
$maintenancePanel.BorderStyle = "FixedSingle"
$form.Controls.Add($maintenancePanel)
Add-Label $maintenancePanel "Maintenance" 18 14 160 22 11 $colors.Ink ([System.Drawing.FontStyle]::Bold) | Out-Null
$btnTerminate = Add-Button $maintenancePanel "Terminate" 18 46 96 32 $colors.Warning
$btnCleanup = Add-Button $maintenancePanel "Cleanup" 122 46 96 32 $colors.Danger
$btnClose = Add-Button $maintenancePanel "Close" 18 80 200 0 ([System.Drawing.Color]::FromArgb(98, 108, 119))
$btnClose.Visible = $false

$closeLink = Add-Label $leftRail "Close launcher" 66 650 120 22 9 ([System.Drawing.Color]::FromArgb(215, 224, 235)) ([System.Drawing.FontStyle]::Bold)
$closeLink.Cursor = [System.Windows.Forms.Cursors]::Hand

$logPanel = New-Object System.Windows.Forms.Panel
$logPanel.Location = New-Object System.Drawing.Point(272, 682)
$logPanel.Size = New-Object System.Drawing.Size(710, 112)
$logPanel.BackColor = [System.Drawing.Color]::FromArgb(17, 24, 31)
$logPanel.BorderStyle = "FixedSingle"
$form.Controls.Add($logPanel)
Add-Label $logPanel "Activity log" 12 7 90 18 8 ([System.Drawing.Color]::FromArgb(179, 205, 230)) ([System.Drawing.FontStyle]::Bold) | Out-Null
$txtLog = New-Object System.Windows.Forms.TextBox
$txtLog.Location = New-Object System.Drawing.Point(106, 8)
$txtLog.Size = New-Object System.Drawing.Size(588, 92)
$txtLog.Multiline = $true
$txtLog.ScrollBars = "Vertical"
$txtLog.ReadOnly = $true
$txtLog.BorderStyle = "None"
$txtLog.Font = New-Object System.Drawing.Font("Consolas", 8.5)
$txtLog.BackColor = [System.Drawing.Color]::FromArgb(17, 24, 31)
$txtLog.ForeColor = [System.Drawing.Color]::FromArgb(216, 230, 242)
$logPanel.Controls.Add($txtLog)

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
$closeLink.Add_Click({ $form.Close() })

Write-Log "Launcher ready."
Write-Log "Package path: $scriptDir"
$form.ShowDialog() | Out-Null
