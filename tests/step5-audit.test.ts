import { describe, expect, it } from "vitest";
import {
  activeSimulateFlags,
  assertAuditSafe,
  buildAuditEntry,
  UnsafeAuditEntryError,
  type AuditInput,
} from "../src/pipeline/step5-audit";

const AT = new Date("2026-11-20T10:00:00Z");

const ANSWERED: AuditInput = {
  outcome: "answered",
  extractSource: "on_device",
  leakGuard: { result: "passed", sent: { medicines: ["ibuprofen"], cabinet: ["warfarin"] } },
  answer: { verdict: "avoid", model: "gemini-3.5-flash-lite", inferenceSource: "in_cloud", grounded: ["ibuprofen", "warfarin"] },
  spoken: true,
  demo: { injectedPii: false, simulate: [] },
};

describe("buildAuditEntry", () => {
  it("records where every step ran and exactly what was sent", () => {
    const e = buildAuditEntry(ANSWERED, AT);
    expect(e).toEqual({
      schemaVersion: 1,
      at: AT,
      outcome: "answered",
      route: { transcribe: "on-device", extract: "on-device", check: "cloud", speak: "on-device" },
      inferenceSource: { extract: "on_device", check: "in_cloud" },
      leakGuard: { result: "passed", findings: [] },
      sent: { medicines: ["ibuprofen"], cabinet: ["warfarin"] },
      verdict: "avoid",
      model: "gemini-3.5-flash-lite",
      grounded: ["ibuprofen", "warfarin"],
      demo: { injectedPii: false, simulate: [] },
      appVersion: "0.1.0",
    });
    expect(() => assertAuditSafe(e)).not.toThrow();
  });

  it("a blocked check records finding TYPES, sends nothing, and the cloud step didn't run", () => {
    const e = buildAuditEntry(
      {
        outcome: "blocked",
        extractSource: "on_device",
        leakGuard: { result: "blocked", kinds: ["possible-name", "date", "possible-name"] },
        spoken: true,
        demo: { injectedPii: true, simulate: ["inject-pii"] },
      },
      AT,
    );
    expect(e.leakGuard).toEqual({ result: "blocked", findings: ["possible-name", "date"] });
    expect(e.sent).toEqual({ medicines: [], cabinet: [] });
    expect(e.route.check).toBe("not-run");
    expect(JSON.stringify(e)).not.toMatch(/meera|sharma|1951/i);
    expect(() => assertAuditSafe(e)).not.toThrow();
  });

  it("a refusal before Step 2 records extract as not-run", () => {
    const e = buildAuditEntry(
      { outcome: "refused", leakGuard: { result: "not-run" }, spoken: true, demo: { injectedPii: false, simulate: ["no-nano"] } },
      AT,
    );
    expect(e.route).toEqual({ transcribe: "on-device", extract: "not-run", check: "not-run", speak: "on-device" });
    expect(e.inferenceSource).toEqual({ extract: null, check: null });
  });
});

describe("assertAuditSafe: closed vocabulary only", () => {
  const base = () => buildAuditEntry(ANSWERED, AT);
  type Entry = ReturnType<typeof base>;

  it.each<[string, (e: Entry) => void]>([
    ["a brand name Meera said", (e) => (e.sent.medicines = ["advil"])],
    ["a person's name", (e) => (e.sent.cabinet = ["meera sharma"])],
    ["an unknown model", (e) => (e.model = "gpt-whatever")],
    ["a made-up verdict", (e) => (e.verdict = "probably fine")],
    ["an unexpected inference source", (e) => (e.inferenceSource.extract = "somewhere")],
    ["an unknown demo flag", (e) => (e.demo.simulate = ["force-cloud"])],
  ])("rejects %s", (_label, mutate) => {
    const e = base();
    mutate(e);
    expect(() => assertAuditSafe(e)).toThrow(UnsafeAuditEntryError);
  });
});

describe("activeSimulateFlags", () => {
  it("keeps only known flags", () => {
    expect(activeSimulateFlags("?simulate=inject-pii,force-cloud&simulate=no-nano")).toEqual(["no-nano", "inject-pii"]);
    expect(activeSimulateFlags("")).toEqual([]);
  });
});
