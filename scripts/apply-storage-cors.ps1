# Apply Storage CORS for share-card canvas export (Step 6).
# Requires: gcloud auth login (same Google account as Firebase)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$CorsFile = Join-Path $PSScriptRoot 'storage-cors.json'

gcloud storage buckets update gs://chakaiki.firebasestorage.app `
  --cors-file=$CorsFile `
  --project=chakaiki

# Legacy bucket — migrated post photos still load from here until Storage is migrated
gcloud storage buckets update gs://matchanese-attendance.firebasestorage.app `
  --cors-file=$CorsFile `
  --project=matchanese-attendance

Write-Host 'CORS applied to chakaiki + matchanese-attendance buckets.'
