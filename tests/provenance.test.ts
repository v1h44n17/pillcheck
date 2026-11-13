import { describe, expect, it } from "vitest";
import { scanOutbound } from "../src/guards/leakGuard";
import type { InteractionAnswer } from "../src/pipeline/step3-check";
import { provenanceFor } from "../src/ui/provenance";

const statuses = (s: ReturnType<typeof provenanceFor>) => Object.fromEntries((s ?? []).map((x) => [x.id, x.status]));
const where = (s: ReturnType<typeof provenanceFor>) => Object.fromEntries((s ?? []).map((x) => [x.id, x.where]));

describe("provenance strip", () => {
  it("is hidden when idle", () => {
    expect(provenanceFor({ phase: "idle" }, "none")).toBeNull();
  });

  it("always shows where each step runs: only the check and the log use the cloud", () => {
    expect(where(provenanceFor({ phase: "listening", interim: "" }, "none"))).toEqual({
      transcribe: "on-device",
      extract: "on-device",
      guard: "on-device",
      check: "cloud",
      speak: "on-device",
      audit: "cloud",
    });
  });

  it("follows a check from listening to logged", () => {
    expect(statuses(provenanceFor({ phase: "listening", interim: "" }, "none"))).toMatchObject({
      transcribe: "active",
      extract: "waiting",
    });
    expect(statuses(provenanceFor({ phase: "understanding", text: "x" }, "none"))).toMatchObject({
      transcribe: "done",
      extract: "active",
    });
    const guard = scanOutbound({ medicines: ["advil"] });
    expect(statuses(provenanceFor({ phase: "understood", text: "x", guard, injected: false, checking: true }, "none"))).toMatchObject({
      guard: "done",
      check: "active",
    });
    const answered = { phase: "answered" as const, text: "x", answer: {} as InteractionAnswer };
    expect(statuses(provenanceFor(answered, "pending"))).toMatchObject({ check: "done", speak: "done", audit: "active" });
    expect(statuses(provenanceFor(answered, "ok"))).toMatchObject({ audit: "done" });
    expect(statuses(provenanceFor(answered, "failed"))).toMatchObject({ audit: "failed" });
  });

  it("the leak-guard demo: privacy check blocked, cloud step shows 'Nothing sent'", () => {
    const guard = scanOutbound({ medicines: ["advil", "Meera Sharma"] });
    const s = provenanceFor({ phase: "understood", text: "x", guard, injected: true, checking: false }, "ok")!;
    expect(statuses(s)).toMatchObject({ guard: "blocked", check: "skipped", audit: "done" });
    expect(s.find((x) => x.id === "check")?.note).toBe("Nothing sent");
  });

  it("errors point at the step that failed", () => {
    expect(statuses(provenanceFor({ phase: "error", kind: "no-speech" }, "none"))).toMatchObject({
      transcribe: "failed",
      audit: "skipped",
    });
    expect(statuses(provenanceFor({ phase: "error", kind: "check-unavailable" }, "pending"))).toMatchObject({
      guard: "done",
      check: "failed",
    });
  });
});
