<#
.SYNOPSIS
  Safe Windows Docker Compose operations for MOEI SI-01 Rolling Planning.
.DESCRIPTION
  NEVER deletes/recreates Oracle, never runs DDL, and never removes volumes.
  Start is fail-closed until Oracle 018 is demonstrably present and the
  operator confirms a VERIFIED RESTORABLE backup.
.EXAMPLE
  .\scripts\si-rolling-docker.ps1 -Action Build
  .\scripts\si-rolling-docker.ps1 -Action Preflight
  .\scripts\si-rolling-docker.ps1 -Action Start -BackupVerified
  .\scripts\si-rolling-docker.ps1 -Action Verify
#>
param(
 [ValidateSet('Build','Preflight','Start','Verify')]
 [string]$Action='Preflight',
 [switch]$BackupVerified
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$project=Split-Path -Parent $PSScriptRoot
$dc=@('-f','compose.yaml',
      '-f','compose.google-psc.yaml',
      '-f','compose.oracle.yaml',
      '-f','compose.incident-google.yaml')
function EnsureExit([string]$stage){
 if($LASTEXITCODE -ne 0){throw "SI rolling $stage failed (exit $LASTEXITCODE). No database changes have been made by this script."}
}
Push-Location $project
try{
 foreach($file in @('compose.yaml','compose.google-psc.yaml',
                   'compose.oracle.yaml','compose.incident-google.yaml')){
  if(-not (Test-Path $file)){throw "Required Docker Compose file missing: $file"}
 }
 # No paid incident triage is needed for planning acceptance/UAT.
 $env:NMC_INCIDENT_AUTO_TRIAGE_ENABLED='false'
 docker compose @dc config --quiet
 EnsureExit 'configuration'
 if($Action -eq 'Build'){
  docker compose @dc build ai-proxy nmc
  EnsureExit 'build'
  Write-Host "Images built. Next: run -Action Preflight. Nothing restarted." -ForegroundColor Green
 }
 elseif($Action -eq 'Preflight'){
  Write-Host 'READ-ONLY Oracle 018 schema review, against configured database.' -ForegroundColor Cyan
  docker compose @dc run --rm --no-deps ai-proxy node tools/reconcile-moei-schema.mjs --plan --report=/data/moei-rolling-plan-018.json
  EnsureExit 'schema plan'
  Write-Host 'Checking required SI_PLAN_ROLLING objects (read-only).' -ForegroundColor Cyan
  docker compose @dc run --rm --no-deps ai-proxy node tools/check-si-rolling-oracle.mjs
  if($LASTEXITCODE -ne 0){
   Write-Warning 'Migration 018 not ready. STOP: obtain restorable backup, DBA-review SQL migration 018, apply only when authorized. Re-run Preflight afterward.'
  } else {
   Write-Host 'Migration 018 readiness: READY. No schema mutations executed.' -ForegroundColor Green
  }
 }
 elseif($Action -eq 'Start'){
  if(-not $BackupVerified){
   throw 'Refusing to replace containers until restorable Oracle and /data backup is verified. Re-run -Action Start -BackupVerified after confirming backups.'
  }
  # Fail closed before touching running ai-proxy or nmc containers.
  docker compose @dc run --rm --no-deps ai-proxy node tools/check-si-rolling-oracle.mjs
  EnsureExit 'Oracle 018 readiness'
  docker compose @dc up -d --no-deps --no-build --force-recreate ai-proxy nmc
  EnsureExit 'application rollout'
  Write-Host 'Application restarted. Validate health, authentication, and SI-01 UAT before approval.' -ForegroundColor Green
 }
 elseif($Action -eq 'Verify'){
  docker compose @dc ps
  EnsureExit 'container status'
  docker compose @dc logs --tail=100 ai-proxy
  EnsureExit 'backend logs'
  docker compose @dc exec -T ai-proxy node tools/check-si-rolling-oracle.mjs
  EnsureExit 'rolling Oracle readiness'
  Write-Host 'Next: log in to the browser and execute the manual business UAT scenario.' -ForegroundColor Cyan
 }
}
finally{Pop-Location}
