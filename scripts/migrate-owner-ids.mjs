/**
 * Reassign legacy matchaontoph ownership to a Firebase Auth UID.
 *
 * Prefer Admin SDK (bypasses Firestore rules). Set one of:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json
 *   --service-account=/path/to/serviceAccount.json
 *
 * Fallback: unauthenticated REST with the web API key (only works if rules still allow it).
 *
 *   npm run migrate:owner-ids -- --uid <firebase-uid>
 *   npm run migrate:owner-ids -- --uid <firebase-uid> --dry-run
 *   npm run migrate:owner-ids -- --uid <firebase-uid> --service-account ./serviceAccount.json
 *
 * Deploy hardened Firestore rules only after this completes, and set FOUNDER_UID
 * in firestore.rules / storage.rules to the same UID.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const require = createRequire(import.meta.url);
const LEGACY_OWNER_ID = 'matchaontoph';
const dryRun = process.argv.includes('--dry-run');
const WRITE_DELAY_MS = 80;

function parseArg(name) {
  const eq = process.argv.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1).trim();
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return String(process.argv[idx + 1]).trim();
  return '';
}

function parseUid() {
  return parseArg('--uid');
}

function parseServiceAccountPath() {
  const fromArg = parseArg('--service-account');
  if (fromArg) return resolve(fromArg);
  const fromEnv = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (fromEnv) return resolve(fromEnv);
  return '';
}

function profileDocId(ownerId) {
  return String(ownerId || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
}

function loadDestConfig() {
  const code = readFileSync(join(root, 'js', 'config.js'), 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(code, sandbox, { filename: 'config.js' });
  const cfg = sandbox.window.FIREBASE_CONFIG;
  if (!cfg?.projectId || !cfg?.apiKey) throw new Error('js/config.js missing FIREBASE_CONFIG');
  return cfg;
}

function docIdFromName(name) {
  const parts = String(name || '').split('/');
  return parts[parts.length - 1] || '';
}

function fieldString(fields, key) {
  return fields?.[key]?.stringValue ?? null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function listCollection(projectId, apiKey, collectionId) {
  const docs = [];
  let pageToken = '';
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collectionId}`;

  do {
    const url = new URL(base);
    url.searchParams.set('pageSize', '300');
    url.searchParams.set('key', apiKey);
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url);
    if (res.status === 404) return docs;
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`List ${collectionId} failed (${res.status}): ${text.slice(0, 300)}`);
    }
    const body = await res.json();
    if (Array.isArray(body.documents)) docs.push(...body.documents);
    pageToken = body.nextPageToken || '';
  } while (pageToken);

  return docs;
}

async function patchFields(projectId, apiKey, collectionId, docId, patchFieldsObj) {
  const fieldPaths = Object.keys(patchFieldsObj);
  const mask = fieldPaths.map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collectionId}/${encodeURIComponent(docId)}?${mask}&key=${encodeURIComponent(apiKey)}`;
  const fields = {};
  for (const [key, val] of Object.entries(patchFieldsObj)) {
    fields[key] = { stringValue: String(val) };
  }
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Patch ${collectionId}/${docId} failed (${res.status}): ${text.slice(0, 300)}`);
  }
}

async function setDocument(projectId, apiKey, collectionId, docId, fields) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collectionId}/${encodeURIComponent(docId)}?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Set ${collectionId}/${docId} failed (${res.status}): ${text.slice(0, 300)}`);
  }
}

function mergeProfileFields(legacyFields, newUid) {
  const out = { ...(legacyFields || {}) };
  out.ownerId = { stringValue: profileDocId(newUid) };
  out.updatedAt = { integerValue: String(Date.now()) };
  return out;
}

async function migrateFieldRest(dest, collectionId, fieldName, newUid) {
  const docs = await listCollection(dest.projectId, dest.apiKey, collectionId);
  let count = 0;
  for (const item of docs) {
    const id = docIdFromName(item.name);
    if (!id || !item.fields) continue;
    if (fieldString(item.fields, fieldName) !== LEGACY_OWNER_ID) continue;
    count += 1;
    console.log(`  ${collectionId}/${id}: ${fieldName} → ${newUid}`);
    if (!dryRun) {
      await patchFields(dest.projectId, dest.apiKey, collectionId, id, { [fieldName]: newUid });
      if (WRITE_DELAY_MS > 0) await sleep(WRITE_DELAY_MS);
    }
  }
  return count;
}

async function migrateUserProfileRest(dest, newUid) {
  const legacyId = profileDocId(LEGACY_OWNER_ID);
  const newId = profileDocId(newUid);
  const docs = await listCollection(dest.projectId, dest.apiKey, 'userProfiles');
  const legacy = docs.find((d) => docIdFromName(d.name) === legacyId);
  if (!legacy?.fields) {
    console.log('  userProfiles: no legacy profile doc');
    return 0;
  }
  console.log(`  userProfiles: merge ${legacyId} → ${newId}`);
  if (!dryRun) {
    await setDocument(dest.projectId, dest.apiKey, 'userProfiles', newId, mergeProfileFields(legacy.fields, newUid));
    if (WRITE_DELAY_MS > 0) await sleep(WRITE_DELAY_MS);
  }
  return 1;
}

function loadAdmin(serviceAccountPath, projectId) {
  let admin;
  try {
    admin = require('firebase-admin');
  } catch {
    throw new Error(
      'firebase-admin is not installed. Run: npm install --save-dev firebase-admin\n'
      + 'Then re-run with GOOGLE_APPLICATION_CREDENTIALS or --service-account set.',
    );
  }
  if (admin.apps.length) return admin;
  if (serviceAccountPath) {
    if (!existsSync(serviceAccountPath)) {
      throw new Error(`Service account file not found: ${serviceAccountPath}`);
    }
    const sa = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
    admin.initializeApp({
      credential: admin.credential.cert(sa),
      projectId: sa.project_id || projectId,
    });
  } else {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId,
    });
  }
  return admin;
}

async function migrateFieldAdmin(db, collectionId, fieldName, newUid) {
  const snap = await db.collection(collectionId).get();
  let count = 0;
  for (const doc of snap.docs) {
    const data = doc.data() || {};
    if (String(data[fieldName] || '') !== LEGACY_OWNER_ID) continue;
    count += 1;
    console.log(`  ${collectionId}/${doc.id}: ${fieldName} → ${newUid}`);
    if (!dryRun) {
      await doc.ref.update({ [fieldName]: newUid });
      if (WRITE_DELAY_MS > 0) await sleep(WRITE_DELAY_MS);
    }
  }
  return count;
}

async function migrateUserProfileAdmin(db, newUid) {
  const legacyId = profileDocId(LEGACY_OWNER_ID);
  const newId = profileDocId(newUid);
  const legacySnap = await db.collection('userProfiles').doc(legacyId).get();
  if (!legacySnap.exists) {
    console.log('  userProfiles: no legacy profile doc');
    return 0;
  }
  const data = legacySnap.data() || {};
  console.log(`  userProfiles: merge ${legacyId} → ${newId}`);
  if (!dryRun) {
    await db.collection('userProfiles').doc(newId).set({
      ...data,
      ownerId: newId,
      updatedAt: Date.now(),
    }, { merge: true });
    if (WRITE_DELAY_MS > 0) await sleep(WRITE_DELAY_MS);
  }
  return 1;
}

async function runWithAdmin(dest, newUid, serviceAccountPath) {
  const admin = loadAdmin(serviceAccountPath, dest.projectId);
  const db = admin.firestore();
  let total = 0;
  total += await migrateFieldAdmin(db, 'logs', 'userId', newUid);
  total += await migrateFieldAdmin(db, 'lists', 'ownerId', newUid);
  total += await migrateFieldAdmin(db, 'events', 'submittedBy', newUid);
  total += await migrateFieldAdmin(db, 'logComments', 'authorId', newUid);
  total += await migrateUserProfileAdmin(db, newUid);
  return total;
}

async function runWithRest(dest, newUid) {
  let total = 0;
  total += await migrateFieldRest(dest, 'logs', 'userId', newUid);
  total += await migrateFieldRest(dest, 'lists', 'ownerId', newUid);
  total += await migrateFieldRest(dest, 'events', 'submittedBy', newUid);
  total += await migrateFieldRest(dest, 'logComments', 'authorId', newUid);
  total += await migrateUserProfileRest(dest, newUid);
  return total;
}

async function main() {
  const newUid = parseUid();
  if (!newUid) {
    console.error('Usage: npm run migrate:owner-ids -- --uid <firebase-auth-uid> [--dry-run] [--service-account path.json]');
    process.exit(1);
  }

  const dest = loadDestConfig();
  const serviceAccountPath = parseServiceAccountPath();
  const useAdmin = Boolean(serviceAccountPath || process.env.GOOGLE_APPLICATION_CREDENTIALS);

  console.log(`Migrate owner ids: ${LEGACY_OWNER_ID} → ${newUid} (project ${dest.projectId})`);
  console.log(`Mode: ${useAdmin ? 'Admin SDK (recommended)' : 'REST + web API key (may fail under hardened rules)'}`);
  if (dryRun) console.log('(dry run — no writes)\n');

  let total = 0;
  if (useAdmin) {
    total = await runWithAdmin(dest, newUid, serviceAccountPath);
  } else {
    console.warn('Warning: without a service account, writes may be denied by firestore.rules.');
    console.warn('Generate a key: Firebase Console → Project settings → Service accounts → Generate new private key');
    total = await runWithRest(dest, newUid);
  }

  console.log(`\nDone. ${dryRun ? 'Would update' : 'Updated'} ${total} document(s).`);
  console.log(`Set FOUNDER_UID_PLACEHOLDER in firestore.rules and storage.rules to: ${newUid}`);
  console.log('Then: firebase deploy --only firestore:rules,storage');
}

main().catch((err) => {
  console.error('Migration failed:', err?.message || err);
  process.exit(1);
});
