import { lookupMedicine, type MedicineMatch } from "../data/lexicon";

/**
 * LEAK GUARD: the last check before anything goes to the cloud (Step 3).
 *
 * Step 2 (Gemini Nano) is asked to return only medicine names, but a model can
 * be wrong or be talked into echoing other words. So before ANY cloud call:
 *
 *   1. SHAPE:   the request must be exactly { medicines: string[], cabinet?: string[] }.
 *               Any other field blocks.
 *   2. PII:     every entry is scanned for dates, phone numbers, emails, ID numbers,
 *               digits (doses, ages, times), addresses, titles and personal phrases.
 *   3. ALLOWLIST: every entry must resolve to a known medicine in the openFDA
 *               lexicon. Unknown words (which may be a name) block.
 *   4. REBUILD: the outbound payload is rebuilt ONLY from canonical ingredient
 *               names in the lexicon. Meera's own words are never what's sent.
 *
 * Any finding is a HARD BLOCK: nothing is sent, and the UI shows why. There is
 * no "send the clean part anyway" mode.
 */

export type FindingKind =
  | "unexpected-field"
  | "not-a-list"
  | "not-text"
  | "too-many"
  | "too-long"
  | "email"
  | "phone"
  | "date"
  | "id-number"
  | "digits"
  | "address"
  | "title"
  | "personal-phrase"
  | "possible-name"
  | "unknown-term";

/** Kinds that mean "personal information", as opposed to "I don't know this medicine". */
export const PII_KINDS: ReadonlySet<FindingKind> = new Set([
  "email",
  "phone",
  "date",
  "id-number",
  "digits",
  "address",
  "title",
  "personal-phrase",
  "possible-name",
]);

export interface Finding {
  kind: FindingKind;
  /** The offending text, for the on-screen explanation only. Never logged or sent. */
  value: string;
  field: string;
}

export interface OutboundRequest {
  medicines: string[];
  cabinet?: string[];
}

/** The only shape that may leave the device: canonical ingredient names. */
export interface SanitisedPayload {
  medicines: string[];
  cabinet: string[];
}

export type LeakGuardResult =
  | { ok: true; payload: SanitisedPayload; matches: MedicineMatch[] }
  | { ok: false; findings: Finding[] };

export class LeakBlockedError extends Error {
  constructor(readonly findings: Finding[]) {
    super(`Leak guard blocked the cloud call: ${[...new Set(findings.map((f) => f.kind))].join(", ")}`);
    this.name = "LeakBlockedError";
  }
  /** Finding kinds only, safe for the audit log (no values). */
  get kinds(): FindingKind[] {
    return [...new Set(this.findings.map((f) => f.kind))];
  }
  get hasPii(): boolean {
    return this.findings.some((f) => PII_KINDS.has(f.kind));
  }
}

const LIMITS = { medicines: 5, cabinet: 20, entryLength: 40, payloadChars: 1200 };

const MONTHS =
  "jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?";

/**
 * Structural detectors: run on EVERY entry, before any lexicon lookup.
 * No medicine name in the lexicon contains digits or @, so these never
 * false-positive on a real medicine. Ordered: the first match names the finding.
 */
const STRUCTURAL: Array<[FindingKind, RegExp]> = [
  ["email", /[^\s@]+@[^\s@]+\.[^\s@]+/],
  ["id-number", /\b\d{3}-\d{2}-\d{4}\b|\d{6,}/],
  ["date", new RegExp(`\\b\\d{1,4}[/.-]\\d{1,2}[/.-]\\d{1,4}\\b|\\b(${MONTHS})\\b\\.?\\s*\\d|\\b(19|20)\\d{2}\\b`, "i")],
  ["phone", /\+?\d[\d\s().-]{6,}\d/],
  ["address", /\b\d+\s+\w+.*\b(street|st|avenue|ave|road|rd|lane|ln|drive|dr|boulevard|blvd|court|ct|way|apt|apartment)\b/i],
  ["digits", /\d/],
];

/**
 * Word detectors: run only on entries that are NOT a known medicine. Real
 * names can contain these words ("MS Contin"), and a lexicon match is safe by
 * construction: the lexicon is a closed list of public drug names.
 */
