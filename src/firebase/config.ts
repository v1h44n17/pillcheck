import type { FirebaseOptions } from "firebase/app";

/**
 * Reads the Firebase web config from Vite env vars (see .env.example).
 * These values are public identifiers, not secrets. Access control comes from
 * App Check + Security Rules, not from hiding the API key.
 */
const REQUIRED = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_APP_ID",
] as const;

export type ConfigResult =
  | { ok: true; options: FirebaseOptions }
  | { ok: false; missing: string[] };

export function readFirebaseConfig(env: ImportMetaEnv = import.meta.env): ConfigResult {
  const missing = REQUIRED.filter((k) => !env[k]);
  if (missing.length > 0) return { ok: false, missing: [...missing] };

  return {
    ok: true,
    options: {
      apiKey: env.VITE_FIREBASE_API_KEY,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: env.VITE_FIREBASE_APP_ID,
    },
  };
}
