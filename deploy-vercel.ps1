$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
Set-Location -LiteralPath $Root

# Set console encoding for Ukrainian
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "========================================"
Write-Host "  Deploy to Vercel - vovklesias.vercel.app"
Write-Host "========================================"
Write-Host ""

# ═══════════════════════════════════════════════════════════════════════════════
# VERCEL ACCOUNT SELECTION (GUI Window)
# ═══════════════════════════════════════════════════════════════════════════════

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$vercelAccounts = @(
    @{ Name = "vovklesia (Main)"; Team = ""; Scope = "" }
)

# Create form
$form = New-Object System.Windows.Forms.Form
$form.Text = "Vercel Account Selection"
$form.Size = New-Object System.Drawing.Size(400, 380)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.TopMost = $true

$label = New-Object System.Windows.Forms.Label
$label.Location = New-Object System.Drawing.Point(20, 15)
$label.Size = New-Object System.Drawing.Size(350, 25)
$label.Text = "Select Vercel account for deploy:"
$label.Font = New-Object System.Drawing.Font("Segoe UI", 11, [System.Drawing.FontStyle]::Bold)
$form.Controls.Add($label)

$listBox = New-Object System.Windows.Forms.ListBox
$listBox.Location = New-Object System.Drawing.Point(20, 50)
$listBox.Size = New-Object System.Drawing.Size(350, 150)
$listBox.Font = New-Object System.Drawing.Font("Consolas", 10)

# Add accounts to list
$listBox.Items.Add("[Current] - Use current Vercel account")
foreach ($acc in $vercelAccounts) {
    $listBox.Items.Add($acc.Name)
}
$listBox.Items.Add("[Login] - Login to different account")
$listBox.SelectedIndex = 0

$form.Controls.Add($listBox)

$okButton = New-Object System.Windows.Forms.Button
$okButton.Location = New-Object System.Drawing.Point(150, 280)
$okButton.Size = New-Object System.Drawing.Size(100, 35)
$okButton.Text = "Deploy"
$okButton.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
$okButton.BackColor = [System.Drawing.Color]::FromArgb(0, 120, 215)
$okButton.ForeColor = [System.Drawing.Color]::White
$okButton.FlatStyle = "Flat"
$okButton.DialogResult = [System.Windows.Forms.DialogResult]::OK
$form.AcceptButton = $okButton
$form.Controls.Add($okButton)

$result = $form.ShowDialog()

if ($result -ne [System.Windows.Forms.DialogResult]::OK) {
    Write-Host "Cancelled by user." -ForegroundColor Yellow
    exit 0
}

$selectedIndex = $listBox.SelectedIndex
$vercelScope = ""
$totalItems = $listBox.Items.Count

if ($selectedIndex -eq 0) {
    Write-Host "Using current Vercel account" -ForegroundColor Green
} elseif ($selectedIndex -eq ($totalItems - 1)) {
    # Login option (last item)
    Write-Host "Opening Vercel login..." -ForegroundColor Cyan
    vercel logout
    vercel login
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Login failed!" -ForegroundColor Red
        exit 1
    }
    Write-Host "Logged in successfully!" -ForegroundColor Green
} else {
    $selected = $vercelAccounts[$selectedIndex - 1]
    Write-Host "Selected: $($selected.Name)" -ForegroundColor Green
    $vercelScope = $selected.Scope
}

Write-Host ""
Write-Host "========================================"

# ═══════════════════════════════════════════════════════════════════════════════
# PROJECT SELECTION (GUI Window)
# ═══════════════════════════════════════════════════════════════════════════════

$projects = @(
    @{ Name = "sto"; Url = "https://vovklesias.vercel.app" },
    @{ Name = "vovklesias"; Url = "https://vovklesias.vercel.app" }
)

# Create project selection form
$projectForm = New-Object System.Windows.Forms.Form
$projectForm.Text = "Vercel Project Selection"
$projectForm.Size = New-Object System.Drawing.Size(400, 300)
$projectForm.StartPosition = "CenterScreen"
$projectForm.FormBorderStyle = "FixedDialog"
$projectForm.MaximizeBox = $false
$projectForm.TopMost = $true

$projectLabel = New-Object System.Windows.Forms.Label
$projectLabel.Location = New-Object System.Drawing.Point(20, 15)
$projectLabel.Size = New-Object System.Drawing.Size(350, 25)
$projectLabel.Text = "Select Vercel project to deploy:"
$projectLabel.Font = New-Object System.Drawing.Font("Segoe UI", 11, [System.Drawing.FontStyle]::Bold)
$projectForm.Controls.Add($projectLabel)

$projectListBox = New-Object System.Windows.Forms.ListBox
$projectListBox.Location = New-Object System.Drawing.Point(20, 50)
$projectListBox.Size = New-Object System.Drawing.Size(350, 120)
$projectListBox.Font = New-Object System.Drawing.Font("Consolas", 10)

# Add projects to list
foreach ($proj in $projects) {
    $projectListBox.Items.Add("$($proj.Name) → $($proj.Url)")
}
$projectListBox.SelectedIndex = 0

$projectForm.Controls.Add($projectListBox)

$projectOkButton = New-Object System.Windows.Forms.Button
$projectOkButton.Location = New-Object System.Drawing.Point(150, 200)
$projectOkButton.Size = New-Object System.Drawing.Size(100, 35)
$projectOkButton.Text = "Select"
$projectOkButton.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
$projectOkButton.BackColor = [System.Drawing.Color]::FromArgb(0, 120, 215)
$projectOkButton.ForeColor = [System.Drawing.Color]::White
$projectOkButton.FlatStyle = "Flat"
$projectOkButton.DialogResult = [System.Windows.Forms.DialogResult]::OK
$projectForm.AcceptButton = $projectOkButton
$projectForm.Controls.Add($projectOkButton)

$projectResult = $projectForm.ShowDialog()

if ($projectResult -ne [System.Windows.Forms.DialogResult]::OK) {
    Write-Host "Cancelled by user." -ForegroundColor Yellow
    exit 0
}

$selectedProject = $projects[$projectListBox.SelectedIndex]
$projectName = $selectedProject.Name
$projectUrl = $selectedProject.Url

Write-Host "Selected project: $projectName" -ForegroundColor Green
Write-Host ""

# ═══════════════════════════════════════════════════════════════════════════════
# RELINK TO SELECTED PROJECT
# ═══════════════════════════════════════════════════════════════════════════════

Write-Host "[1/4] Linking to Vercel project: $projectName..." -ForegroundColor Cyan
if (Test-Path ".vercel") {
    Remove-Item -Recurse -Force ".vercel"
    Write-Host "Cleared existing .vercel folder" -ForegroundColor Yellow
}

if ($vercelScope -ne "") {
    vercel link --project $projectName --yes $vercelScope
} else {
    vercel link --project $projectName --yes
}

if ($LASTEXITCODE -ne 0) {
    Write-Host "Project linking failed!" -ForegroundColor Red
    exit 1
}

Write-Host "[2/4] Building for Vercel (base: /)..."
npm run build:vercel
if ($LASTEXITCODE -ne 0) { Write-Host "Build failed!"; exit 1 }

Write-Host "[3/4] Deploying to Vercel..."
if ($vercelScope -ne "") {
    vercel --prod --yes $vercelScope
} else {
    vercel --prod --yes
}

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "========================================"
    Write-Host "  Done! $projectUrl"
    Write-Host "========================================"
    Start-Process $projectUrl
} else {
    Write-Host "Deploy failed!"
    exit 1
}
