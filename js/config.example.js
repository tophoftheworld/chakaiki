/**
 * Copy to config.js and fill in your keys.
 * - GOOGLE_MAPS_API_KEY: Maps JavaScript API + Places API
 * - FIREBASE_CONFIG: Firebase Console → Project settings → Your apps (Web)
 */
window.GOOGLE_MAPS_API_KEY = 'YOUR_GOOGLE_MAPS_API_KEY';

window.FIREBASE_CONFIG = {
  apiKey: 'YOUR_FIREBASE_API_KEY',
  authDomain: 'your-project.firebaseapp.com',
  projectId: 'your-project-id',
  storageBucket: 'your-project.appspot.com',
  messagingSenderId: '000000000000',
  appId: '1:000000000000:web:0000000000000000000000',
};

/** Skip anonymous Firebase auth for faster startup. Set false if Storage rules require auth. */
window.CHAKAIKI_SKIP_ANONYMOUS_AUTH = true;
