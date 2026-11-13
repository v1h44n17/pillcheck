import { useEffect, useRef, useState } from "react";
import { boot, type BootReport } from "./boot";
import {
  checkReadiness,
  countLocalVoices,
  OnDeviceUnavailableError,
  RoutingViolationError,
  setupOnDevice,
  type Readiness,
} from "./guards/onDeviceGuard";
import { ListenError, listenOnce, type ListenHandle } from "./pipeline/step1-transcribe";
import { ExtractionError, extractMedicines } from "./pipeline/step2-extract";
import { speakLocally } from "./pipeline/step4-speak";
import {
  CHECK_ERROR_MESSAGE,
  ListeningPanel,
  type CheckErrorKind,
  type CheckState,
} from "./ui/ListeningPanel";
import { REFUSAL_SPOKEN, RefusalScreen } from "./ui/RefusalScreen";
import { SetupCard, type SetupState } from "./ui/SetupCard";
import { SystemCheck } from "./ui/SystemCheck";

/** Step 2 understood the question but found no medicine name in it. */
class NoMedicineHeard extends Error {}

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
      .then(async (heard) => {
        listening.current = null;
        // Step 2: on-device understanding. The transcript never leaves this tab.
        setCheck({ phase: "understanding", text: heard.text });
        const { medicines } = await extractMedicines(heard.text);
        if (medicines.length === 0) throw new NoMedicineHeard();
        setCheck({ phase: "understood", text: heard.text, medicines });
      })
      .catch(async (e: unknown) => {
        if (e instanceof OnDeviceUnavailableError || e instanceof RoutingViolationError) {
          // Privacy problem: re-check and show the refusal; never retry in the cloud.
          if (e instanceof RoutingViolationError) {
            // Never log the transcript, only what went wrong.
            console.error("PillCheck routing violation:", e.message);
          }
          setCheck({ phase: "idle" });
          const r = await checkReadiness();
          setReadiness(e instanceof RoutingViolationError ? { ...r, overall: "unsupported" } : r);
          void speakLocally(REFUSAL_SPOKEN);
          return;
        }
        const kind: CheckErrorKind =
          e instanceof ListenError
            ? e.kind
            : e instanceof NoMedicineHeard
              ? "no-medicine"
              : e instanceof ExtractionError
                ? "not-understood"
                : "failed";
        if (kind === "aborted") return setCheck({ phase: "idle" });
        setCheck({ phase: "error", kind });
        void speakLocally(CHECK_ERROR_MESSAGE[kind]);
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
            disabled={state === undefined || check.phase === "understanding"}
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
