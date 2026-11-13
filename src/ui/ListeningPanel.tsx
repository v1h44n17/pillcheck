import type { LeakGuardResult } from "../guards/leakGuard";
import { CHECK_ERROR_MESSAGE, type CheckErrorKind } from "../pipeline/messages";
import { ROUTING_POLICY } from "../pipeline/policy";
import type { InteractionAnswer } from "../pipeline/step3-check";
import { AnswerCard } from "./AnswerCard";
import { GuardResult } from "./GuardResult";

export type CheckState =
  | { phase: "idle" }
  | { phase: "listening"; interim: string }
  | { phase: "understanding"; text: string }
  /** Guard result shown; if it passed, Step 3 is running ("checking"). */
  | { phase: "understood"; text: string; guard: LeakGuardResult; injected: boolean; checking: boolean }
  | { phase: "answered"; text: string; answer: InteractionAnswer }
  | { phase: "error"; kind: CheckErrorKind };

function DeviceChip({ label }: { label: string }) {
  return (
    <span className="chip chip-device">
      <span aria-hidden="true">🔒</span> {label}
    </span>
  );
}

/** What Meera sees while PillCheck listens, thinks, and answers. */
export function ListeningPanel({ state }: { state: CheckState }) {
  if (state.phase === "idle") return null;

  if (state.phase === "listening") {
    return (
      <section className="listen" aria-live="polite">
        <p className="listen-status">
          <span className="listen-dot" aria-hidden="true" />
          Listening… say the name of your medicine.
        </p>
        {state.interim && <p className="listen-words">“{state.interim}”</p>}
      </section>
    );
  }

  if (state.phase === "understanding" || state.phase === "understood") {
    return (
      <section className="listen" aria-live="polite">
        <p className="listen-label">You asked:</p>
        <p className="listen-words">“{state.text}”</p>

        {state.phase === "understanding" ? (
          <p className="listen-status">
            <span className="listen-dot listen-dot-think" aria-hidden="true" />
            Understanding on this device…
          </p>
        ) : (
          <GuardResult guard={state.guard} injected={state.injected} />
        )}

        <p className="chips">
          <DeviceChip label={ROUTING_POLICY.transcribe.label} />
          {state.phase === "understood" && <DeviceChip label={ROUTING_POLICY.extract.label} />}
        </p>
        {state.phase === "understood" && state.checking && (
          <p className="listen-status">
            <span className="listen-dot listen-dot-think" aria-hidden="true" />
            Checking in the cloud…
          </p>
        )}
      </section>
    );
  }

  if (state.phase === "answered") {
    return (
      <>
        <section className="listen" aria-label="Your question">
          <p className="listen-label">You asked:</p>
          <p className="listen-words">“{state.text}”</p>
        </section>
        <AnswerCard answer={state.answer} />
      </>
    );
  }

  return (
    <section className="listen listen-error" role="alert">
      <p>{CHECK_ERROR_MESSAGE[state.kind]}</p>
    </section>
  );
}
