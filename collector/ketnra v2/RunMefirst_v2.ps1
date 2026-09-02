# Kentra RDS Workload Evidence Collector - V2 launcher
# Side-by-side launcher that preserves the existing collector engine and output contract.

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$scriptDir = $PSScriptRoot

$colors = @{
    Ink = [System.Drawing.Color]::FromArgb(25, 31, 36)
    Muted = [System.Drawing.Color]::FromArgb(92, 103, 116)
    Shell = [System.Drawing.Color]::FromArgb(247, 249, 250)
    Panel = [System.Drawing.Color]::FromArgb(255, 255, 255)
    Line = [System.Drawing.Color]::FromArgb(216, 224, 230)
    Navy = [System.Drawing.Color]::FromArgb(18, 48, 74)
    Blue = [System.Drawing.Color]::FromArgb(17, 111, 171)
    Teal = [System.Drawing.Color]::FromArgb(24, 139, 125)
    Green = [System.Drawing.Color]::FromArgb(29, 141, 88)
    Amber = [System.Drawing.Color]::FromArgb(188, 118, 23)
    Red = [System.Drawing.Color]::FromArgb(180, 58, 64)
    SoftBlue = [System.Drawing.Color]::FromArgb(232, 244, 251)
    SoftGreen = [System.Drawing.Color]::FromArgb(232, 247, 241)
    SoftAmber = [System.Drawing.Color]::FromArgb(255, 247, 231)
}

function New-Font {
    param(
        [float]$Size,
        [System.Drawing.FontStyle]$Style = [System.Drawing.FontStyle]::Regular
    )
    return New-Object System.Drawing.Font("Segoe UI", $Size, $Style)
}

