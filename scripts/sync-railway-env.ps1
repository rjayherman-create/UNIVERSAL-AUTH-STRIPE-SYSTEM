param(
  [string]$Service,
  [string]$Environment,
  [string]$Project,
  [string]$EnvFile = ".env",
  [switch]$DeployAfterSync
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command railway -ErrorAction SilentlyContinue)) {
  throw "Railway CLI not found. Install it first: npm i -g @railway/cli"
}

if (-not (Test-Path $EnvFile)) {
  throw "Env file not found: $EnvFile"
}

railway status | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Railway is not ready. Run 'railway login' and 'railway link' first."
}

$allowedKeys = @(
  "PORT",
  "DATABASE_URL",
  "JWT_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_SUBSCRIPTION_PRICE_ID",
  "STRIPE_CREDIT_PRICE_ID",
  "CLIENT_URL",
  "DEV_BYPASS_AUTH",
  "DEV_ADMIN_EMAIL"
)

$envMap = @{}

Get-Content $EnvFile | ForEach-Object {
  $line = $_.Trim()

  if ($line -eq "" -or $line.StartsWith("#")) {
    return
  }

  if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
    $key = $matches[1]
    $value = $matches[2]

    if (
      ($value.StartsWith('"') -and $value.EndsWith('"')) -or
      ($value.StartsWith("'") -and $value.EndsWith("'"))
    ) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    $envMap[$key] = $value
  }
}

$baseArgs = @()
if ($Service) { $baseArgs += @("--service", $Service) }
if ($Environment) { $baseArgs += @("--environment", $Environment) }
if ($Project) { $baseArgs += @("--project", $Project) }

$setCount = 0
$missingCount = 0
$failedCount = 0

foreach ($key in $allowedKeys) {
  if (-not $envMap.ContainsKey($key)) {
    Write-Host "Skipping missing key: $key" -ForegroundColor Yellow
    $missingCount += 1
    continue
  }

  $value = [string]$envMap[$key]

  # Use --stdin to avoid putting secret values in command history.
  $value | railway variable set $key --stdin --skip-deploys @baseArgs | Out-Null

  if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to sync key: $key" -ForegroundColor Red
    $failedCount += 1
  }
  else {
    Write-Host "Synced key: $key" -ForegroundColor Green
    $setCount += 1
  }
}

Write-Host "" 
Write-Host "Railway sync complete." -ForegroundColor Cyan
Write-Host "Keys synced: $setCount"
Write-Host "Keys failed: $failedCount"
Write-Host "Keys missing in ${EnvFile}: $missingCount"

if ($failedCount -gt 0) {
  throw "One or more Railway variables failed to sync."
}

if ($DeployAfterSync) {
  Write-Host "Triggering deployment..." -ForegroundColor Cyan
  railway up @baseArgs
}
