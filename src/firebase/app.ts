import { getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from "firebase/app";

/** Single FirebaseApp instance for the whole page. */
export function getFirebaseApp(options: FirebaseOptions): FirebaseApp {
  return getApps()[0] ?? initializeApp(options);
}
