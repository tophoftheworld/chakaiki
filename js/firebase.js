/**
 * Firebase Firestore and Storage init. Requires Firebase compat scripts loaded before this module
 * (firebase-app-compat, firebase-auth-compat, firebase-firestore-compat, firebase-storage-compat).
 * Set window.FIREBASE_CONFIG in config.js. If not set, getDb() returns null and data layer falls back to IndexedDB.
 */

let firestore = null;
let storage = null;

/** Legacy owner id before anonymous UID bridge — used by migration scripts only. */
export const LEGACY_OWNER_ID = 'matchaontoph';

/** @deprecated Runtime identity uses Firebase Auth UID. Kept for migration reference. */
export const HARDCODED_PROFILE = {
  ownerId: LEGACY_OWNER_ID,
  name: 'Cristopher David',
  username: '@matchaontoph',
};

export function initFirebase() {
  if (firestore !== null) return firestore;
  const firebase = typeof window !== 'undefined' ? window.firebase : null;
  const config = typeof window !== 'undefined' ? window.FIREBASE_CONFIG : null;
  if (!firebase || !config || !config.apiKey || config.apiKey === 'YOUR_API_KEY') return null;
  try {
    if (!firebase.apps || !firebase.apps.length) {
      firebase.initializeApp(config);
    }
    firestore = firebase.firestore();
    if (firebase.storage) {
      storage = firebase.storage();
    }
    return firestore;
  } catch (e) {
    console.warn('[Chakaiki] Firebase init failed:', e?.message || e);
    return null;
  }
}

export function getDb() {
  if (firestore === null) initFirebase();
  return firestore;
}

export function getStorage() {
  if (storage === null) initFirebase();
  return storage;
}

export const CAFES_COLLECTION = 'cafes';
export const LOGS_COLLECTION = 'logs';
export const SETTINGS_COLLECTION = 'settings';
export const BRANDS_CONFIG_DOC = 'brands';
export const PLACE_DETAILS_COLLECTION = 'placeDetails';
export const BRAND_POPUPS_COLLECTION = 'brandPopUps';
export const BRAND_LIKES_COLLECTION = 'brandLikes';
export const LOCATION_LIKES_COLLECTION = 'locationLikes';
export const LOG_POST_LIKES_COLLECTION = 'logPostLikes';
export const EVENTS_COLLECTION = 'events';
export const LISTS_COLLECTION = 'lists';
export const USER_PROFILES_COLLECTION = 'userProfiles';

let _currentUserId = null;
let _authInitPromise = null;
let _authDisabled = false;

export function skipAnonymousAuthByConfig() {
  return typeof window !== 'undefined' && (
    window.CHAKAIKI_SKIP_ANONYMOUS_AUTH === true
    || window.MATCHA_HOP_SKIP_ANONYMOUS_AUTH === true
  );
}

function getFirebase() {
  return typeof window !== 'undefined' ? window.firebase : null;
}

function getAuth() {
  const firebase = getFirebase();
  if (!firebase?.auth) return null;
  if (!firebase.apps?.length) initFirebase();
  if (!firebase.apps?.length) return null;
  return firebase.auth();
}

function syncCurrentUserIdFromAuth() {
  const firebase = getFirebase();
  // Do not touch firebase.auth() before an app is initialized — it throws
  // "No Firebase App '[DEFAULT]' has been created" (e.g. during first render).
  if (!firebase?.auth || !firebase.apps?.length) return _currentUserId;
  const user = firebase.auth().currentUser;
  if (user?.uid) {
    _currentUserId = user.uid;
    return _currentUserId;
  }
  return _currentUserId;
}

/** Initialize anonymous auth so we have a stable userId. Call after initFirebase. */
export function initAuth() {
  if (skipAnonymousAuthByConfig()) {
    return Promise.resolve(null);
  }
  if (_authDisabled) return Promise.resolve(null);
  if (_authInitPromise) return _authInitPromise;
  const auth = getAuth();
  if (!auth) return Promise.resolve(null);
  if (auth.currentUser) {
    _currentUserId = auth.currentUser.uid;
    return Promise.resolve(_currentUserId);
  }
  _authInitPromise = auth.signInAnonymously().then((cred) => {
    _currentUserId = cred.user?.uid ?? null;
    return _currentUserId;
  }).catch((e) => {
    const code = e?.code || '';
    if (code === 'auth/operation-not-allowed' || code === 'auth/admin-restricted-operation') {
      _authDisabled = true;
      console.warn('[Chakaiki] Anonymous auth disabled in Firebase project.');
    } else {
      console.warn('[Chakaiki] Anonymous auth failed:', e?.message || e);
    }
    return null;
  }).finally(() => {
    _authInitPromise = null;
  });
  return _authInitPromise;
}

/** Current Firebase Auth uid. Returns null if auth not available. */
export function getCurrentUserId() {
  return syncCurrentUserIdFromAuth() || null;
}

