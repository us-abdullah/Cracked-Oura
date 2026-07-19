# Update phone / Vercel site from your latest desktop data.
# Double-click Update-Phone-Site.bat (or run this from PowerShell).
#
# Requires:
#   1) Usman Biotracker running (backend on http://127.0.0.1:8000)
#   2) Node.js + git on PATH
#   3) This repo checked out with push access to GitHub

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RepoRoot

Write-Host ""
Write-Host "=== Usman Biotracker → Phone site update ===" -ForegroundColor Cyan
Write-Host "Repo: $RepoRoot"
Write-Host ""

# 1) Backend must be up
Write-Host "[1/4] Checking desktop backend on :8000 ..."
try {
    $null = Invoke-WebRequest -Uri "http://127.0.0.1:8000/api/settings" -UseBasicParsing -TimeoutSec 5
    Write-Host "      Backend OK" -ForegroundColor Green
} catch {
    Write-Host ""
    Write-Host "ERROR: Desktop backend is not reachable on http://127.0.0.1:8000" -ForegroundColor Red
    Write-Host "Open Usman Biotracker first, wait until it loads, then run this again."
    exit 1
}

# 2) Export snapshot
Write-Host "[2/4] Exporting mirror-snapshot.json ..."
Push-Location (Join-Path $RepoRoot "web")
try {
    npm run export:snapshot
    if ($LASTEXITCODE -ne 0) { throw "export:snapshot failed (exit $LASTEXITCODE)" }
} finally {
    Pop-Location
}
Write-Host "      Export OK" -ForegroundColor Green

# 3) Commit if changed
Write-Host "[3/4] Committing snapshot ..."
git add -- "web/public/mirror-snapshot.json"
$changed = git status --porcelain -- "web/public/mirror-snapshot.json"
if (-not $changed) {
    Write-Host "      Snapshot unchanged — nothing to push." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Phone site is already up to date."
    exit 0
}

$msg = "Update phone snapshot from desktop."
git commit -m $msg
if ($LASTEXITCODE -ne 0) { throw "git commit failed" }
Write-Host "      Commit OK" -ForegroundColor Green

# 4) Push (triggers Vercel)
Write-Host "[4/4] Pushing to GitHub (Vercel will redeploy) ..."
git push
if ($LASTEXITCODE -ne 0) { throw "git push failed" }

Write-Host ""
Write-Host "Done. Wait ~1 minute for Vercel, then hard-refresh the phone site." -ForegroundColor Green
Write-Host ""
