import { useEffect, useRef, useState } from "react";
import { boot, type BootReport } from "./boot";
import {
  checkReadiness,
  countLocalVoices,
  OnDeviceUnavailableError,
  setupOnDevice,
  type Readiness,
} from "./guards/onDeviceGuard";
import { ListenError, listenOnce, type ListenHandle } from "./pipeline/step1-transcribe";
import { speakLocally } from "./pipeline/step4-speak";
import { LISTEN_ERROR_MESSAGE, ListeningPanel, type CheckState } from "./ui/ListeningPanel";
import { REFUSAL_SPOKEN, RefusalScreen } from "./ui/RefusalScreen";
import { SetupCard, type SetupState } from "./ui/SetupCard";
import { SystemCheck } from "./ui/SystemCheck";

/**
 * The screen is driven by on-device readiness (src/guards/onDeviceGuard.ts):
 *   ready        → "Check my medicine" (listening arrives on Day 3)
 *   needs-setup  → one-time download of speech + Gemini Nano
 *   unsupported  → loud refusal. The button still works, but only to SAY the refusal.
 */
export function App() {
  const [report, setReport] = useState<BootReport | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [voices, setVoices] = useState<number | null>(null);
  const [setup, setSetup] = useState<SetupState>({ phase: "idle" });
  const [check, setCheck] = useState<CheckState>({ phase: "idle" });
  const listening = useRef<ListenHandle | null>(null);

  useEffect(() => {
    let alive = true;
    boot().then((r) => alive && setReport(r));
    checkReadiness().then((r) => alive && setReadiness(r));
    countLocalVoices().then((n) => alive && setVoices(n));
    return () => {
      alive = false;
    };
  }, []);

  function runSetup() {
    if (!readiness) return;
    setSetup({ phase: "running" });
    // setupOnDevice starts both downloads before its first await, so they run
    // inside this click's user gesture.
    setupOnDevice(readiness, ({ capability, fraction }) =>
      setSetup((s) => (s.phase === "running" ? { ...s, [capability]: fraction } : s)),
    )
      .then((r) => {
        setReadiness(r);
        setSetup({ phase: "idle" });
      })
      .catch((e: unknown) =>
        setSetup({ phase: "failed", message: e instanceof Error ? e.message : String(e) }),
      );
  }

  function onCheckPressed() {
    if (readiness?.overall === "unsupported") {
      void speakLocally(REFUSAL_SPOKEN);
      return;
    }

    // Second press while listening = "I'm done talking".
    if (listening.current) {
      listening.current.stop();
      return;
    }

    // Never let the microphone hear PillCheck's own voice.
    if ("speechSynthesis" in globalThis) speechSynthesis.cancel();

    setCheck({ phase: "listening", interim: "" });
    const handle = listenOnce({ onInterim: (interim) => setCheck({ phase: "listening", interim }) });
    listening.current = handle;

    handle.result
      .then((t) => setCheck({ phase: "heard", text: t.text }))
      .catch(async (e: unknown) => {
        if (e instanceof OnDeviceUnavailableError) {
          // Privacy problem: re-check and show the refusal; never retry in the cloud.
          setCheck({ phase: "idle" });
          setReadiness(await checkReadiness());
          void speakLocally(REFUSAL_SPOKEN);
          return;
        }
        const kind = e instanceof ListenError ? e.kind : "failed";
        if (kind === "aborted") return setCheck({ phase: "idle" });
        setCheck({ phase: "error", kind });
        void speakLocally(LISTEN_ERROR_MESSAGE[kind]);
      })
      .finally(() => {
        listening.current = null;
      });
  }

  const state = readiness?.overall;

  return (
    <main className="shell">
      <header className="brand">
        <span className="brand-mark" aria-hidden="true">
          ✚
        </span>
        <h1>PillCheck</h1>
      </header>

      <p className="lede">Ask out loud if a medicine is safe to take with your other pills.</p>

      {state === "needs-setup" && readiness ? (
        <SetupCard readiness={readiness} setup={setup} onSetup={runSetup} />
      ) : (
        <>
          <button
            className={`big-button${check.phase === "listening" ? " is-listening" : ""}`}
            type="button"
            disabled={state === undefined}
            aria-pressed={check.phase === "listening"}
            onClick={onCheckPressed}
          >
            {check.phase === "listening" ? "I'm done talking" : "Check my medicine"}
          </button>
          {state === undefined && <p className="hint">Getting ready…</p>}
          {state === "ready" && check.phase === "idle" && (
            <p className="hint">Press the button, then say the name of your medicine.</p>
          )}
        </>
      )}

      {state === "ready" && <ListeningPanel state={check} />}

      {state === "unsupported" && readiness && <RefusalScreen readiness={readiness} />}

      <SystemCheck report={report} readiness={readiness} voices={voices} />
    </main>
  );
}
