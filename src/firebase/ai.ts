import { getApp } from "firebase/app";
import { getAI, GoogleAIBackend, type AI } from "firebase/ai";

let instance: AI | undefined;

/**
 * The one Firebase AI Logic instance for PillCheck.
 *
 * - Gemini Developer API backend (no API key in the client; Firebase proxies it).
 * - `useLimitedUseAppCheckTokens: true`: every CLOUD request (Step 3) carries a
 *   single-use App Check token, which enables replay protection in the console.
 *   On-device requests (Step 2) never touch the network, so tokens aren't involved.
 *
 * Call after boot() has initialised the FirebaseApp and App Check.
 */
export function getPillcheckAI(): AI {
  instance ??= getAI(getApp(), {
    backend: new GoogleAIBackend(),
    useLimitedUseAppCheckTokens: true,
  });
  return instance;
}
