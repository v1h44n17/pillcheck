import { readFirebaseConfig } from "./firebase/config";
import { getFirebaseApp } from "./firebase/app";
import { startAppCheck, verifyAppCheck, type AppCheckMode } from "./firebase/appCheck";
import { signInQuietly } from "./firebase/auth";

/**
 * Boot order matters:
 *   1. config   2. FirebaseApp   3. App Check (before ANY other service)   4. Auth
 * Every later Firebase call (Firestore, AI Logic, Remote Config) then carries
 * an App Check token automatically.
 */
export type BootReport =
  | { ok: false; stage: "config"; missing: string[] }
  | { ok: false; stage: "appcheck" | "auth"; error: string; appCheckMode?: AppCheckMode }
  | { ok: true; uid: string; appCheckMode: AppCheckMode; projectId: string };

export async function boot(): Promise<BootReport> {
  const cfg = readFirebaseConfig();
  if (!cfg.ok) return { ok: false, stage: "config", missing: cfg.missing };

  const app = getFirebaseApp(cfg.options);

  let appCheckMode: AppCheckMode;
  try {
    const started = startAppCheck(app);
    appCheckMode = started.mode;
    await verifyAppCheck(started.appCheck);
  } catch (e) {
    return { ok: false, stage: "appcheck", error: message(e) };
  }

  try {
    const user = await signInQuietly(app);
    return { ok: true, uid: user.uid, appCheckMode, projectId: cfg.options.projectId ?? "?" };
  } catch (e) {
    return { ok: false, stage: "auth", error: message(e), appCheckMode };
  }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
