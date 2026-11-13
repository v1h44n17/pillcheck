import { ROUTING_POLICY, type Where } from "../pipeline/policy";
import type { CheckState } from "./ListeningPanel";

/**
 * Where did each step of THIS check run, and how far did it get?
 * Pure mapping from the screen state to the provenance strip, so the
 * "on this device / in the cloud" story is always visible and testable.
 */

export type StepStatus = "waiting" | "active" | "done" | "skipped" | "blocked" | "failed";
export type LogState = "none" | "pending" | "ok" | "failed";
export type ProvenanceId = "transcribe" | "extract" | "guard" | "check" | "speak" | "audit";

export interface ProvenanceStep {
  id: ProvenanceId;
  label: string;
  where: Where;
  status: StepStatus;
  note?: string;
}

const ORDER: Array<[ProvenanceId, string]> = [
  ["transcribe", "Heard"],
  ["extract", "Understood"],
  ["guard", "Privacy check"],
  ["check", "Checked"],
  ["speak", "Spoken"],
  ["audit", "Logged"],
];

function steps(statuses: Partial<Record<ProvenanceId, StepStatus>>, notes: Partial<Record<ProvenanceId, string>> = {}) {
  return ORDER.map(([id, label]) => ({
    id,
    label,
    where: ROUTING_POLICY[id].where,
    status: statuses[id] ?? "waiting",
    ...(notes[id] ? { note: notes[id] } : {}),
  }));
}

function logStatus(log: LogState): StepStatus {
  return log === "ok" ? "done" : log === "pending" ? "active" : log === "failed" ? "failed" : "waiting";
}

const LISTEN_ERRORS = new Set(["no-speech", "mic-denied", "no-mic", "failed", "aborted"]);

export function provenanceFor(state: CheckState, log: LogState): ProvenanceStep[] | null {
  const audit = logStatus(log);
  switch (state.phase) {
    case "idle":
      return null;
    case "listening":
      return steps({ transcribe: "active" });
    case "understanding":
      return steps({ transcribe: "done", extract: "active" });
    case "understood":
      if (state.guard.ok) {
        return steps({ transcribe: "done", extract: "done", guard: "done", check: state.checking ? "active" : "waiting" });
      }
      return steps(
        { transcribe: "done", extract: "done", guard: "blocked", check: "skipped", speak: "done", audit },
        { guard: "Stopped", check: "Nothing sent" },
      );
    case "answered":
      return steps({ transcribe: "done", extract: "done", guard: "done", check: "done", speak: "done", audit });
    case "error":
      if (LISTEN_ERRORS.has(state.kind)) return steps({ transcribe: "failed", audit: "skipped" });
      if (state.kind === "no-medicine") {
        return steps(
          { transcribe: "done", extract: "done", guard: "skipped", check: "skipped", speak: "done", audit },
          { extract: "No medicine named", check: "Nothing sent" },
        );
      }
      if (state.kind === "not-understood") {
        return steps({ transcribe: "done", extract: "failed", guard: "skipped", check: "skipped", speak: "done", audit });
      }
      // check-unavailable / check-failed
      return steps(
        { transcribe: "done", extract: "done", guard: "done", check: "failed", speak: "done", audit },
        { check: state.kind === "check-unavailable" ? "Couldn't reach" : "No clear answer" },
      );
  }
}
