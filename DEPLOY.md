# Chakaiki — deploy guide (after repo setup)

You already have a self-contained repo on GitHub with the app code, `firestore.rules`, and a committed `app.bundle.js`. This guide covers everything **after** that: new Firebase project, keys, rules, hosting, domain, and launch checks.

**Backend:** Firebase Firestore + Storage (+ optional Anonymous Auth)  
**Frontend:** static files only (`index.html`, `bootstrap.js`, `app.bundle.js`, `js/`, `styles/`, `vendor/`, `assets/`)  
**Recommended host:** Firebase Hosting (same console as your database)

---

## Overview

| Step | What | Time |
|------|------|------|
| 1 | Create Firebase project | ~10 min |
| 2 | Local `js/config.js` | ~5 min |
| 3 | Firebase CLI + deploy config files | ~10 min |
| 4 | Deploy Firestore rules | ~2 min |
| 5 | Storage rules | ~5 min |
| 6 | Storage CORS (share cards) | ~10 min |
| 7 | Google Maps API key | ~10 min |
| 8 | Deploy hosting | ~5 min |
| 9 | Custom domain + SSL | ~15 min (+ DNS propagation) |
| 10 | Smoke test | ~15 min |
| 11 | (Optional) Migrate data from old project | varies |

---

## Step 1 — Create a new Firebase project

Use a **new** project (e.g. `chakaiki-prod`). Do not reuse `matchanese-attendance` unless you intentionally want shared data.

