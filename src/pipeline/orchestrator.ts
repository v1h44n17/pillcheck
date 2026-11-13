import { OnDeviceUnavailableError, RoutingViolationError } from "../guards/onDeviceGuard";
import { LeakBlockedError, scanOutbound, type LeakGuardResult, type OutboundRequest } from "../guards/leakGuard";
import { withDemoInjection } from "./demoInjection";
import { blockedSpokenMessage, CHECK_ERROR_MESSAGE, REFUSAL_SPOKEN, type CheckErrorKind } from "./messages";
import { ListenError, listenOnce, type ListenHandle, type ListenOptions } from "./step1-transcribe";
import { ExtractionError, extractMedicines, type Extraction } from "./step2-extract";
import { CheckAnswerError, checkInteractions, CheckUnavailableError, type InteractionAnswer } from "./step3-check";
import { speakLocally } from "./step4-speak";
import { activeSimulateFlags, writeAudit, type AuditInput, type Outcome } from "./step5-audit";

/**
 * THE PIPELINE: one press of "Check my medicine", Steps 1 → 5.
 *
 *   1. listen     ON-DEVICE  Chrome speech recognition (processLocally)
 *   2. extract    ON-DEVICE  Gemini Nano, Firebase AI Logic ONLY_ON_DEVICE
 *      leak guard ON-DEVICE  only canonical ingredient names may continue
 *   3. check      CLOUD      Gemini, Firebase AI Logic ONLY_IN_CLOUD (+ FDA labels)
 *   4. speak      ON-DEVICE  local voices only
 *   5. audit      CLOUD      Firestore: where each step ran, what left the device
 *
 * Failure policy (see policy.ts):
 *   - on-device step impossible        → REFUSE out loud; never move it to the cloud
 *   - leak guard finding               → BLOCK out loud; nothing is sent
 *   - cloud step unreachable / unusable → say so, suggest the pharmacist; never ask Nano
 *
 * Every step is injected (PipelineDeps), so tests/orchestrator.test.ts runs the
 * whole flow with fakes and checks what reaches the cloud and the audit log.
 */

export interface PipelineDeps {
  listen: (opts: ListenOptions) => ListenHandle;
  extract: (transcript: string) => Promise<Extraction>;
  check: (request: OutboundRequest) => Promise<InteractionAnswer>;
  speak: (text: string) => Promise<boolean>;
  audit: (input: AuditInput) => Promise<unknown>;
  /** Medicines Meera already takes (Day 8). */
  cabinet?: () => string[];
  /** URL query, for ?simulate= demo flags. */
  search?: string;
}

export const defaultDeps: PipelineDeps = {
  listen: listenOnce,
  extract: (t) => extractMedicines(t),
  check: (r) => checkInteractions(r),
  speak: speakLocally,
  audit: writeAudit,
};

export type PipelineEvent =
  | { type: "listening"; interim: string }
  | { type: "understanding"; text: string }
  | { type: "guarded"; text: string; guard: LeakGuardResult; injected: boolean; checking: boolean }
  | { type: "answered"; text: string; answer: InteractionAnswer }
  | { type: "error"; kind: CheckErrorKind }
  | { type: "refused"; routingViolation: boolean }
  | { type: "idle" };

export interface RunHandle {
  /** "I'm done talking": stop listening, keep what was heard. */
  stop(): void;
  /** Abandon the run. */
  cancel(): void;
  /** Resolves with the audited outcome, or undefined if nothing was audited (e.g. silence). */
  done: Promise<Outcome | undefined>;
}

function errorKindFor(e: unknown): { outcome?: Outcome; kind: CheckErrorKind } {
  if (e instanceof ListenError) return { kind: e.kind };
  if (e instanceof ExtractionError) return { outcome: "not-understood", kind: "not-understood" };
  if (e instanceof CheckUnavailableError) return { outcome: "check-unavailable", kind: "check-unavailable" };
  if (e instanceof CheckAnswerError) return { outcome: "check-failed", kind: "check-failed" };
  return { kind: "failed" };
}

