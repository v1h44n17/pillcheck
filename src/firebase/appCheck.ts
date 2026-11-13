import type { FirebaseApp } from "firebase/app";
import {
  CustomProvider,
  getToken,
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  type AppCheck,
} from "firebase/app-check";

/**
 * App Check is MANDATORY for this project (hackathon rule, Nov 2026).
 *
 * - Production: reCAPTCHA Enterprise (score-based key, invisible to the user).
 * - Local dev:  the App Check *debug provider*. The SDK prints a debug token in
 *   the browser console, which you register in Firebase console → App Check →
 *   Manage debug tokens.
 *
 * Safety: the debug provider is only switched on when BOTH the build is a dev
 * build (import.meta.env.DEV) AND VITE_APPCHECK_DEBUG=true. A production
 * build can never ship with the debug provider enabled.
 *
 * Must run BEFORE any other Firebase service (Auth, Firestore, AI Logic) makes
 * a request, so that every request carries an App Check token.
 */
export type AppCheckMode = "debug" | "recaptcha-enterprise";

export function startAppCheck(app: FirebaseApp): { appCheck: AppCheck; mode: AppCheckMode } {
  const debug = import.meta.env.DEV && import.meta.env.VITE_APPCHECK_DEBUG === "true";
  if (debug) {
    // Tells the SDK to use the debug provider. A fixed token from .env.local
    // (registered once in the console) works in every local browser; otherwise
    // the SDK generates one per browser and logs it to the console.
    globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || true;
  }

  const siteKey = import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY;
  if (!siteKey && !debug) {
    throw new Error(
      "App Check: VITE_RECAPTCHA_ENTERPRISE_SITE_KEY is missing. " +
        "Set it, or for local dev set VITE_APPCHECK_DEBUG=true.",
    );
  }

  const appCheck = initializeAppCheck(app, {
    // With the debug flag set, the SDK exchanges the debug token and never asks
    // this provider for a token. If there's no site key in debug mode, a provider
    // that never loads reCAPTCHA keeps localhost from loading the reCAPTCHA script.
    provider: siteKey
      ? new ReCaptchaEnterpriseProvider(siteKey)
      : new CustomProvider({
          getToken: () => Promise.reject(new Error("Debug mode: reCAPTCHA not configured.")),
        }),
    isTokenAutoRefreshEnabled: true,
  });

  return { appCheck, mode: debug ? "debug" : "recaptcha-enterprise" };
}

/** Fetches a token to prove App Check works end to end. Never returns the token itself. */
export async function verifyAppCheck(appCheck: AppCheck): Promise<void> {
  const { token } = await getToken(appCheck, /* forceRefresh */ false);
  if (!token) throw new Error("App Check returned an empty token.");
}
