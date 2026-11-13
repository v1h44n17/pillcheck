/**
 * Firestore security rules, tested against the emulator.
 *
 *   npm run test:rules        (needs Java 21+ for the Firestore emulator)
 *
 * Uses the fake project "demo-pillcheck", so nothing touches the real project.
 */
import rules from "../../firestore.rules?raw";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { addDoc, collection, deleteDoc, doc, getDocs, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { buildAuditEntry, type AuditInput } from "../../src/pipeline/step5-audit";

let env: RulesTestEnvironment;

const ANSWERED: AuditInput = {
  outcome: "answered",
  extractSource: "on_device",
  leakGuard: { result: "passed", sent: { medicines: ["ibuprofen"], cabinet: ["warfarin"] } },
  answer: { verdict: "avoid", model: "gemini-3.5-flash-lite", inferenceSource: "in_cloud", grounded: ["ibuprofen"] },
  spoken: true,
  demo: { injectedPii: false, simulate: [] },
};

const valid = () => buildAuditEntry(ANSWERED, serverTimestamp()) as unknown as Record<string, unknown>;
const audit = (uid: string, as = uid) => collection(env.authenticatedContext(as).firestore(), "users", uid, "audit");

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-pillcheck",
    // Port must match firebase.json → emulators.firestore.port (8080 is often taken by local web servers).
    firestore: { rules, host: "127.0.0.1", port: 8181 },
  });
});
afterAll(async () => env?.cleanup());
beforeEach(async () => env.clearFirestore());

describe("audit log: who can write", () => {
  it("the signed-in owner can append a valid entry", async () => {
    await assertSucceeds(addDoc(audit("alice"), valid()));
  });
  it("another user cannot write into Alice's log", async () => {
    await assertFails(addDoc(audit("alice", "mallory"), valid()));
  });
  it("a signed-out client cannot write", async () => {
    await assertFails(addDoc(collection(env.unauthenticatedContext().firestore(), "users", "alice", "audit"), valid()));
  });
});

describe("audit log: privacy-safe schema", () => {
  it("rejects an extra field (there is nowhere to put a transcript)", async () => {
    await assertFails(addDoc(audit("alice"), { ...valid(), transcript: "This is Meera, can I take Advil?" }));
  });
  it("rejects a 'blocked' entry that claims something was sent", async () => {
    const e = buildAuditEntry(
      { ...ANSWERED, outcome: "blocked", leakGuard: { result: "blocked", kinds: ["possible-name"] }, answer: undefined },
      serverTimestamp(),
    ) as unknown as Record<string, unknown>;
    await assertSucceeds(addDoc(audit("alice"), e)); // the real blocked entry is fine…
    await assertFails(addDoc(audit("alice"), { ...e, sent: { medicines: ["ibuprofen"], cabinet: [] } })); // …a lying one isn't
  });
  it("rejects a record of Step 2 running in the cloud", async () => {
    await assertFails(addDoc(audit("alice"), { ...valid(), inferenceSource: { extract: "in_cloud", check: "in_cloud" } }));
  });
  it("rejects caught text in the findings list", async () => {
    await assertFails(
      addDoc(audit("alice"), { ...valid(), leakGuard: { result: "blocked", findings: ["Meera Sharma"] } }),
    );
  });
  it("rejects a client-chosen timestamp", async () => {
    await assertFails(addDoc(audit("alice"), { ...valid(), at: new Date("2020-01-01") }));
  });
  it("rejects more than 5 medicines sent", async () => {
    await assertFails(
      addDoc(audit("alice"), {
        ...valid(),
        sent: { medicines: ["a-a", "b-b", "c-c", "d-d", "e-e", "f-f"], cabinet: [] },
      }),
    );
  });
});

describe("audit log: append-only, private", () => {
  it("entries cannot be edited or deleted, even by the owner", async () => {
    const ref = await assertSucceeds(addDoc(audit("alice"), valid()));
    await assertFails(updateDoc(ref, { verdict: "ok" }));
    await assertFails(deleteDoc(ref));
  });
  it("only the owner can read the log", async () => {
    await assertSucceeds(addDoc(audit("alice"), valid()));
    await assertSucceeds(getDocs(audit("alice")));
    await assertFails(getDocs(audit("alice", "mallory")));
  });
  it("everything outside users/{uid}/audit is denied", async () => {
    const db = env.authenticatedContext("alice").firestore();
    await assertFails(setDoc(doc(db, "anything", "x"), { a: 1 }));
    await assertFails(setDoc(doc(db, "users", "alice"), { name: "Meera" }));
  });
});