/** True when signed in with a non-anonymous provider (e.g. Google). */
export function isRealUser() {
  const firebase = getFirebase();
  if (!firebase?.auth || !firebase.apps?.length) return false;
  const user = firebase.auth().currentUser;
  return Boolean(user?.uid && !user.isAnonymous);
}

function deriveHandleFromUser(user) {
  const emailLocal = String(user?.email || '').split('@')[0].trim();
  if (emailLocal) {
    return emailLocal.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 30) || 'member';
  }
  const fromName = String(user?.displayName || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, 30);
  return fromName || 'member';
}

/** Base profile for the signed-in user (display fields enriched async in bootstrap). */
export function getCurrentProfile() {
  const firebase = getFirebase();
  const user = (firebase?.auth && firebase.apps?.length) ? firebase.auth().currentUser : null;
  const uid = user?.uid || getCurrentUserId() || '';
  const anonymous = Boolean(!user || user.isAnonymous || !uid);
  if (!uid || anonymous) {
    return {
      ownerId: uid || '',
      name: 'Guest',
      username: '',
      email: '',
      photoURL: null,
      isAnonymous: true,
    };
  }
  const handle = deriveHandleFromUser(user);
  const name = String(user?.displayName || '').trim() || handle || 'Guest';
  return {
    ownerId: uid,
    name,
    username: `@${handle}`,
    email: String(user?.email || '').trim(),
    photoURL: user?.photoURL || null,
    isAnonymous: false,
  };
}

/** Throws if auth did not produce a uid. */
export function requireAuthUserId() {
  const uid = getCurrentUserId();
  if (!uid) {
    throw new Error('Sign-in required. Enable Anonymous Auth in Firebase Console and reload.');
  }
  return uid;
}

/** Throws unless the current user is a non-anonymous (Google) account. */
export function requireContributorAuth() {
  if (!isRealUser()) {
    throw new Error('Sign in with Google to post, comment, or save.');
  }
  return getCurrentUserId();
}

export function getGoogleProvider() {
  const firebase = getFirebase();
  if (!firebase?.auth?.GoogleAuthProvider) {
    throw new Error('Firebase Auth is not available');
  }
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return provider;
}

function rememberUser(user) {
  if (user?.uid) _currentUserId = user.uid;
  return user;
}

/**
 * Sign in with Google. If the current session is anonymous, link Google to keep the same UID
 * (and any content created while browsing). If that Google account already exists, switch to it.
 */
export async function signInWithGoogle() {
  initFirebase();
  const firebase = getFirebase();
  const auth = getAuth();
  if (!firebase?.auth || !auth) {
    throw new Error('Firebase Auth is not available');
  }
  const provider = getGoogleProvider();
  const current = auth.currentUser;

  const finish = (user) => {
    rememberUser(user);
    return user;
  };

  const signInWithExistingCredential = async (err) => {
    const credential = err?.credential
      || (firebase.auth.GoogleAuthProvider?.credentialFromError
        ? firebase.auth.GoogleAuthProvider.credentialFromError(err)
        : null);
    if (!credential) throw err;
    const result = await auth.signInWithCredential(credential);
    return finish(result.user);
  };

  try {
    if (current && current.isAnonymous) {
      try {
        const linked = await current.linkWithPopup(provider);
        return finish(linked.user);
      } catch (err) {
        const code = err?.code || '';
        if (code === 'auth/credential-already-in-use' || code === 'auth/email-already-in-use') {
          return signInWithExistingCredential(err);
        }
        if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
          await current.linkWithRedirect(provider);
          return null;
        }
        if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
          throw new Error('Sign-in cancelled');
        }
        throw err;
      }
    }

    try {
      const result = await auth.signInWithPopup(provider);
      return finish(result.user);
    } catch (err) {
      const code = err?.code || '';
      if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
        await auth.signInWithRedirect(provider);
        return null;
      }
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        throw new Error('Sign-in cancelled');
      }
      throw err;
    }
  } catch (err) {
    if (err?.message === 'Sign-in cancelled') throw err;
    const message = err?.message || String(err);
    throw new Error(message);
  }
}

/** Complete a redirect-based Google sign-in / link flow started on a previous page load. */
export async function handleRedirectResult() {
  initFirebase();
  const auth = getAuth();
  if (!auth?.getRedirectResult) return null;
  try {
    const result = await auth.getRedirectResult();
    if (result?.user) {
      rememberUser(result.user);
      return result.user;
    }
    return null;
  } catch (e) {
    console.warn('[Chakaiki] Google redirect sign-in failed:', e?.message || e);
    return null;
  }
}

export async function signOutUser() {
  const auth = getAuth();
  if (!auth) return;
  await auth.signOut();
  _currentUserId = null;
  // Restore anonymous browsing session so feed/map keep working.
  if (!skipAnonymousAuthByConfig()) {
    await initAuth();
  }
}
