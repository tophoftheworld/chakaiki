# Step 7 — HTTP referrer restrictions for the Maps API key (GCP project: matchanese-attendance).
# Requires: gcloud auth login
$ErrorActionPreference = 'Stop'
$Key = 'projects/339591618451/locations/global/keys/e6194adc-0fd6-414d-81ee-3cb5ee917c68'

gcloud services api-keys update $Key `
  --project=matchanese-attendance `
  --allowed-referrers=@(
    'http://localhost:*',
    'http://127.0.0.1:*',
    'https://chakaiki.web.app/*',
    'https://chakaiki.firebaseapp.com/*',
    'https://matchanese.site/*',
    'https://www.matchanese.site/*',
    'https://matchanese-attendance.firebaseapp.com/*',
    'https://tophoftheworld.github.io/*'
  )

Write-Host 'Maps API key referrers updated.'
