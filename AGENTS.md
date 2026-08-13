# Chakaiki

Self-contained, single-page web app for matcha cafe discovery (posts, lists, events). It is a **static frontend only** — there is no backend in this repo. At runtime it talks to **Google Maps JavaScript API + Places** and **Firebase** (Firestore, Storage, Anonymous Auth). See `README.md` and `DEPLOY.md` for the product/deploy overview.

## Cursor Cloud specific instructions

### Services
There is exactly one runnable service: the static web app, served from the repository **root**. `js/`, `bootstrap.js`, and `app.bundle.js` must all resolve relative to `/`, so always serve the repo root (not a subfolder).

### Build / lint / test
- **Build:** `npm run build` (esbuild) bundles `components/*.jsx` + `app-main.jsx` into `app.bundle.js`. Only run this after editing those JSX files. `app.bundle.js` is committed and the build is reproducible (no diff if sources are unchanged).
- **Non-obvious:** `bootstrap.js`, `js/*.js` (e.g. `js/firebase.js`, `js/data.js`) are served **raw as ES modules and are NOT bundled**. Editing them takes effect on a browser reload with **no rebuild**. Only the JSX under `components/` and `app-main.jsx` go through `npm run build`.
- **Lint:** none configured (no ESLint/Prettier). **Tests:** none configured (no test runner). Don't invent a lint/test command.
- The build/serve toolchain (`esbuild`, `serve`) is installed by the update script into `node_modules` and invoked via `npx`.

### Run
- Serve the root: `npx serve -l 3000 .` (or `python3 -m http.server 3000`). Open `http://localhost:3000/`.
- Requires `js/config.js` (gitignored). Create it with `cp js/config.example.js js/config.js` and fill in keys.

### Runtime config gotchas (important)
- **Google Maps key is a hard gate.** `index.html` shows a fatal "Chakaiki cannot load" screen (`window.__V2_FATAL__`) unless `window.GOOGLE_MAPS_API_KEY` is set to a non-placeholder value. Any non-`YOUR_API_KEY` string gets past the gate; an *invalid* key still lets the app shell/Feed render (only the Map tab / Places search break).
- **Firestore is required to boot past the loading screen.** `assertV2Firestore()` (in `bootstrap.js`) throws unless `getDb()` is non-null (needs `FIREBASE_CONFIG.apiKey` set) and there is an anonymous-auth UID (unless `window.CHAKAIKI_SKIP_ANONYMOUS_AUTH = true`).
- Writing a post enforces Firestore security rules: `logs` docs must be `schemaVersion == 3` and `userId == request.auth.uid`. `settings/brands` is **admin-only** to write, so brands must be seeded server-side, not from the client UI.

### Running fully locally without real cloud keys (how the create-post flow was verified)
Real Google Maps + Firebase keys are the normal dev path. To exercise the app end-to-end offline, use the **Firebase Emulator Suite** (Java 21 and `firebase-tools` are available):
1. Start emulators for `auth`, `firestore`, `storage` against a **demo project** (`--project demo-chakaiki` so no real project is contacted), with `firestore.rules` + `storage.rules`.
2. Point the client at the emulators. Since `js/firebase.js` has no built-in emulator support, add a **temporary** `firestore.useEmulator(...)` / `firebase.auth().useEmulator(...)` / `storage.useEmulator(...)` call in `initFirebase()` and revert it before committing (it is product code — do not commit it). Set a matching `FIREBASE_CONFIG` (projectId `demo-chakaiki`) plus a placeholder `GOOGLE_MAPS_API_KEY` in `js/config.js`.
3. Seed a brand so the compose form has something to pick, e.g. admin write via the emulator REST API (`Authorization: Bearer owner` bypasses rules) to `settings/brands`.
4. Then a post can be created through the UI (compose "+" → pick brand → caption → Post) and it persists to the Firestore emulator through the security rules.