function Add-Text {
    param(
        [System.Windows.Forms.Control]$Parent,
        [string]$Text,
        [int]$X,
        [int]$Y,
        [int]$W,
        [int]$H = 22,
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

function Add-Input {
    param(
        [System.Windows.Forms.Control]$Parent,
        [int]$X,
        [int]$Y,
        [int]$W,
        [string]$Text = "",
        [bool]$Password = $false
    )
    $box = New-Object System.Windows.Forms.TextBox
    $box.Location = New-Object System.Drawing.Point($X, $Y)
    $box.Size = New-Object System.Drawing.Size($W, 26)
    $box.Font = New-Font 9
    $box.Text = $Text
    $box.UseSystemPasswordChar = $Password
    $Parent.Controls.Add($box)
    return $box
}

function Add-Action {
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
    $button.TextAlign = "MiddleCenter"
    $Parent.Controls.Add($button)
    return $button
}

function Add-Page {
    param([System.Windows.Forms.Control]$Parent)
    $panel = New-Object System.Windows.Forms.Panel
    $panel.Location = New-Object System.Drawing.Point(28, 154)
    $panel.Size = New-Object System.Drawing.Size(980, 318)
    $panel.BackColor = $colors.Panel
    $panel.BorderStyle = "FixedSingle"
    $panel.Visible = $false
    $Parent.Controls.Add($panel)
    return $panel
}

function Add-FieldLabel {
    param(
        [System.Windows.Forms.Control]$Parent,
        [string]$Text,
        [int]$X,
        [int]$Y,
        [int]$W = 160
    )
    Add-Text $Parent $Text $X $Y $W 20 9 $colors.Muted | Out-Null
}

function Set-StepStyle {
    param(
        [System.Windows.Forms.Button]$Button,
        [bool]$Active
    )
    if ($Active) {
        $Button.BackColor = $colors.Navy
        $Button.ForeColor = [System.Drawing.Color]::White
    } else {
        $Button.BackColor = [System.Drawing.Color]::FromArgb(229, 235, 240)
        $Button.ForeColor = $colors.Ink
    }
}

$form = New-Object System.Windows.Forms.Form
$form.Text = "Kentra RDS Workload Evidence Collector V2"
$form.Size = New-Object System.Drawing.Size(1050, 780)
$form.MinimumSize = New-Object System.Drawing.Size(1050, 780)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.BackColor = $colors.Shell
$form.Font = New-Font 9

$header = New-Object System.Windows.Forms.Panel
$header.Location = New-Object System.Drawing.Point(0, 0)
$header.Size = New-Object System.Drawing.Size(1050, 118)
$header.BackColor = $colors.Navy
$form.Controls.Add($header)

$mark = Add-Text $header "V2" 28 24 58 42 15 ([System.Drawing.Color]::White) ([System.Drawing.FontStyle]::Bold)
$mark.TextAlign = "MiddleCenter"
$mark.BackColor = $colors.Teal
Add-Text $header "Kentra RDS Workload Evidence Collector" 104 24 520 34 18 ([System.Drawing.Color]::White) ([System.Drawing.FontStyle]::Bold) | Out-Null
Add-Text $header "A guided package builder for SQL Server workload optimization evidence." 106 62 560 22 9 ([System.Drawing.Color]::FromArgb(197, 214, 226)) | Out-Null

$statusBadge = Add-Text $header "READY" 878 35 112 34 10 ([System.Drawing.Color]::White) ([System.Drawing.FontStyle]::Bold)
$statusBadge.TextAlign = "MiddleCenter"
$statusBadge.BackColor = $colors.Green

$stepTarget = Add-Action $form "1  Target" 28 126 150 34 $colors.Navy
$stepCredentials = Add-Action $form "2  Access" 190 126 150 34 ([System.Drawing.Color]::FromArgb(229, 235, 240)) $colors.Ink
$stepEvidence = Add-Action $form "3  Evidence" 352 126 150 34 ([System.Drawing.Color]::FromArgb(229, 235, 240)) $colors.Ink
$stepRun = Add-Action $form "4  Run" 514 126 150 34 ([System.Drawing.Color]::FromArgb(229, 235, 240)) $colors.Ink

$pageTarget = Add-Page $form
$pageCredentials = Add-Page $form
$pageEvidence = Add-Page $form
$pageRun = Add-Page $form

Add-Text $pageTarget "Target and output" 28 24 260 28 14 $colors.Ink ([System.Drawing.FontStyle]::Bold) | Out-Null
Add-Text $pageTarget "Choose the SQL Server endpoint list and the customer folder used for exported evidence." 30 58 650 22 9 $colors.Muted | Out-Null
Add-FieldLabel $pageTarget "Server list or CSV" 32 108
$txtServer = Add-Input $pageTarget 198 104 620
$btnBrowseServer = Add-Action $pageTarget "Browse" 834 101 112 32 $colors.Blue
Add-Text $pageTarget "Server name, comma-separated list, TXT file, or credentials CSV." 198 136 620 18 8 $colors.Muted | Out-Null
Add-FieldLabel $pageTarget "Customer name" 32 180
$txtCustomer = Add-Input $pageTarget 198 176 220
Add-FieldLabel $pageTarget "Output folder" 32 224
$txtOutput = Add-Input $pageTarget 198 220 620 $scriptDir
$btnBrowseOutput = Add-Action $pageTarget "Browse" 834 217 112 32 $colors.Teal

Add-Text $pageCredentials "Access method" 28 24 260 28 14 $colors.Ink ([System.Drawing.FontStyle]::Bold) | Out-Null
Add-Text $pageCredentials "Credentials are used only by the local collector run and are not exported to the upload package." 30 58 680 22 9 $colors.Muted | Out-Null
Add-FieldLabel $pageCredentials "Authentication" 32 108
$cmbAuth = New-Object System.Windows.Forms.ComboBox
$cmbAuth.Items.AddRange(@("SQL Server authentication", "Windows authentication", "Credentials from CSV"))
$cmbAuth.SelectedIndex = 0
$cmbAuth.Location = New-Object System.Drawing.Point(198, 104)
$cmbAuth.Size = New-Object System.Drawing.Size(250, 26)
$cmbAuth.DropDownStyle = "DropDownList"
$pageCredentials.Controls.Add($cmbAuth)
Add-FieldLabel $pageCredentials "Login" 32 158
$txtLogin = Add-Input $pageCredentials 198 154 250
Add-FieldLabel $pageCredentials "Password" 32 202
$txtPassword = Add-Input $pageCredentials 198 198 250 "" $true
Add-FieldLabel $pageCredentials "Admin database" 32 246
$txtDB = Add-Input $pageCredentials 198 242 130 "msdb"

Add-Text $pageEvidence "Evidence profile" 28 24 260 28 14 $colors.Ink ([System.Drawing.FontStyle]::Bold) | Out-Null
Add-Text $pageEvidence "The default keeps the original collector behavior. Workload Optimization adds the approved bounded diagnostics." 30 58 720 22 9 $colors.Muted | Out-Null
$profileBox = New-Object System.Windows.Forms.Panel
$profileBox.Location = New-Object System.Drawing.Point(34, 104)
$profileBox.Size = New-Object System.Drawing.Size(890, 92)
$profileBox.BackColor = $colors.SoftGreen
$profileBox.BorderStyle = "FixedSingle"
$pageEvidence.Controls.Add($profileBox)
$chkCostOptimization = New-Object System.Windows.Forms.CheckBox
$chkCostOptimization.Text = "Enable Workload Optimization evidence"
$chkCostOptimization.Location = New-Object System.Drawing.Point(24, 18)
$chkCostOptimization.Size = New-Object System.Drawing.Size(330, 24)
$chkCostOptimization.Font = New-Font 10 ([System.Drawing.FontStyle]::Bold)
$chkCostOptimization.ForeColor = $colors.Ink
$chkCostOptimization.Checked = $false
$chkCostOptimization.BackColor = $colors.SoftGreen
$profileBox.Controls.Add($chkCostOptimization)
Add-Text $profileBox "Adds synchronized memory, cache, file I/O, tempdb, edition, and non-secret manifest evidence. Default is off." 26 48 810 22 8.5 $colors.Muted | Out-Null
Add-FieldLabel $pageEvidence "Collection length" 36 230
$txtTime = Add-Input $pageEvidence 198 226 92 "60"
Add-Text $pageEvidence "minutes" 298 230 80 20 9 $colors.Muted | Out-Null

Add-Text $pageRun "Run and package" 28 24 260 28 14 $colors.Ink ([System.Drawing.FontStyle]::Bold) | Out-Null
Add-Text $pageRun "Run evidence collection first, then build the upload package or finalize with cleanup." 30 58 680 22 9 $colors.Muted | Out-Null
$btnBegin = Add-Action $pageRun "Begin Evidence Run" 42 112 246 46 $colors.Blue
$btnPackage = Add-Action $pageRun "Build Upload Package" 310 112 246 46 $colors.Teal
$btnFinalize = Add-Action $pageRun "Finalize and Clean Up" 42 178 246 46 $colors.Green
$btnStop = Add-Action $pageRun "Stop Active Run" 310 178 246 46 $colors.Amber
Add-Text $pageRun "Finalize exports and zips the evidence, then removes collector-owned tables and the SQL_IOCollection job." 42 250 810 22 8.5 $colors.Muted | Out-Null

$summaryPanel = New-Object System.Windows.Forms.Panel
$summaryPanel.Location = New-Object System.Drawing.Point(28, 490)
$summaryPanel.Size = New-Object System.Drawing.Size(980, 54)
$summaryPanel.BackColor = $colors.SoftBlue
$summaryPanel.BorderStyle = "FixedSingle"
$form.Controls.Add($summaryPanel)
$lblSummary = Add-Text $summaryPanel "Target not selected yet." 18 16 930 22 9 $colors.Ink

$logPanel = New-Object System.Windows.Forms.Panel
$logPanel.Location = New-Object System.Drawing.Point(28, 560)
$logPanel.Size = New-Object System.Drawing.Size(980, 136)
$logPanel.BackColor = [System.Drawing.Color]::FromArgb(19, 26, 32)
$logPanel.BorderStyle = "FixedSingle"
$form.Controls.Add($logPanel)
Add-Text $logPanel "Run log" 14 10 86 20 9 ([System.Drawing.Color]::FromArgb(206, 224, 235)) ([System.Drawing.FontStyle]::Bold) | Out-Null
$txtLog = New-Object System.Windows.Forms.TextBox
$txtLog.Location = New-Object System.Drawing.Point(102, 10)
$txtLog.Size = New-Object System.Drawing.Size(858, 112)
$txtLog.Multiline = $true
$txtLog.ScrollBars = "Vertical"
$txtLog.ReadOnly = $true
$txtLog.BorderStyle = "None"
$txtLog.Font = New-Object System.Drawing.Font("Consolas", 8.5)
$txtLog.BackColor = [System.Drawing.Color]::FromArgb(19, 26, 32)
$txtLog.ForeColor = [System.Drawing.Color]::FromArgb(220, 233, 241)
$logPanel.Controls.Add($txtLog)

$btnBack = Add-Action $form "Back" 768 710 110 34 ([System.Drawing.Color]::FromArgb(110, 121, 132))
$btnNext = Add-Action $form "Next" 894 710 110 34 $colors.Navy
$btnClose = Add-Action $form "Close" 28 710 110 34 ([System.Drawing.Color]::FromArgb(110, 121, 132))

$pages = @($pageTarget, $pageCredentials, $pageEvidence, $pageRun)
$steps = @($stepTarget, $stepCredentials, $stepEvidence, $stepRun)
$currentPage = 0

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
        [System.Drawing.Color]$Color
    )
    $statusBadge.Text = $Text
    $statusBadge.BackColor = $Color
    $form.Refresh()
}

