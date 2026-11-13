import { ROUTING_POLICY } from "../pipeline/policy";
import type { ListenErrorKind } from "../pipeline/step1-transcribe";

export type CheckState =
  | { phase: "idle" }
  | { phase: "listening"; interim: string }
  | { phase: "heard"; text: string }
  | { phase: "error"; kind: ListenErrorKind };

/** Short, plain, spoken-style messages. Each one tells Meera what to do next. */
export const LISTEN_ERROR_MESSAGE: Record<ListenErrorKind, string> = {
  "no-speech": "I didn't hear anything. Press the button and say the name of your medicine.",
  "mic-denied": "I need to use the microphone. Please allow it, then press the button again.",
  "no-mic": "I can't find a microphone. Please check it's plugged in, then press the button again.",
  aborted: "",
  failed: "Something went wrong while listening. Please press the button and try again.",
};

/** What Meera sees while PillCheck listens, and what it heard. */
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

  if (state.phase === "heard") {
    return (
      <section className="listen" aria-live="polite">
        <p className="listen-label">You asked:</p>
        <p className="listen-words">“{state.text}”</p>
        <p className="chip chip-device">
          <span aria-hidden="true">🔒</span> {ROUTING_POLICY.transcribe.label}
        </p>
        <p className="hint">Next in the build: understanding it on this device (Day 4).</p>
      </section>
    );
  }

  return (
    <section className="listen listen-error" role="alert">
      <p>{LISTEN_ERROR_MESSAGE[state.kind]}</p>
    </section>
  );
}
