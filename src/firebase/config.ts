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

/**
 * SECURITY: name each key explicitly. Passing `import.meta.env` as a whole
 * object makes Vite inline EVERY VITE_* variable into the bundle, including
 * the local App Check debug token. Found and fixed on Day 12, before any deploy.
 */
const ENV_FROM_BUILD = {
  VITE_FIREBASE_API_KEY: import.meta.env.VITE_FIREBASE_API_KEY,
  VITE_FIREBASE_AUTH_DOMAIN: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  VITE_FIREBASE_PROJECT_ID: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  VITE_FIREBASE_STORAGE_BUCKET: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  VITE_FIREBASE_MESSAGING_SENDER_ID: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  VITE_FIREBASE_APP_ID: import.meta.env.VITE_FIREBASE_APP_ID,
};

type FirebaseEnv = Partial<Record<keyof typeof ENV_FROM_BUILD, string>>;

export function readFirebaseConfig(env: FirebaseEnv = ENV_FROM_BUILD): ConfigResult {
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