function Update-Summary {
    $target = $txtServer.Text.Trim()
    $customer = $txtCustomer.Text.Trim()
    $mode = if ($chkCostOptimization.Checked) { "Workload Optimization evidence on" } else { "Original collector mode" }
    if (-not $target) { $target = "target not selected" }
    if (-not $customer) { $customer = "customer folder optional" }
    $lblSummary.Text = "$target  |  $customer  |  $mode"
}

function Show-Page {
    param([int]$Index)
    if ($Index -lt 0 -or $Index -ge $pages.Count) { return }
    $script:currentPage = $Index
    for ($i = 0; $i -lt $pages.Count; $i++) {
        $pages[$i].Visible = ($i -eq $Index)
        Set-StepStyle $steps[$i] ($i -eq $Index)
    }
    $btnBack.Enabled = $Index -gt 0
    $btnNext.Text = if ($Index -eq ($pages.Count - 1)) { "Review" } else { "Next" }
    Update-Summary
}

function Resolve-OutputDirectory {
    $selectedOutput = $txtOutput.Text.Trim()
    if (-not $selectedOutput) {
        throw "Output folder is required."
    }

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
        throw "Server list or credentials CSV is required."
    }

    if (Test-Path $serverText) {
        return $serverText
    }

    $tempFile = Join-Path $env:TEMP "kentra_rds_v2_servers_$(Get-Date -Format 'yyyyMMddHHmmss').txt"
    $serverText -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Out-File $tempFile -Encoding utf8
    return $tempFile
}

