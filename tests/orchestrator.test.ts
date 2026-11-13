import { describe, expect, it, vi } from "vitest";
import { OnDeviceUnavailableError, RoutingViolationError } from "../src/guards/onDeviceGuard";
import type { OutboundRequest } from "../src/guards/leakGuard";
import { REFUSAL_SPOKEN } from "../src/pipeline/messages";
import { runCheck, type PipelineDeps, type PipelineEvent } from "../src/pipeline/orchestrator";
import { ListenError, type ListenHandle } from "../src/pipeline/step1-transcribe";
import { CheckUnavailableError, type InteractionAnswer } from "../src/pipeline/step3-check";
import { assertAuditSafe, buildAuditEntry, type AuditInput } from "../src/pipeline/step5-audit";

const TRANSCRIPT = "This is Meera, born March 3rd. Can I take Advil?";

function listenWith(result: string | Error): PipelineDeps["listen"] {
  return () =>
    ({
      result: result instanceof Error ? Promise.reject(result) : Promise.resolve({ text: result, where: "on-device" }),
      stop: vi.fn(),
      cancel: vi.fn(),
    }) as ListenHandle;
}

function answerFor(req: OutboundRequest): InteractionAnswer {
  return {
    verdict: "avoid",
    spoken: "Please don't take Advil with your warfarin.",
    interactions: [],
    sent: { medicines: ["ibuprofen"], cabinet: (req.cabinet ?? []).length ? ["warfarin"] : [] },
    matches: [{ heard: "advil", ingredients: ["ibuprofen"], via: "alias" }],
    grounded: ["ibuprofen"],
    ungrounded: [],
    labelSetIds: [],
    where: "cloud",
    inferenceSource: "in_cloud",
    model: "gemini-3.5-flash-lite",
  };
}

function deps(over: Partial<PipelineDeps> = {}) {
  const audit = vi.fn(async (_i: AuditInput) => undefined);
  const speak = vi.fn(async (_t: string) => true);
  const check = vi.fn(async (req: OutboundRequest) => answerFor(req));
  const extract = vi.fn(async (_t: string) => ({ medicines: ["advil"], where: "on-device" as const, inferenceSource: "on_device" as const }));
  const d: PipelineDeps = { listen: listenWith(TRANSCRIPT), extract, check, speak, audit, search: "", ...over };
  return { d, audit, speak, check, extract };
}

async function run(d: PipelineDeps) {
  const events: PipelineEvent[] = [];
  const outcome = await runCheck(d, (e) => events.push(e)).done;
  await Promise.resolve(); // let the fire-and-forget audit call land
  return { outcome, events, types: events.map((e) => e.type) };
}

describe("orchestrator: the happy path", () => {
  it("runs all five steps in order and audits only what was sent", async () => {
    const { d, audit, speak, check, extract } = deps({ cabinet: () => ["coumadin"] });
    const { outcome, types } = await run(d);

    expect(outcome).toBe("answered");
    expect(types).toEqual(["listening", "understanding", "guarded", "answered"]);
    expect(extract).toHaveBeenCalledWith(TRANSCRIPT); // the transcript only goes to on-device Step 2
    expect(check).toHaveBeenCalledWith({ medicines: ["advil"], cabinet: ["coumadin"] });
    expect(speak).toHaveBeenCalledWith("Please don't take Advil with your warfarin.");

    const input = audit.mock.calls[0]![0];
    expect(input.outcome).toBe("answered");
    const entry = buildAuditEntry(input, new Date(0));
    expect(entry.sent).toEqual({ medicines: ["ibuprofen"], cabinet: ["warfarin"] });
    expect(() => assertAuditSafe(entry)).not.toThrow();
    // Nothing Meera said reaches the audit log: not her name, not her birthday, not "Advil".
    expect(JSON.stringify(entry)).not.toMatch(/meera|march|advil/i);
  });
});

describe("orchestrator: the leak-guard demo", () => {
  it("?simulate=inject-pii blocks before Step 3, says so, and audits finding types only", async () => {
    const { d, audit, speak, check } = deps({ search: "?simulate=inject-pii" });
    const { outcome, events } = await run(d);

    expect(outcome).toBe("blocked");
    expect(check).not.toHaveBeenCalled();
    const guarded = events.find((e) => e.type === "guarded");
    expect(guarded).toMatchObject({ injected: true, checking: false });
    expect(speak.mock.calls[0]![0]).toMatch(/Nothing left this device/);

    const entry = buildAuditEntry(audit.mock.calls[0]![0], new Date(0));
    expect(entry.leakGuard).toEqual({ result: "blocked", findings: ["possible-name", "date"] });
    expect(entry.sent).toEqual({ medicines: [], cabinet: [] });
    expect(entry.demo).toEqual({ injectedPii: true, simulate: ["inject-pii"] });
    expect(JSON.stringify(entry)).not.toMatch(/meera|sharma|1951/i);
  });
});

describe("orchestrator: refusals and failures", () => {
  it("on-device capability missing → refuse out loud, audit 'refused', never call the cloud", async () => {
    const { d, audit, speak, check } = deps({
      extract: vi.fn(async () => {
        throw new OnDeviceUnavailableError("nano", "api-missing");
      }),
    });
    const { outcome, events } = await run(d);
    expect(outcome).toBe("refused");
    expect(events.at(-1)).toEqual({ type: "refused", routingViolation: false });
    expect(speak).toHaveBeenCalledWith(REFUSAL_SPOKEN);
    expect(check).not.toHaveBeenCalled();
    expect(audit.mock.calls[0]![0]).toMatchObject({ outcome: "refused" });
  });

  it("a routing violation is flagged as such", async () => {
    const { d } = deps({
      extract: vi.fn(async () => {
        throw new RoutingViolationError("in_cloud");
      }),
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { events } = await run(d);
    expect(events.at(-1)).toEqual({ type: "refused", routingViolation: true });
    expect(String(spy.mock.calls[0])).not.toMatch(/meera/i);
    spy.mockRestore();
  });

  it("no medicine heard → says so, no cloud call", async () => {
    const { d, check, audit } = deps({
      extract: vi.fn(async () => ({ medicines: [], where: "on-device" as const, inferenceSource: "on_device" as const })),
    });
    const { outcome } = await run(d);
    expect(outcome).toBe("no-medicine");
    expect(check).not.toHaveBeenCalled();
    expect(audit.mock.calls[0]![0]).toMatchObject({ outcome: "no-medicine" });
  });

  it("cloud unreachable → 'check-unavailable', spoken suggestion, audited", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { d, speak, audit } = deps({
      check: vi.fn(async () => {
        throw new CheckUnavailableError(new Error("offline"));
      }),
    });
    const { outcome, events } = await run(d);
    expect(outcome).toBe("check-unavailable");
    expect(events.at(-1)).toEqual({ type: "error", kind: "check-unavailable" });
    expect(speak.mock.calls[0]![0]).toMatch(/pharmacist/);
    expect(audit).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("silence or cancel → nothing audited", async () => {
    const silent = deps({ listen: listenWith(new ListenError("no-speech")) });
    expect((await run(silent.d)).outcome).toBeUndefined();
    expect(silent.audit).not.toHaveBeenCalled();

    const cancelled = deps({ listen: listenWith(new ListenError("aborted")) });
    const r = await run(cancelled.d);
    expect(r.types.at(-1)).toBe("idle");
    expect(cancelled.speak).not.toHaveBeenCalled();
    expect(cancelled.audit).not.toHaveBeenCalled();
  });
});
