import { getAuth } from "firebase/auth";
import type { FieldValue } from "firebase/firestore";
import { getApp } from "firebase/app";
import { isCanonicalIngredient } from "../data/lexicon";
import { loadFirestore } from "../firebase/firestore";
import type { FindingKind } from "../guards/leakGuard";
import { ROUTING_POLICY } from "./policy";

/**
 * STEP 5: audit log (Cloud Firestore, users/{uid}/audit/{autoId}).
 *
 * One entry per check, recording WHERE each step ran and WHAT left the device,
 * so the routing policy is verifiable after the fact, not just claimed.
 *
 * Privacy by construction. An entry can only contain:
 *   - fixed status words (outcome, route, verdict, model name, finding TYPES),
 *   - canonical ingredient names that were ACTUALLY sent in Step 3
 *     (already public: they went to Gemini and openFDA),
 *   - booleans and the demo flags.
 * Never the transcript, never the names Meera said ("Advil"), never the text
 * the leak guard caught. `assertAuditSafe` enforces this on the client, and
 * firestore.rules enforces the same schema on the server.
 */

export const AUDIT_SCHEMA_VERSION = 1;
export const APP_VERSION = "0.1.0";

export const OUTCOMES = [
  "answered", // full pipeline ran
  "blocked", // leak guard stopped the cloud call
  "refused", // on-device capability missing / routing violation
  "no-medicine", // Nano found no medicine name
  "not-understood", // Nano's answer unusable
  "check-unavailable", // cloud unreachable
  "check-failed", // cloud answer unusable
] as const;
export type Outcome = (typeof OUTCOMES)[number];

const VERDICTS = ["ok", "caution", "avoid", "unsure"] as const;
const SIMULATE_FLAGS = ["no-nano", "no-speech", "inject-pii"] as const;
const FINDING_KINDS: readonly FindingKind[] = [
  "unexpected-field", "not-a-list", "not-text", "too-many", "too-long", "email", "phone", "date",
  "id-number", "digits", "address", "title", "personal-phrase", "possible-name", "unknown-term",
];

/** What the orchestrator knows at the end of a run. */
export interface AuditInput {
  outcome: Outcome;
  /** Did Step 2 run (and where did the SDK say it ran)? */
  extractSource?: string;
  leakGuard: { result: "passed"; sent: { medicines: string[]; cabinet: string[] } } | { result: "blocked"; kinds: FindingKind[] } | { result: "not-run" };
  answer?: { verdict: string; model: string; inferenceSource: string; grounded: string[] };
  spoken: boolean;
  demo: { injectedPii: boolean; simulate: string[] };
}

export interface AuditEntry {
  schemaVersion: number;
  at: FieldValue | Date;
  outcome: Outcome;
  route: { transcribe: "on-device"; extract: "on-device" | "not-run"; check: "cloud" | "not-run"; speak: "on-device" | "not-run" };
  inferenceSource: { extract: string | null; check: string | null };
  leakGuard: { result: "passed" | "blocked" | "not-run"; findings: FindingKind[] };
  sent: { medicines: string[]; cabinet: string[] };
  verdict: string | null;
  model: string | null;
  grounded: string[];
  demo: { injectedPii: boolean; simulate: string[] };
  appVersion: string;
}

export function buildAuditEntry(input: AuditInput, at: FieldValue | Date): AuditEntry {
  const sent = input.leakGuard.result === "passed" && input.answer ? input.leakGuard.sent : { medicines: [], cabinet: [] };
  return {
    schemaVersion: AUDIT_SCHEMA_VERSION,
    at,
    outcome: input.outcome,
    route: {
      transcribe: ROUTING_POLICY.transcribe.where,
      extract: input.extractSource ? ROUTING_POLICY.extract.where : "not-run",
      check: input.answer ? ROUTING_POLICY.check.where : "not-run",
      speak: input.spoken ? ROUTING_POLICY.speak.where : "not-run",
    },
    inferenceSource: { extract: input.extractSource ?? null, check: input.answer?.inferenceSource ?? null },
    leakGuard: {
      result: input.leakGuard.result,
      findings: input.leakGuard.result === "blocked" ? [...new Set(input.leakGuard.kinds)] : [],
    },
    sent: { medicines: [...sent.medicines], cabinet: [...sent.cabinet] },
    verdict: input.answer?.verdict ?? null,
    model: input.answer?.model ?? null,
    grounded: input.answer ? input.answer.grounded.filter((g) => sent.medicines.includes(g) || sent.cabinet.includes(g)) : [],
    demo: { injectedPii: input.demo.injectedPii, simulate: [...input.demo.simulate] },
    appVersion: APP_VERSION,
  };
}

export class UnsafeAuditEntryError extends Error {
  constructor(detail: string) {
    super(`Refusing to write audit entry: ${detail}`);
    this.name = "UnsafeAuditEntryError";
  }
}

/** Every string in the entry must come from a closed vocabulary. */
export function assertAuditSafe(e: AuditEntry): void {
  const fail = (d: string) => {
    throw new UnsafeAuditEntryError(d);
  };
  if (!OUTCOMES.includes(e.outcome)) fail("outcome");
  if (e.verdict !== null && !(VERDICTS as readonly string[]).includes(e.verdict)) fail("verdict");
  if (e.model !== null && !/^gemini-[a-z0-9.\-]{1,40}$/.test(e.model)) fail("model");
  for (const s of [e.inferenceSource.extract, e.inferenceSource.check]) {
    if (s !== null && s !== "on_device" && s !== "in_cloud") fail("inferenceSource");
  }
  for (const k of e.leakGuard.findings) if (!FINDING_KINDS.includes(k)) fail("finding kind");
  for (const n of [...e.sent.medicines, ...e.sent.cabinet, ...e.grounded]) {
    if (!isCanonicalIngredient(n)) fail("non-canonical medicine name");
  }
  if (e.sent.medicines.length > 5 || e.sent.cabinet.length > 20) fail("too many names");
  for (const f of e.demo.simulate) if (!(SIMULATE_FLAGS as readonly string[]).includes(f)) fail("simulate flag");
}

/** Builds, checks and writes the entry. Never throws to the caller: auditing must not block an answer. */
export async function writeAudit(input: AuditInput): Promise<string | undefined> {
  try {
    const { db, fs } = await loadFirestore();
    const entry = buildAuditEntry(input, fs.serverTimestamp());
    assertAuditSafe(entry);
    const uid = getAuth(getApp()).currentUser?.uid;
    if (!uid) throw new Error("not signed in");
    const ref = await fs.addDoc(fs.collection(db, "users", uid, "audit"), entry);
    return ref.id;
  } catch (e) {
    // Log only the error type: never the entry contents.
    console.warn("PillCheck audit write skipped:", e instanceof Error ? e.name : "error");
    return undefined;
  }
}

/** Demo flags currently active (from ?simulate=), for the audit entry. */
export function activeSimulateFlags(search: string = globalThis.location?.search ?? ""): string[] {
  const flags = new URLSearchParams(search)
    .getAll("simulate")
    .flatMap((v) => v.split(","))
    .map((v) => v.trim());
  return SIMULATE_FLAGS.filter((f) => flags.includes(f));
}
