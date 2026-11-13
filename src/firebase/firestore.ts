import { getApp } from "firebase/app";
import type { Firestore } from "firebase/firestore";

type FirestoreModule = typeof import("firebase/firestore");

let loading: Promise<{ db: Firestore; fs: FirestoreModule }> | undefined;

/**
 * Firestore for PillCheck, loaded on first use (Step 5 audit, privacy receipt)
 * so it isn't in the first-screen bundle. Requests carry App Check tokens
 * automatically (App Check is initialised in boot() before this is first used),
 * and firestore.rules limits each anonymous user to their own documents.
 */
export function loadFirestore(): Promise<{ db: Firestore; fs: FirestoreModule }> {
  loading ??= import("firebase/firestore").then((fs) => ({ db: fs.getFirestore(getApp()), fs }));
  // A failed chunk load (e.g. offline) must not poison every later attempt.
  loading.catch(() => (loading = undefined));
  return loading;
}
