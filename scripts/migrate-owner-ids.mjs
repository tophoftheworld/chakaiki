/**
 * Reassign legacy matchaontoph ownership to a Firebase Auth UID.
 *
 *   npm run migrate:owner-ids -- --uid <firebase-uid>
 *   npm run migrate:owner-ids -- --uid <firebase-uid> --dry-run
 *
 * Deploy hardened Firestore rules only after this completes.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const LEGACY_OWNER_ID = 'matchaontoph';
const dryRun = process.argv.includes('--dry-run');
const WRITE_DELAY_MS = 80;

function parseUid() {
  const eq = process.argv.find((a) => a.startsWith('--uid='));
  if (eq) return eq.slice('--uid='.length).trim();
  const idx = process.argv.indexOf('--uid');
  if (idx >= 0 && process.argv[idx + 1]) return String(process.argv[idx + 1]).trim();
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

async function migrateField(dest, collectionId, fieldName, newUid) {
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

async function migrateUserProfile(dest, newUid) {
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

async function main() {
  const newUid = parseUid();
  if (!newUid) {
    console.error('Usage: npm run migrate:owner-ids -- --uid <firebase-auth-uid> [--dry-run]');
    process.exit(1);
  }

  const dest = loadDestConfig();
  console.log(`Migrate owner ids: ${LEGACY_OWNER_ID} → ${newUid} (project ${dest.projectId})`);
  if (dryRun) console.log('(dry run — no writes)\n');

  let total = 0;
  total += await migrateField(dest, 'logs', 'userId', newUid);
  total += await migrateField(dest, 'lists', 'ownerId', newUid);
  total += await migrateField(dest, 'events', 'submittedBy', newUid);
  total += await migrateField(dest, 'logComments', 'authorId', newUid);
  total += await migrateUserProfile(dest, newUid);

  console.log(`\nDone. ${dryRun ? 'Would update' : 'Updated'} ${total} document(s).`);
  console.log(`Set FOUNDER_UID in firestore.rules and storage.rules to: ${newUid}`);
}

main().catch((err) => {
  console.error('Migration failed:', err?.message || err);
  process.exit(1);
});