function Build-LauncherParams {
    param([string]$Mode)

    $isCsvMode = $cmbAuth.SelectedIndex -eq 2
    $authVal = if ($cmbAuth.SelectedIndex -eq 0) { "s" } elseif ($cmbAuth.SelectedIndex -eq 1) { "w" } else { $null }

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

    if ($isCsvMode) {
        Write-Log "Credentials from CSV selected."
    }

    if ($chkCostOptimization.Checked) {
        $params.costoptimization = $true
        Write-Log "Workload Optimization evidence enabled."
    }

    switch ($Mode) {
        "collect" {
            $minutes = [int]$txtTime.Text
            if ($minutes -lt 1) {
                throw "Collection length must be at least 1 minute."
            }
            $params.collectiontime = $minutes
        }
        "package" {
            $params.export = $true
            $params.compress = $true
        }
        "finalize" {
            $params.cleanup = $true
            $params.compress = $true
        }
        "stop" {
            $params.terminate = $true
        }
    }

    return $params
}

function Invoke-CollectorMode {
    param([string]$Mode)

    try {
        $launcherScript = Join-Path $scriptDir "SSATcollector_launcher.ps1"
        if (-not (Test-Path $launcherScript)) {
            throw "Collector launcher not found in $scriptDir"
        }

        $statusText = switch ($Mode) {
            "collect" { "COLLECTING" }
            "package" { "PACKAGING" }
            "finalize" { "FINALIZING" }
            "stop" { "STOPPING" }
        }
        Set-Status $statusText $colors.Amber

        $params = Build-LauncherParams -Mode $Mode

        switch ($Mode) {
            "collect" { Write-Log "Beginning evidence run for $($params.collectiontime) minute(s)." }
            "package" { Write-Log "Building upload package." }
            "finalize" { Write-Log "Finalizing package and cleaning collector-owned artifacts." }
            "stop" { Write-Log "Stopping active run." }
        }

        Write-Log "Running collector engine with parameters: $($params.Keys -join ', ')"
        & $launcherScript @params 2>&1 | ForEach-Object { Write-Log $_ }

        Set-Status "READY" $colors.Green
        Write-Log "Done."
    } catch {
        Set-Status "ERROR" $colors.Red
        Write-Log "ERROR: $($_.Exception.Message)"
    }
}

