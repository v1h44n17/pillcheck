import { getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { loadFirestore } from "../firebase/firestore";
import { OUTCOMES, type Outcome } from "../pipeline/step5-audit";

/**
 * PRIVACY RECEIPT: Meera's own audit log, read back in plain language.
 *
 * Turns "we only send medicine names" from a claim into something a family
 * member can check: every past check, where each step ran, and exactly which
 * names left the device. Reads users/{uid}/audit (firestore.rules: owner only).
 */

export interface ReceiptEntry {
  id: string;
  at: Date | null;
  outcome: Outcome;
  verdict: string | null;
  sentMedicines: string[];
  sentCabinet: string[];
  guard: "passed" | "blocked" | "not-run";
  findings: string[];
  extractOnDevice: boolean;
  checkedInCloud: boolean;
  demo: boolean;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Defensive parse of one audit document (returns undefined if it doesn't look like ours). */
export function parseAuditEntry(id: string, d: Record<string, unknown>): ReceiptEntry | undefined {
  const outcome = d.outcome as Outcome;
  if (!OUTCOMES.includes(outcome)) return undefined;
  const route = (d.route ?? {}) as Record<string, unknown>;
  const sent = (d.sent ?? {}) as Record<string, unknown>;
  const guard = (d.leakGuard ?? {}) as Record<string, unknown>;
  const demo = (d.demo ?? {}) as Record<string, unknown>;
  // Firestore Timestamp (duck-typed, so this file needn't load Firestore up front) or Date.
  const raw = d.at as { toDate?: () => unknown } | Date | undefined;
  const fromTs = raw && !(raw instanceof Date) && typeof raw.toDate === "function" ? raw.toDate() : undefined;
  const at = fromTs instanceof Date ? fromTs : raw instanceof Date ? raw : null;
  const result = guard.result === "passed" || guard.result === "blocked" ? guard.result : "not-run";
  return {
    id,
    at,
    outcome,
    verdict: typeof d.verdict === "string" ? d.verdict : null,
    sentMedicines: strings(sent.medicines),
    sentCabinet: strings(sent.cabinet),
    guard: result,
    findings: strings(guard.findings),
    extractOnDevice: route.extract === "on-device",
    checkedInCloud: route.check === "cloud",
    demo: demo.injectedPii === true || strings(demo.simulate).length > 0,
  };
}

export interface ReceiptSummary {
  checks: number;
  answered: number;
  blocked: number;
  refused: number;
  /** Every distinct name that ever left the device. */
  namesEverSent: string[];
}

export function summarizeReceipt(entries: ReceiptEntry[]): ReceiptSummary {
  const names = new Set<string>();
  for (const e of entries) [...e.sentMedicines, ...e.sentCabinet].forEach((n) => names.add(n));
  return {
    checks: entries.length,
    answered: entries.filter((e) => e.outcome === "answered").length,
    blocked: entries.filter((e) => e.outcome === "blocked").length,
    refused: entries.filter((e) => e.outcome === "refused").length,
    namesEverSent: [...names].sort(),
  };
}

/** Plain-language line for one entry. */
export function describeEntry(e: ReceiptEntry): string {
  switch (e.outcome) {
    case "answered": {
      const others = e.sentCabinet.length ? ` with ${e.sentCabinet.join(", ")}` : "";
      return `Checked ${e.sentMedicines.join(", ")}${others}.`;
    }
    case "blocked":
      return "Stopped by the privacy check. Nothing was sent.";
    case "refused":
      return "Refused: this computer couldn't do the private steps. Nothing was sent.";
    case "no-medicine":
      return "No medicine was named. Nothing was sent.";
    case "not-understood":
      return "Couldn't understand the question. Nothing was sent.";
    case "check-unavailable":
      return "Couldn't reach the online check.";
    case "check-failed":
      return "The online check didn't give a clear answer.";
  }
}

export async function fetchMyReceipt(max = 20): Promise<ReceiptEntry[]> {
  const uid = getAuth(getApp()).currentUser?.uid;
  if (!uid) throw new Error("not signed in");
  const { db, fs } = await loadFirestore();
  const snap = await fs.getDocs(fs.query(fs.collection(db, "users", uid, "audit"), fs.orderBy("at", "desc"), fs.limit(max)));
  return snap.docs.flatMap((doc) => {
    const e = parseAuditEntry(doc.id, doc.data());
    return e ? [e] : [];
  });
}
