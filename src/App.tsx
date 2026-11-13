import { useEffect, useRef, useState } from "react";
import { boot, type BootReport } from "./boot";
import { addByVoice, defaultAddDeps } from "./cabinet/addByVoice";
import { cabinet } from "./cabinet/cabinet";
import { useCabinet } from "./cabinet/useCabinet";
import { checkReadiness, countLocalVoices, setupOnDevice, type Readiness } from "./guards/onDeviceGuard";
import { CabinetCard, type AddState } from "./ui/CabinetCard";
import { REFUSAL_SPOKEN } from "./pipeline/messages";
import { defaultDeps, runCheck, type PipelineEvent, type RunHandle } from "./pipeline/orchestrator";
import { speakLocally } from "./pipeline/step4-speak";
import { ListeningPanel, type CheckState } from "./ui/ListeningPanel";
import { RefusalScreen } from "./ui/RefusalScreen";
import { SetupCard, type SetupState } from "./ui/SetupCard";
import { SystemCheck } from "./ui/SystemCheck";

/**
 * The screen is driven by on-device readiness (src/guards/onDeviceGuard.ts):
 *   ready        → "Check my medicine" runs the pipeline (src/pipeline/orchestrator.ts)
 *   needs-setup  → one-time download of speech + Gemini Nano
 *   unsupported  → loud refusal. The button still works, but only to SAY the refusal.
 */
export function App() {
  const [report, setReport] = useState<BootReport | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [voices, setVoices] = useState<number | null>(null);
  const [setup, setSetup] = useState<SetupState>({ phase: "idle" });
  const [check, setCheck] = useState<CheckState>({ phase: "idle" });
  const run = useRef<RunHandle | null>(null);
  const runId = useRef(0);
  const medicines = useCabinet();
  const [addState, setAddState] = useState<AddState>({ phase: "idle" });
  const adding = useRef<ReturnType<typeof addByVoice> | null>(null);

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
    if (check.phase === "listening" && run.current) {
      run.current.stop();
      return;
    }

    // Never let the microphone hear PillCheck's own voice (e.g. a previous answer).
    if ("speechSynthesis" in globalThis) speechSynthesis.cancel();
    run.current?.cancel();
    setAddState({ phase: "idle" });

    // Only the newest run may update the screen (an old cloud answer must not overwrite a new question).
    const id = ++runId.current;
    // Her medicine list goes in as `cabinet`; the leak guard maps it to ingredient names.
    const deps = { ...defaultDeps, cabinet: () => cabinet.namesForCheck() };
    const handle = runCheck(deps, (e) => {
      if (id === runId.current) onPipelineEvent(e);
    });
    run.current = handle;
    void handle.done.finally(() => {
      if (run.current === handle) run.current = null;
    });
  }

  /** "Add a medicine": on-device listening + Nano + lexicon. No network. */
  function onAddPressed() {
    if (addState.phase === "listening" && adding.current) {
      adding.current.stop();
      return;
    }
    if ("speechSynthesis" in globalThis) speechSynthesis.cancel();
    setCheck({ phase: "idle" });
    const handle = addByVoice(defaultAddDeps, (e) => {
      switch (e.type) {
        case "listening":
          return setAddState({ phase: "listening", interim: e.interim });
        case "understanding":
          return setAddState({ phase: "understanding", text: e.text });
        case "added":
          return setAddState({ phase: "added", results: e.results });
        case "error":
          return setAddState({ phase: "error", kind: e.kind });
        case "idle":
          return setAddState({ phase: "idle" });
        case "refused":
          setAddState({ phase: "idle" });
          void checkReadiness().then(setReadiness);
          return;
      }
    });
    adding.current = handle;
    void handle.done.finally(() => {
      if (adding.current === handle) adding.current = null;
    });
  }

  /** Pipeline events → what's on screen. All speaking is done by the pipeline. */
  function onPipelineEvent(e: PipelineEvent) {
    switch (e.type) {
      case "listening":
        return setCheck({ phase: "listening", interim: e.interim });
      case "understanding":
        return setCheck({ phase: "understanding", text: e.text });
      case "guarded":
        return setCheck({ phase: "understood", text: e.text, guard: e.guard, injected: e.injected, checking: e.checking });
      case "answered":
        return setCheck({ phase: "answered", text: e.text, answer: e.answer });
      case "error":
        return setCheck({ phase: "error", kind: e.kind });
      case "idle":
        return setCheck({ phase: "idle" });
      case "refused":
        // Show the refusal screen. A routing violation means this device can't be trusted this session.
        setCheck({ phase: "idle" });
        void checkReadiness().then((r) => setReadiness(e.routingViolation ? { ...r, overall: "unsupported" } : r));
        return;
    }
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
            disabled={
              state === undefined ||
              check.phase === "understanding" ||
              (check.phase === "understood" && check.checking) ||
              addState.phase === "listening" ||
              addState.phase === "understanding"
            }
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

      {state === "ready" && (
        <CabinetCard
          items={medicines}
          addState={addState}
          busy={
            check.phase === "listening" ||
            check.phase === "understanding" ||
            (check.phase === "understood" && check.checking)
          }
          onAdd={onAddPressed}
          onRemove={(heard) => cabinet.remove(heard)}
        />
      )}

      {state === "unsupported" && readiness && <RefusalScreen readiness={readiness} />}

      <SystemCheck report={report} readiness={readiness} voices={voices} />
    </main>
  );
}
