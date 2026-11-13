import type { FirebaseApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signInAnonymously, type User } from "firebase/auth";

/**
 * Anonymous auth: Meera never sees a sign-up screen. The UID only scopes her
 * own data in Firestore (her medicine list, her audit log). No name, email or
 * phone number is ever collected.
 */
export function signInQuietly(app: FirebaseApp): Promise<User> {
  const auth = getAuth(app);
  return new Promise<User>((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        if (user) {
          unsubscribe();
          resolve(user);
        }
      },
      reject,
    );
    // Reuses the persisted anonymous user if there is one; otherwise creates one.
    if (!auth.currentUser) {
      signInAnonymously(auth).catch((err: unknown) => {
        unsubscribe();
        reject(err);
      });
    }
  });
}
