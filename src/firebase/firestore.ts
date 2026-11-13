import { getApp } from "firebase/app";
import { getFirestore, type Firestore } from "firebase/firestore";

let instance: Firestore | undefined;

/**
 * Firestore for PillCheck. Requests carry App Check tokens automatically
 * (App Check is initialised in boot() before this is first used), and
 * firestore.rules limits each anonymous user to their own documents.
 */
export function getPillcheckDb(): Firestore {
  instance ??= getFirestore(getApp());
  return instance;
}
