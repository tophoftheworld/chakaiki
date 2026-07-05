/**
 * One-off Firestore copy: matchanese-attendance → chakaiki
 * Uses REST API (no npm deps). Legacy logs do not pass isStrictLogV3 — open rules required.
 *
 *   1. firebase deploy --only firestore:rules --project chakaiki
 *      (point firebase.json at scripts/firestore.rules.migrate first, or copy it over firestore.rules)
 *   2. node scripts/migrate-firestore.mjs
 *   3. Restore firestore.rules and: firebase deploy --only firestore:rules --project chakaiki
 *
 *   node scripts/migrate-firestore.mjs --dry-run
 *   node scripts/migrate-firestore.mjs --only=logs,events
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const dryRun = process.argv.includes('--dry-run');
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const ONLY = onlyArg ? onlyArg.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean) : null;
const WRITE_DELAY_MS = 80;
const MAX_RETRIES = 4;

const SOURCE = {
  projectId: process.env.SOURCE_FIREBASE_PROJECT_ID || 'matchanese-attendance',
  apiKey: process.env.SOURCE_FIREBASE_API_KEY || '',
};

if (!SOURCE.apiKey) {
  console.error('Missing SOURCE_FIREBASE_API_KEY environment variable.');
  process.exit(1);
}

const COLLECTIONS = [
  'cafes',
  'logs',
  'logComments',
  'settings',
  'brandPopUps',
  'brandLikes',
  'locationLikes',
  'logPostLikes',
  'placeDetails',
  'events',
  'lists',
  'userProfiles',
];

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

async function writeDocument(projectId, apiKey, collectionId, docId, fields) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collectionId}/${encodeURIComponent(docId)}?key=${encodeURIComponent(apiKey)}`;
  const body = JSON.stringify({ fields });

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (res.ok) return;
    const text = await res.text();
    const retryable = res.status === 403 || res.status === 429 || res.status >= 500;
    if (!retryable || attempt === MAX_RETRIES) {
      throw new Error(`Write ${collectionId}/${docId} failed (${res.status}): ${text.slice(0, 300)}`);
    }
    await sleep(WRITE_DELAY_MS * attempt * 4);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function copyCollection(dest, collectionId) {
  const docs = await listCollection(SOURCE.projectId, SOURCE.apiKey, collectionId);
  if (docs.length === 0) {
    console.log(`  ${collectionId}: (empty)`);
    return 0;
  }
  console.log(`  ${collectionId}: ${docs.length} document(s)`);

  if (dryRun) return docs.length;

  let written = 0;
  for (const item of docs) {
    const id = docIdFromName(item.name);
    if (!id || !item.fields) continue;
    await writeDocument(dest.projectId, dest.apiKey, collectionId, id, item.fields);
    written += 1;
    if (WRITE_DELAY_MS > 0) await sleep(WRITE_DELAY_MS);
    if (written % 25 === 0) process.stdout.write(`    … ${written}/${docs.length}\r`);
  }
  if (written >= 25) process.stdout.write('\n');
  return written;
}

async function main() {
  const dest = loadDestConfig();
  if (dest.projectId === SOURCE.projectId) {
    throw new Error('Source and destination project IDs are the same');
  }

  console.log(`Migrate Firestore: ${SOURCE.projectId} → ${dest.projectId}`);
  if (dryRun) console.log('(dry run — no writes)\n');

  let total = 0;
  const targets = ONLY ? COLLECTIONS.filter((n) => ONLY.includes(n)) : COLLECTIONS;
  if (ONLY && targets.length === 0) {
    throw new Error(`No matching collections in --only (${ONLY.join(', ')})`);
  }
  for (const name of targets) {
    total += await copyCollection(dest, name);
  }

  console.log(`\nDone. ${dryRun ? 'Would copy' : 'Copied'} ${total} document(s).`);
  console.log('Photo URLs still reference the old Storage bucket (public reads should still work).');
}

main().catch((err) => {
  console.error('Migration failed:', err?.message || err);
  process.exit(1);
});
