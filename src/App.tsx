import { useEffect, useRef, useState } from "react";
import { boot, type BootReport } from "./boot";
import { addByVoice, defaultAddDeps } from "./cabinet/addByVoice";
import { cabinet } from "./cabinet/cabinet";
import { useCabinet } from "./cabinet/useCabinet";
import { checkReadiness, countLocalVoices, setupOnDevice, type Readiness } from "./guards/onDeviceGuard";
import { CabinetCard, type AddState } from "./ui/CabinetCard";
import { provenanceFor, type LogState } from "./ui/provenance";
import { ProvenanceStrip } from "./ui/ProvenanceStrip";
import { getConfig } from "./firebase/remoteConfig";
import { REFUSAL_SPOKEN } from "./pipeline/messages";
import { defaultDeps, runCheck, type PipelineEvent, type RunHandle } from "./pipeline/orchestrator";
import { speakLocally } from "./pipeline/step4-speak";
import { activeSimulateFlags, writeAudit } from "./pipeline/step5-audit";
import { ListeningPanel, type CheckState } from "./ui/ListeningPanel";
import { RefusalScreen } from "./ui/RefusalScreen";
import { SetupCard, type SetupState } from "./ui/SetupCard";
import { DemoPanel } from "./ui/DemoPanel";
import { HelpersDrawer } from "./ui/HelpersDrawer";

function MicIcon() {
  return (
    <svg className="big-button-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M12 15a4 4 0 0 0 4-4V6a4 4 0 1 0-8 0v5a4 4 0 0 0 4 4Zm6.5-4a1 1 0 1 1 2 0 8.5 8.5 0 0 1-7.5 8.44V22a1 1 0 1 1-2 0v-2.56A8.5 8.5 0 0 1 3.5 11a1 1 0 1 1 2 0 6.5 6.5 0 0 0 13 0Z"
      />
    </svg>
  );
}

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
  const [logState, setLogState] = useState<LogState>("none");
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
      // Record the refusal too, so the privacy receipt shows "Refused: nothing sent".
      void writeAudit({
        outcome: "refused",
        leakGuard: { result: "not-run" },
        spoken: true,
        demo: { injectedPii: false, simulate: activeSimulateFlags() },
      });
      return;
    }
    // Remote Config kill switch: refuse (out loud), never degrade.
    const cfg = getConfig();
    if (cfg.checksPaused) {
      void speakLocally(cfg.pausedMessage);
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
    setLogState("none");

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
        if (!e.guard.ok) setLogState("pending");
        return setCheck({ phase: "understood", text: e.text, guard: e.guard, injected: e.injected, checking: e.checking });
      case "answered":
        setLogState("pending");
        return setCheck({ phase: "answered", text: e.text, answer: e.answer });
      case "error":
        if (e.kind === "no-medicine" || e.kind === "not-understood" || e.kind.startsWith("check-")) setLogState("pending");
        return setCheck({ phase: "error", kind: e.kind });
      case "logged":
        return setLogState(e.ok ? "ok" : "failed");
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
  const provenance = provenanceFor(check, logState);
  // Presenter controls: only with ?demo in the URL.
  const showDemoPanel = new URLSearchParams(location.search).has("demo");
  const listening = check.phase === "listening";
  // Busy = PillCheck is working; the button says "Please wait…" instead of looking broken.
  const busy =
    state === undefined ||
    check.phase === "understanding" ||
    (check.phase === "understood" && check.checking) ||
    addState.phase === "listening" ||
    addState.phase === "understanding";

  return (
    <main className="shell">
      <header className="brand">
        <span className="brand-mark" aria-hidden="true">
          ✚
        </span>
        <h1>PillCheck</h1>
      </header>

      <p className="lede">Ask out loud if a medicine is safe to take with your other pills.</p>
      <p className="trust">
        <span aria-hidden="true">🔒</span> Your voice stays on this computer. Only medicine names are checked online.
      </p>

      {showDemoPanel && (
        <DemoPanel
          onFlagsChanged={() => {
            // Flags changed: re-run the on-device checks (e.g. "no on-device AI" → refusal) and start fresh.
            run.current?.cancel();
            if ("speechSynthesis" in globalThis) speechSynthesis.cancel();
            setCheck({ phase: "idle" });
            setLogState("none");
            void checkReadiness().then(setReadiness);
          }}
        />
      )}

      {report?.ok && report.config.checksPaused && (
        <p className="paused-banner" role="status">
          {report.config.pausedMessage}
        </p>
      )}

      {state === "needs-setup" && readiness ? (
        <SetupCard readiness={readiness} setup={setup} onSetup={runSetup} />
      ) : (
        <>
          <button
            className={`big-button${listening ? " is-listening" : ""}${busy ? " is-busy" : ""}`}
            type="button"
            disabled={busy}
            aria-pressed={listening}
            onClick={onCheckPressed}
          >
            <MicIcon />
            <span>{listening ? "I'm done talking" : busy ? "Please wait…" : "Check my medicine"}</span>
          </button>
          {state === "ready" && check.phase === "idle" && (
            <p className="hint">Press the button, then say the name of your medicine.</p>
          )}
        </>
      )}

      {/* Reserve space while the device check runs, so content doesn't jump (layout shift). */}
      {state === undefined && <div className="stage-placeholder" aria-hidden="true" />}

      {/* The answer first; where each step ran, right under it. */}
      {state === "ready" && <ListeningPanel state={check} />}

      {state === "ready" && provenance && <ProvenanceStrip steps={provenance} />}

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

      <HelpersDrawer report={report} readiness={readiness} voices={voices} />
    </main>
  );
}
