import { useEffect, useState } from "react";
import { boot, type BootReport } from "./boot";
import {
  checkReadiness,
  countLocalVoices,
  setupOnDevice,
  type Readiness,
} from "./guards/onDeviceGuard";
import { speakLocally } from "./pipeline/step4-speak";
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
    // Day 3: Step 1, on-device listening.
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
            className="big-button"
            type="button"
            disabled={state === undefined || state === "ready"}
            onClick={onCheckPressed}
          >
            Check my medicine
          </button>
          {state === undefined && <p className="hint">Getting ready…</p>}
          {state === "ready" && <p className="hint">Ready. Listening arrives on Day 3 of the build.</p>}
        </>
      )}

      {state === "unsupported" && readiness && <RefusalScreen readiness={readiness} />}

      <SystemCheck report={report} readiness={readiness} voices={voices} />
    </main>
  );
}