$cmbAuth.Add_SelectedIndexChanged({
    $isSql = $cmbAuth.SelectedIndex -eq 0
    $isCsv = $cmbAuth.SelectedIndex -eq 2
    $txtLogin.Enabled = $isSql
    $txtPassword.Enabled = $isSql

    if ($isCsv) {
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

$btnBrowseServer.Add_Click({
    $dlg = New-Object System.Windows.Forms.OpenFileDialog
    $dlg.Filter = "Collector input (*.txt;*.csv)|*.txt;*.csv|CSV credentials (*.csv)|*.csv|Text files (*.txt)|*.txt|All files (*.*)|*.*"
    $dlg.Title = "Select server list or credentials CSV"
    if ($dlg.ShowDialog() -eq "OK") {
        $txtServer.Text = $dlg.FileName
        Update-Summary
    }
})

$btnBrowseOutput.Add_Click({
    $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
    $dlg.Description = "Select output folder"
    if ($dlg.ShowDialog() -eq "OK") {
        $txtOutput.Text = $dlg.SelectedPath
        Update-Summary
    }
})

$stepTarget.Add_Click({ Show-Page 0 })
$stepCredentials.Add_Click({ Show-Page 1 })
$stepEvidence.Add_Click({ Show-Page 2 })
$stepRun.Add_Click({ Show-Page 3 })
$btnBack.Add_Click({ Show-Page ($currentPage - 1) })
$btnNext.Add_Click({
    if ($currentPage -lt ($pages.Count - 1)) {
        Show-Page ($currentPage + 1)
    } else {
        Update-Summary
        Write-Log "Review complete. Choose a run action."
    }
})
$btnClose.Add_Click({ $form.Close() })

$txtServer.Add_TextChanged({ Update-Summary })
$txtCustomer.Add_TextChanged({ Update-Summary })
$chkCostOptimization.Add_CheckedChanged({ Update-Summary })

$btnBegin.Add_Click({ Invoke-CollectorMode -Mode "collect" })
$btnPackage.Add_Click({ Invoke-CollectorMode -Mode "package" })
$btnFinalize.Add_Click({
    $confirm = [System.Windows.Forms.MessageBox]::Show(
        "Finalize exports and zips evidence, then removes collector-owned tables and the SQL_IOCollection job. Continue?",
        "Confirm finalize",
        [System.Windows.Forms.MessageBoxButtons]::YesNo,
        [System.Windows.Forms.MessageBoxIcon]::Warning
    )
    if ($confirm -eq "Yes") {
        Invoke-CollectorMode -Mode "finalize"
    }
})
$btnStop.Add_Click({
    $confirm = [System.Windows.Forms.MessageBox]::Show(
        "Stop the active evidence run?",
        "Confirm stop",
        [System.Windows.Forms.MessageBoxButtons]::YesNo,
        [System.Windows.Forms.MessageBoxIcon]::Warning
    )
    if ($confirm -eq "Yes") {
        Invoke-CollectorMode -Mode "stop"
    }
})

Show-Page 0
Write-Log "V2 launcher ready."
Write-Log "Package path: $scriptDir"
$form.ShowDialog() | Out-Null