const WORD_BASED: Array<[FindingKind, RegExp]> = [
  ["title", /\b(mr|mrs|ms|miss|dr|doctor|mister|madam|sir)\b\.?/i],
  [
    "personal-phrase",
    /\b(my name|name is|this is|i am|i'm|born|birthday|years old|lives? (at|in)|address|phone|email|patient|daughter|son|husband|wife)\b/i,
  ],
];

function scanEntry(raw: unknown, field: string): { findings: Finding[]; match?: MedicineMatch } {
  if (typeof raw !== "string") return { findings: [{ kind: "not-text", value: String(raw), field }] };
  const value = raw.trim();

  for (const [kind, re] of STRUCTURAL) {
    if (re.test(value)) return { findings: [{ kind, value, field }] };
  }
  if (value.length > LIMITS.entryLength) return { findings: [{ kind: "too-long", value, field }] };

  const match = lookupMedicine(value);
  if (match) return { findings: [], match };

  for (const [kind, re] of WORD_BASED) {
    if (re.test(value)) return { findings: [{ kind, value, field }] };
  }

  // Not a known medicine. Two or three plain words is how names look.
  const words = value.split(/\s+/).filter(Boolean);
  const kind: FindingKind = words.length >= 2 && words.length <= 3 ? "possible-name" : "unknown-term";
  return { findings: [{ kind, value, field }] };
}

function scanList(raw: unknown, field: keyof OutboundRequest, max: number) {
  const findings: Finding[] = [];
  const matches: MedicineMatch[] = [];
  if (raw === undefined && field === "cabinet") return { findings, matches };
  if (!Array.isArray(raw)) return { findings: [{ kind: "not-a-list" as const, value: typeof raw, field }], matches };
  if (raw.length > max) findings.push({ kind: "too-many", value: String(raw.length), field });
  for (const entry of raw) {
    const r = scanEntry(entry, field);
    findings.push(...r.findings);
    if (r.match) matches.push(r.match);
  }
  return { findings, matches };
}

/** Pure check. Use `assertSafeToSend` at the call site. */
export function scanOutbound(request: unknown): LeakGuardResult {
  if (typeof request !== "object" || request === null || Array.isArray(request)) {
    return { ok: false, findings: [{ kind: "unexpected-field", value: typeof request, field: "(root)" }] };
  }

  const findings: Finding[] = [];
  for (const key of Object.keys(request)) {
    if (key !== "medicines" && key !== "cabinet") {
      findings.push({ kind: "unexpected-field", value: key, field: key });
    }
  }

  const r = request as Record<string, unknown>;
  const meds = scanList(r.medicines, "medicines", LIMITS.medicines);
  const cab = scanList(r.cabinet, "cabinet", LIMITS.cabinet);
  findings.push(...meds.findings, ...cab.findings);

  if (findings.length > 0) return { ok: false, findings };

  // REBUILD from canonical names only. Deduplicate; keep medicines out of the cabinet list.
  const medicines = [...new Set(meds.matches.flatMap((m) => m.ingredients))];
  const cabinet = [...new Set(cab.matches.flatMap((m) => m.ingredients))].filter((i) => !medicines.includes(i));
  const payload: SanitisedPayload = { medicines, cabinet };

  if (medicines.length === 0) {
    return { ok: false, findings: [{ kind: "not-a-list", value: "no medicines", field: "medicines" }] };
  }
  if (JSON.stringify(payload).length > LIMITS.payloadChars) {
    return { ok: false, findings: [{ kind: "too-long", value: "payload", field: "(root)" }] };
  }
  return { ok: true, payload, matches: meds.matches };
}

/** Throws LeakBlockedError on any finding. Returns the ONLY payload allowed to leave. */
export function assertSafeToSend(request: unknown): { payload: SanitisedPayload; matches: MedicineMatch[] } {
  const result = scanOutbound(request);
  if (!result.ok) throw new LeakBlockedError(result.findings);
  return { payload: result.payload, matches: result.matches };
}
