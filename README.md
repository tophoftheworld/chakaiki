# Chakaiki

Self-contained web app for matcha cafe discovery, posts, lists, and events.

## Quick start

1. Copy `js/config.example.js` → `js/config.js` and add your Google Maps + Firebase keys.
2. Serve this folder from any static host (root URL should point at `index.html`).
3. After editing JSX, run `npm run build` to regenerate `app.bundle.js`.

## Folder layout

```
chakaiki/
  index.html          # App entry
  bootstrap.js        # Firebase, data, maps bridge
  app.bundle.js       # Built React UI (run npm run build)
  app-main.jsx        # React source (edit + build)
  components/         # React screens
  js/                 # Data layer, maps, Firebase (no parent deps)
  styles/             # Map overlay CSS
  vendor/             # React runtime
  assets/             # Static assets
  firestore.rules     # Deploy to Firebase separately
```

This folder has **no imports outside itself** — copy it anywhere as its own repo.

## Deploy

Upload the whole `chakaiki/` directory to your host. Ensure these paths are served:

- `/` or `/index.html`
- `/js/config.js` (not committed — create on server from example)
- `/app.bundle.js`, `/bootstrap.js`, `/styles/*`, `/vendor/*`

Purge CDN/cache after deploy, especially for `js/data.js` and `bootstrap.js`.

## Legacy note

Previously lived at `matcha-hop/v2/` and shared `matcha-hop/js/` with the old v1 app. That split caused stale-cache import errors on mobile. Everything needed by Chakaiki now lives inside this folder.