export function runCheck(deps: PipelineDeps, onEvent: (e: PipelineEvent) => void): RunHandle {
  const demo = { injectedPii: false, simulate: activeSimulateFlags(deps.search) };
  let extractSource: string | undefined;
  let leakGuard: AuditInput["leakGuard"] = { result: "not-run" };
  let answerInfo: AuditInput["answer"];
  let spoken = false;
  const say = async (text: string) => {
    if (text) spoken = (await deps.speak(text)) || spoken;
  };

  onEvent({ type: "listening", interim: "" });
  const listening = deps.listen({ onInterim: (interim) => onEvent({ type: "listening", interim }) });

  const done = (async (): Promise<Outcome | undefined> => {
    let outcome: Outcome | undefined;
    try {
      // ── Step 1: on-device listening ──────────────────────────────────────
      const heard = await listening.result;

      // ── Step 2: on-device understanding (Gemini Nano) ────────────────────
      onEvent({ type: "understanding", text: heard.text });
      const extracted = await deps.extract(heard.text);
      extractSource = extracted.inferenceSource;
      if (extracted.medicines.length === 0) {
        outcome = "no-medicine";
        onEvent({ type: "error", kind: "no-medicine" });
        await say(CHECK_ERROR_MESSAGE["no-medicine"]);
        return outcome;
      }

      // ── Leak guard: decides what may leave the device ────────────────────
      // ?simulate=inject-pii adds a fictional name + birthday here (demo).
      const { medicines, injected } = withDemoInjection(extracted.medicines, deps.search);
      demo.injectedPii = injected;
      const request: OutboundRequest = { medicines, cabinet: deps.cabinet?.() ?? [] };
      const guard = scanOutbound(request);
      onEvent({ type: "guarded", text: heard.text, guard, injected, checking: guard.ok });
      if (!guard.ok) {
        outcome = "blocked";
        leakGuard = { result: "blocked", kinds: guard.findings.map((f) => f.kind) };
        await say(blockedSpokenMessage(guard.findings));
        return outcome;
      }

      // ── Step 3: cloud check (re-runs the leak guard right before sending) ─
      const answer = await deps.check(request);
      leakGuard = { result: "passed", sent: answer.sent };
      answerInfo = {
        verdict: answer.verdict,
        model: answer.model,
        inferenceSource: answer.inferenceSource,
        grounded: answer.grounded,
      };
      outcome = "answered";
      onEvent({ type: "answered", text: heard.text, answer });

      // ── Step 4: speak it on-device ───────────────────────────────────────
      await say(answer.spoken);
      return outcome;
    } catch (e) {
      if (e instanceof OnDeviceUnavailableError || e instanceof RoutingViolationError) {
        // Never log the transcript, only what went wrong.
        if (e instanceof RoutingViolationError) console.error("PillCheck routing violation:", e.message);
        outcome = "refused";
        onEvent({ type: "refused", routingViolation: e instanceof RoutingViolationError });
        await say(REFUSAL_SPOKEN);
        return outcome;
      }
      if (e instanceof LeakBlockedError) {
        outcome = "blocked";
        leakGuard = { result: "blocked", kinds: e.kinds };
        await say(blockedSpokenMessage(e.findings));
        return outcome;
      }
      const { outcome: o, kind } = errorKindFor(e);
      if (kind === "aborted") {
        onEvent({ type: "idle" });
        return undefined;
      }
      if (o) console.error("PillCheck:", e instanceof Error ? e.name : "error");
      outcome = o;
      onEvent({ type: "error", kind });
      await say(CHECK_ERROR_MESSAGE[kind]);
      return outcome;
    } finally {
      // ── Step 5: audit (fire-and-forget; never blocks the answer) ─────────
      if (outcome) {
        void deps.audit({ outcome, extractSource, leakGuard, answer: answerInfo, spoken, demo });
      }
    }
  })();

  return { stop: () => listening.stop(), cancel: () => listening.cancel(), done };
}
