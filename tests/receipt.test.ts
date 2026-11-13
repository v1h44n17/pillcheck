import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase/firestore";
import { buildAuditEntry, type AuditInput } from "../src/pipeline/step5-audit";
import { describeEntry, parseAuditEntry, summarizeReceipt } from "../src/receipt/receipt";

const AT = new Date("2026-11-20T15:42:00Z");

function doc(input: AuditInput) {
  // What Firestore hands back: the stored entry with a Timestamp for `at`.
  return { ...buildAuditEntry(input, AT), at: Timestamp.fromDate(AT) } as unknown as Record<string, unknown>;
}

const ANSWERED: AuditInput = {
  outcome: "answered",
  extractSource: "on_device",
  leakGuard: { result: "passed", sent: { medicines: ["ibuprofen"], cabinet: ["warfarin"] } },
  answer: { verdict: "avoid", model: "gemini-3.5-flash-lite", inferenceSource: "in_cloud", grounded: ["ibuprofen"] },
  spoken: true,
  demo: { injectedPii: false, simulate: [] },
};

const BLOCKED: AuditInput = {
  outcome: "blocked",
  extractSource: "on_device",
  leakGuard: { result: "blocked", kinds: ["possible-name", "date"] },
  spoken: true,
  demo: { injectedPii: true, simulate: ["inject-pii"] },
};

const REFUSED: AuditInput = {
  outcome: "refused",
  leakGuard: { result: "not-run" },
  spoken: true,
  demo: { injectedPii: false, simulate: ["no-nano"] },
};

describe("parseAuditEntry", () => {
  it("reads a real audit entry", () => {
    expect(parseAuditEntry("a1", doc(ANSWERED))).toEqual({
      id: "a1",
      at: AT,
      outcome: "answered",
      verdict: "avoid",
      sentMedicines: ["ibuprofen"],
      sentCabinet: ["warfarin"],
      guard: "passed",
      findings: [],
      extractOnDevice: true,
      checkedInCloud: true,
      demo: false,
    });
  });

  it("marks demo entries and blocked findings", () => {
    expect(parseAuditEntry("b1", doc(BLOCKED))).toMatchObject({
      guard: "blocked",
      findings: ["possible-name", "date"],
      sentMedicines: [],
      checkedInCloud: false,
      demo: true,
    });
  });

  it("ignores documents that aren't PillCheck audit entries", () => {
    expect(parseAuditEntry("x", { hello: "world" })).toBeUndefined();
    expect(parseAuditEntry("x", { outcome: "pwned" })).toBeUndefined();
  });
});

describe("summary and plain-language lines", () => {
  const entries = [
    parseAuditEntry("a", doc(ANSWERED))!,
    parseAuditEntry("b", doc(BLOCKED))!,
    parseAuditEntry("c", doc(REFUSED))!,
    parseAuditEntry("d", doc({ ...ANSWERED, leakGuard: { result: "passed", sent: { medicines: ["acetaminophen"], cabinet: [] } } }))!,
  ];

  it("lists every name that ever left the device, and nothing else", () => {
    expect(summarizeReceipt(entries)).toEqual({
      checks: 4,
      answered: 2,
      blocked: 1,
      refused: 1,
      namesEverSent: ["acetaminophen", "ibuprofen", "warfarin"],
    });
  });

  it("describes each check in plain words", () => {
    expect(entries.map(describeEntry)).toEqual([
      "Checked ibuprofen with warfarin.",
      "Stopped by the privacy check. Nothing was sent.",
      "Refused: this computer couldn't do the private steps. Nothing was sent.",
      "Checked acetaminophen.",
    ]);
  });
});
