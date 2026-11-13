import type { LeakGuardResult } from "../guards/leakGuard";
import { ROUTING_POLICY } from "../pipeline/policy";
import type { ListenErrorKind } from "../pipeline/step1-transcribe";
import type { InteractionAnswer } from "../pipeline/step3-check";
import { AnswerCard } from "./AnswerCard";
import { GuardResult } from "./GuardResult";

export type CheckErrorKind = ListenErrorKind | "no-medicine" | "not-understood" | "check-unavailable" | "check-failed";

export type CheckState =
  | { phase: "idle" }
  | { phase: "listening"; interim: string }
  | { phase: "understanding"; text: string }
  /** Guard result shown; if it passed, Step 3 is running ("checking"). */
  | { phase: "understood"; text: string; guard: LeakGuardResult; injected: boolean; checking: boolean }
  | { phase: "answered"; text: string; answer: InteractionAnswer }
  | { phase: "error"; kind: CheckErrorKind };

/** Short, plain, spoken-style messages. Each one tells Meera what to do next. */
export const CHECK_ERROR_MESSAGE: Record<CheckErrorKind, string> = {
  "no-speech": "I didn't hear anything. Press the button and say the name of your medicine.",
  "mic-denied": "I need to use the microphone. Please allow it, then press the button again.",
  "no-mic": "I can't find a microphone. Please check it's plugged in, then press the button again.",
  aborted: "",
  failed: "Something went wrong while listening. Please press the button and try again.",
  "no-medicine": "I didn't catch the name of a medicine. Press the button and say the medicine's name.",
  "not-understood": "Sorry, I didn't understand that. Press the button and try again.",
  "check-unavailable": "I couldn't check right now. Please try again in a minute, or ask your pharmacist.",
  "check-failed": "I couldn't get a clear answer. Please ask your pharmacist before taking it.",
};

function DeviceChip({ label }: { label: string }) {
  return (
    <span className="chip chip-device">
      <span aria-hidden="true">🔒</span> {label}
    </span>
  );
}

/** What Meera sees while PillCheck listens, thinks, and what it understood. */
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
