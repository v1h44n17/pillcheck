import { describe, expect, it } from "vitest";
import { isCanonicalIngredient, lookupMedicine } from "../src/data/lexicon";
import {
  assertSafeToSend,
  LeakBlockedError,
  scanOutbound,
  type FindingKind,
} from "../src/guards/leakGuard";
import { withDemoInjection } from "../src/pipeline/demoInjection";

function blockedKinds(request: unknown): FindingKind[] {
  const r = scanOutbound(request);
  if (r.ok) throw new Error(`expected a block, got ${JSON.stringify(r.payload)}`);
  return r.findings.map((f) => f.kind);
}

describe("leak guard: clean requests pass, rebuilt from the lexicon", () => {
  it("maps brands to canonical ingredients: Meera's words are not what's sent", () => {
    const r = scanOutbound({ medicines: ["Advil", "warfarin"] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload).toEqual({ medicines: ["ibuprofen", "warfarin"], cabinet: [] });
    expect(r.matches.map((m) => m.heard)).toEqual(["advil", "warfarin"]);
  });

  it("every value in a passing payload is a canonical lexicon ingredient", () => {
    const r = scanOutbound({ medicines: ["Tylenol", "baby aspirin", "Metformin Hydrochloride"], cabinet: ["Lipitor"] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const v of [...r.payload.medicines, ...r.payload.cabinet]) expect(isCanonicalIngredient(v)).toBe(true);
    expect(r.payload.medicines).toEqual(["acetaminophen", "aspirin", "metformin"]);
    expect(r.payload.cabinet).toEqual(["atorvastatin"]);
  });

  it("deduplicates and keeps the medicine out of the cabinet list", () => {
    const r = scanOutbound({ medicines: ["advil", "ibuprofen"], cabinet: ["motrin", "warfarin"] });
    expect(r.ok && r.payload).toEqual({ medicines: ["ibuprofen"], cabinet: ["warfarin"] });
  });

  it("does not mistake a known medicine for a title ('MS Contin' is not 'Ms.')", () => {
    if (lookupMedicine("ms contin")) {
      expect(scanOutbound({ medicines: ["MS Contin"] }).ok).toBe(true);
    }
    // And the same word on an unknown entry still blocks:
    expect(blockedKinds({ medicines: ["ms sharma"] })).toEqual(["title"]);
  });
});

describe("leak guard: THE DEMO. A fake patient name is injected", () => {
  it("blocks the Meera payload and says why", () => {
    const r = scanOutbound({ medicines: ["ibuprofen", "Meera Sharma", "12/03/1951"] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.findings).toEqual([
      { kind: "possible-name", value: "Meera Sharma", field: "medicines" },
      { kind: "date", value: "12/03/1951", field: "medicines" },
    ]);
  });

  it("?simulate=inject-pii adds the fake details after Nano, and the guard blocks them", () => {
    const off = withDemoInjection(["ibuprofen"], "");
    expect(off).toEqual({ medicines: ["ibuprofen"], injected: false });
    expect(scanOutbound({ medicines: off.medicines }).ok).toBe(true);

    const on = withDemoInjection(["ibuprofen"], "?simulate=no-speech,inject-pii");
    expect(on.injected).toBe(true);
    expect(blockedKinds({ medicines: on.medicines })).toEqual(["possible-name", "date"]);
  });

  it("blocks it as a single run-on string too", () => {
    expect(blockedKinds({ medicines: ["ibuprofen for Meera Sharma 12/03/1951"] })).toEqual(["date"]);
  });

  it("assertSafeToSend throws a LeakBlockedError carrying kinds but no values", () => {
    const run = () => assertSafeToSend({ medicines: ["ibuprofen", "Meera Sharma"] });
    expect(run).toThrow(LeakBlockedError);
    try {
      run();
    } catch (e) {
      const err = e as LeakBlockedError;
      expect(err.kinds).toEqual(["possible-name"]);
      expect(err.hasPii).toBe(true);
      expect(err.message).not.toContain("Meera"); // safe to log
    }
  });
});

describe("leak guard: PII detectors", () => {
  it.each<[string, FindingKind]>([
    ["meera@example.com", "email"],
    ["123-45-6789", "id-number"],
    ["4417 1234 5678", "phone"],
    ["555 010 0199", "phone"],
    ["March 3", "date"],
    ["born 1951", "date"],
    ["03/12/51", "date"],
    ["12 Elm Street", "address"],
    ["200mg", "digits"],
    ["2 tablets", "digits"],
    ["Mrs Sharma", "title"],
    ["dr patel", "title"],
    ["my name is meera", "personal-phrase"],
    ["my daughter", "personal-phrase"],
    ["Meera Sharma", "possible-name"],
    ["meera", "unknown-term"],
    ["flibbertigibbet", "unknown-term"],
  ])("%s → %s", (value, kind) => {
    expect(blockedKinds({ medicines: ["aspirin", value] })).toEqual([kind]);
  });

  it("scans the cabinet list too", () => {
    expect(blockedKinds({ medicines: ["aspirin"], cabinet: ["warfarin", "Meera Sharma"] })).toEqual(["possible-name"]);
  });
});

describe("leak guard: shape", () => {
  it("blocks any extra field", () => {
    expect(blockedKinds({ medicines: ["aspirin"], patientName: "Meera" })).toEqual(["unexpected-field"]);
  });
  it("blocks non-objects, non-lists and non-strings", () => {
    expect(blockedKinds("aspirin")).toEqual(["unexpected-field"]);
    expect(blockedKinds(null)).toEqual(["unexpected-field"]);
    expect(blockedKinds({ medicines: "aspirin" })).toEqual(["not-a-list"]);
    expect(blockedKinds({ medicines: ["aspirin", 42] })).toEqual(["not-text"]);
  });
  it("blocks empty and oversized requests", () => {
    expect(blockedKinds({ medicines: [] })).toEqual(["not-a-list"]);
    expect(
      blockedKinds({ medicines: ["aspirin", "ibuprofen", "warfarin", "metformin", "lisinopril", "naproxen"] }),
    ).toEqual(["too-many"]);
    expect(blockedKinds({ medicines: [`aspirin${" a".repeat(30)}`] })).toEqual(["too-long"]);
  });
});