1. Open [Firebase Console](https://console.firebase.google.com/) → **Add project**.
2. **Firestore Database** → Create database → start in **production mode** (you will deploy rules from this repo).
3. **Storage** → Get started (default bucket is fine).
4. **Authentication** (required for uploads with this repo’s defaults):
   - Sign-in method → enable **Anonymous**.
   - The app defaults to `CHAKAIKI_SKIP_ANONYMOUS_AUTH = false` in `js/config.example.js` (copy to `js/config.js` on each machine).

### Register the web app

Project settings → **Your apps** → Web (`</>`) → register (no Hosting needed yet). Copy the `firebaseConfig` object — you will paste it into `js/config.js` in Step 2.

---

## Step 2 — Local config

On your machine (not committed to Git):

```bash
cp js/config.example.js js/config.js
```

Edit `js/config.js`:

```js
window.GOOGLE_MAPS_API_KEY = 'AIza...';

window.FIREBASE_CONFIG = {
  apiKey: '...',
  authDomain: 'chakaiki-prod.firebaseapp.com',
  projectId: 'chakaiki-prod',
  storageBucket: 'chakaiki-prod.appspot.com',
  messagingSenderId: '...',
  appId: '...',
};

// Default in config.example.js — anonymous sign-in before Storage uploads
window.CHAKAIKI_SKIP_ANONYMOUS_AUTH = false;
```

**Quick local test:**

```bash
npm run build          # only if you changed JSX
npx serve .            # or any static server on the repo root
```

Open `http://localhost:3000` (or the port `serve` prints). The app must be served from the **folder root** so `/js/config.js`, `/bootstrap.js`, and `/app.bundle.js` resolve.

Without valid keys the app shows a fatal error (Maps key) or cannot talk to Firestore.

---

## Step 3 — Firebase CLI and deploy config

Install CLI (once per machine):

```bash
npm i -g firebase-tools
firebase login
```

From the repo root, initialize and link the project:

```bash
firebase use --add
# choose your new project, alias e.g. "prod"
```

Add these files to the repo root — **`firebase.json` and `storage.rules` are already in the repo.** Link your project with the CLI (above), then deploy when ready (Steps 4–5).

`firebase.json` sets Hosting `public` to `.`, ignores source-only paths, and uses `no-cache` on JS/CSS/HTML during active development.

### `storage.rules` (already in repo)

Storage paths used by the app:

| Path | Purpose |
|------|---------|
| `logs/{logId}/*` | Post photos |
| `lists/{listId}/*` | List entry photos |
| `profiles/{id}/*` | Profile avatars |
| `events/{eventId}/*` | Event images |
| `brandLogos/{brandId}.*` | Brand logos |
| `placePhotos/*` | Place detail photos |

Default rules (matches `CHAKAIKI_SKIP_ANONYMOUS_AUTH = false`): public read, **authenticated write**.

**Temporary beta only** — if you set `CHAKAIKI_SKIP_ANONYMOUS_AUTH = true` locally, change `storage.rules` to `allow write: if true` until you re-enable anonymous auth.

### `.firebaserc` (created by `firebase use --add`)

Example:

```json
{
  "projects": {
    "prod": "chakaiki-prod"
  }
}
```

Commit `firebase.json` and `storage.rules`. **Do not** commit `.firebaserc` if it embeds secrets (it usually only has project IDs — committing is fine). Never commit `js/config.js`.

---

## Step 4 — Deploy Firestore rules

Your repo’s `firestore.rules` already defines collections: `cafes`, `logs`, `logComments`, `settings`, `brandPopUps`, likes, `placeDetails`, `events`, `lists`, `userProfiles`.

Many paths use `allow write: if true` — acceptable for a private beta; tighten before a wide public launch.

```bash
firebase deploy --only firestore:rules
```

Verify in Firebase Console → Firestore → **Rules** that the published rules match the file.

---

## Step 5 — Deploy Storage rules

```bash
firebase deploy --only storage
```

Or paste rules in Console → Storage → **Rules** if you prefer not to use the CLI.

If uploads fail with `storage/unauthorized`:

- Enable Anonymous Auth and set `CHAKAIKI_SKIP_ANONYMOUS_AUTH = false`, **or**
- Temporarily use open write rules (beta only).

---

## Step 6 — Storage CORS (required for share-card export)

Share cards draw post photos onto a canvas. Cross-origin images without CORS break export (“photo may block canvas”).

1. [Google Cloud Console](https://console.cloud.google.com/) → select the **same project** as Firebase.
2. **Cloud Storage** → your Firebase bucket (e.g. `chakaiki-prod.appspot.com`).
3. Bucket → **Configuration** → **CORS** → edit.

Example CORS JSON (adjust origins):

```json
[
  {
    "origin": [
      "http://localhost:3000",
      "http://localhost:5000",
      "https://chakaiki-prod.web.app",
      "https://chakaiki-prod.firebaseapp.com",
      "https://matchanese.site",
      "https://www.matchanese.site"
    ],
    "method": ["GET", "HEAD"],
    "responseHeader": ["Content-Type", "Access-Control-Allow-Origin"],
    "maxAgeSeconds": 3600
  }
]
```

Apply via `gcloud` if the Console UI is awkward:

```bash
# save cors.json with the array above, then:
gcloud storage buckets update gs://YOUR_BUCKET_NAME --cors-file=cors.json
```

Add every origin where the app is served (Firebase default URLs + custom domain + localhost).

---

## Step 7 — Google Maps API key

In [Google Cloud Console](https://console.cloud.google.com/) (same project as Maps or a dedicated one):

1. Enable **Maps JavaScript API** and **Places API**.
2. APIs & Services → **Credentials** → create or edit an API key.
3. Put the key in `js/config.js` as `GOOGLE_MAPS_API_KEY`.

**Application restrictions** → HTTP referrers:

```
http://localhost:*
http://127.0.0.1:*
https://chakaiki-prod.web.app/*
https://chakaiki-prod.firebaseapp.com/*
https://matchanese.site/*
https://www.matchanese.site/*
```

**API restrictions** → restrict to Maps JavaScript API + Places API only.

The app loads Maps from `index.html` and fails fast if the key is missing or still `YOUR_GOOGLE_MAPS_API_KEY`.

---

## Step 8 — Deploy hosting

`js/config.js` is **not** in Git. For production you have two options:

### Option A — Config on the server (simplest)

1. Deploy the repo as-is.
2. On the server / in your deploy script, create `js/config.js` from a secret or CI env (copy from example and inject values).

### Option B — Build-time inject (CI)

In GitHub Actions (or similar), write `js/config.js` from repository secrets before `firebase deploy`.

**Deploy:**

```bash
npm run build                    # if JSX changed since last commit
firebase deploy --only hosting
```

Default URLs:

- `https://<project-id>.web.app`
- `https://<project-id>.firebaseapp.com`

**Full deploy (rules + hosting):**

```bash
firebase deploy
```

After deploy, hard-refresh or purge CDN if you redeploy often — especially `bootstrap.js` and `js/data.js`.

---

## Step 9 — Custom domain

Firebase Console → Hosting → **Add custom domain** (e.g. `matchanese.site` or `app.chakaiki.com`).

1. Add the domain and follow DNS instructions (A/CNAME records Firebase provides).
2. Wait for SSL provisioning (often minutes, sometimes up to 24h).
3. Add the **HTTPS** domain to:
   - Maps API key HTTP referrers (Step 7)
   - Storage CORS origins (Step 6)

Optional: redirect `www` → apex or the reverse, in Hosting settings.

---

## Step 10 — Smoke test checklist

Run on **desktop Chrome** and **mobile Safari** (iOS cache is aggressive).

- [ ] App loads without “Chakaiki cannot load” / Maps key error
- [ ] **Map** tab: tiles load, pins appear
- [ ] **Brands** tab: list loads (empty DB = empty state is OK)
- [ ] **Feed** tab: loads without console Firestore errors
- [ ] **New post**: pick brand/location, add photo, save → appears in feed
- [ ] **Share card**: export/download image (CORS — if this fails, recheck Step 6)
- [ ] **Lists / events / profile** if you use those flows
- [ ] `post-admin.html` is **not** deployed (404 on production — excluded in `firebase.json`)

Open DevTools → Network: confirm `js/config.js`, `bootstrap.js`, `app.bundle.js` return 200.

---

## Step 11 — (Optional) Migrate data from the old Firebase project

Skip if you want a **fresh** database.

Collections that matter if you care about legacy content:

| Firestore | Storage |
|-----------|---------|
| `logs`, `cafes`, `settings/brands`, `events`, `lists`, `userProfiles` | `logs/`, `lists/`, `profiles/`, `events/`, `brandLogos/` |
| `brandPopUps`, `placeDetails`, like collections | `placeDetails/` |

**Approaches:**

| Method | When |
|--------|------|
| Fresh start | New product, no legacy posts |
| Console export/import | One-time, moderate size |
| `gcloud firestore export` → import to new project | Larger datasets |
| Custom Node script | Copy docs + re-upload Storage files with URL rewrites |

Do not point half the traffic at the old project and half at the new one without a plan — you will split data.

---

## Auth and user identity (know before launch)

The app uses **Firebase Anonymous Auth** for a stable per-device `userId` when `CHAKAIKI_SKIP_ANONYMOUS_AUTH` is `false`. Posts, lists, events, and comments are attributed to `request.auth.uid`.

Legacy content may still use owner id `matchaontoph` until you run the owner migration (below).

Plan real multi-user sign-in (Google, email, etc.) when you outgrow the anonymous beta model.

### Phase 0 — deploy order (security hardening)

1. **Build and deploy the client** (`npm run build`, then `firebase deploy --only hosting`).
2. **Enable Anonymous Auth** in Firebase Console → Authentication → Sign-in method.
3. Open the app → **Profile** → copy the **User ID** shown at the bottom of the profile card.
4. **Migrate legacy ownership** (if you have `matchaontoph` content):

   ```bash
   npm run migrate:owner-ids -- --uid YOUR_FIREBASE_UID
   npm run migrate:owner-ids -- --uid YOUR_FIREBASE_UID --dry-run   # preview first
   ```

5. **Set founder UID in rules** — replace `FOUNDER_UID_PLACEHOLDER` in both `firestore.rules` and `storage.rules` with your UID from step 3.
6. **Deploy rules**:

   ```bash
   firebase deploy --only firestore:rules,storage
   ```

7. Smoke-test: create post, edit/delete own post, upload avatar, brand admin (founder only).

`post-admin.html` is kept locally for dev but **excluded from hosting** (`firebase.json`).

### Firestore migration script (old project)

`scripts/migrate-firestore.mjs` requires `SOURCE_FIREBASE_API_KEY` in the environment (no committed keys):

```bash
set SOURCE_FIREBASE_API_KEY=your-key
npm run migrate:firestore:dry
```

---

## Security tightening before public launch

Phase 0 rules (auth + ownership) are in `firestore.rules` and `storage.rules`. After deploy, verify unauthenticated writes are denied.

Additional hardening for a wide public release:

1. Firebase App Check
2. Admin custom claims for `settings/brands` (replace founder UID allowlist)
3. Lock down Maps key referrers to production domains only (remove overly broad `localhost` in prod key if you use separate dev/prod keys).
4. Content Security Policy headers in `firebase.json`

---

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| “Set a valid GOOGLE_MAPS_API_KEY” | `js/config.js` missing or placeholder on the host |
| “Firestore is required” | `FIREBASE_CONFIG` missing/wrong on the host |
| Map blank / Places errors | Maps or Places API not enabled, or referrer restriction blocks your domain |
| Upload fails | Storage rules, Anonymous Auth off while rules require auth, or Storage not enabled |
| Share card export fails | Storage CORS missing your site origin |
| Stale UI after deploy | CDN/browser cache — bump query strings in `index.html` or adjust `Cache-Control` |
| Works locally, broken in prod | Production host missing `js/config.js` |

---

## Suggested command sequence (copy-paste)

```bash
# one-time
cp js/config.example.js js/config.js
# edit js/config.js with Firebase + Maps keys
npm i -g firebase-tools
firebase login
firebase use --add

# firebase.json and storage.rules are in the repo
firebase deploy --only firestore:rules,storage
firebase deploy --only hosting

# or everything
firebase deploy
```

---

## What’s already done in this repo

- [x] Self-contained app at repo root (no `../` parent imports)
- [x] `firestore.rules` in repo
- [x] `firebase.json` and `storage.rules` in repo
- [x] `.firebaserc` linked to `chakaiki`
- [x] Firestore + Storage rules deployed
- [x] Storage CORS on `chakaiki` + legacy `matchanese-attendance` buckets
- [x] Maps API key referrers (localhost + `chakaiki.web.app` + `matchanese.site`)
- [x] Firebase Hosting deployed → https://chakaiki.web.app
- [x] Anonymous auth on by default (`CHAKAIKI_SKIP_ANONYMOUS_AUTH = false`)
- [x] `js/config.example.js` + `.gitignore` for `js/config.js`
- [x] `app.bundle.js` committed; `npm run build` for JSX changes
- [x] Pushed to GitHub (`origin/main`)

## What you still add / run

- [ ] New Firebase project (Firestore + Storage + **Anonymous Auth enabled**)
- [ ] `js/config.js` with new project keys (local + on host)
- [ ] `.firebaserc` from `firebase use --add` (done locally: `default` → `chakaiki`)
- [x] Deploy rules + Storage CORS + Hosting
- [ ] Custom domain DNS (Step 9 — point `matchanese.site` at Firebase Hosting if desired)
- [ ] Smoke test on mobile Safari
