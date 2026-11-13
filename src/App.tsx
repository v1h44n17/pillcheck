import { useEffect, useState } from "react";
import { boot, type BootReport } from "./boot";
import { probeCapabilities, type Availability, type DeviceCapabilities } from "./guards/capabilities";

/**
 * Day 1 screen: the senior-facing shell plus a "System check" panel.
 * The big button is inert until Day 3 (Step 1, on-device speech).
 */
export function App() {
  const [report, setReport] = useState<BootReport | null>(null);
  const [caps, setCaps] = useState<DeviceCapabilities | null>(null);

  useEffect(() => {
    let alive = true;
    boot().then((r) => alive && setReport(r));
    probeCapabilities().then((c) => alive && setCaps(c));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <main className="shell">
      <header className="brand">
        <span className="brand-mark" aria-hidden="true">✚</span>
        <h1>PillCheck</h1>
      </header>

      <p className="lede">Ask out loud if a medicine is safe to take with your other pills.</p>

      <button className="big-button" type="button" disabled aria-describedby="soon">
        Check my medicine
      </button>
      <p id="soon" className="hint">Listening arrives on Day 3 of the build.</p>

      <section className="panel" aria-labelledby="syscheck">
        <h2 id="syscheck">System check</h2>
        <ul className="checks">
          <BootRows report={report} />
          <CapRow label="Gemini Nano (on-device AI)" value={caps?.nano} />
          <CapRow label="On-device speech recognition" value={caps?.localSpeech} />
          <Row
            label="On-device voices for speaking"
            state={caps == null ? "pending" : caps.localVoices > 0 ? "ok" : "warn"}
            detail={caps == null ? "Checking…" : `${caps.localVoices} available`}
          />
        </ul>
      </section>
    </main>
  );
}

type RowState = "ok" | "warn" | "fail" | "pending";

function Row({ label, state, detail }: { label: string; state: RowState; detail: string }) {
  const icon = { ok: "✓", warn: "!", fail: "✕", pending: "…" }[state];
  return (
    <li className={`check check-${state}`}>
      <span className="check-icon" aria-hidden="true">{icon}</span>
      <span className="check-label">{label}</span>
      <span className="check-detail">{detail}</span>
    </li>
  );
}

function BootRows({ report }: { report: BootReport | null }) {
  if (!report) {
    return (
      <>
        <Row label="Firebase" state="pending" detail="Connecting…" />
        <Row label="App Check" state="pending" detail="Verifying…" />
        <Row label="Anonymous sign-in" state="pending" detail="Signing in…" />
      </>
    );
  }
  if (!report.ok && report.stage === "config") {
    return (
      <Row
        label="Firebase config"
        state="fail"
        detail={`Missing in .env.local: ${report.missing.join(", ")}`}
      />
    );
  }
  const modeLabel = (m?: string) => (m === "debug" ? "debug provider" : "reCAPTCHA Enterprise");
  if (!report.ok) {
    return (
      <>
        <Row label="Firebase" state="ok" detail="Configured" />
        <Row
          label="App Check"
          state={report.stage === "appcheck" ? "fail" : "ok"}
          detail={report.stage === "appcheck" ? report.error : `Token ✓ (${modeLabel(report.appCheckMode)})`}
        />
        {report.stage === "auth" && <Row label="Anonymous sign-in" state="fail" detail={report.error} />}
      </>
    );
  }
  return (
    <>
      <Row label="Firebase" state="ok" detail={`Project ${report.projectId}`} />
      <Row label="App Check" state="ok" detail={`Token ✓ (${modeLabel(report.appCheckMode)})`} />
      <Row label="Anonymous sign-in" state="ok" detail={`UID ${report.uid.slice(0, 8)}…`} />
    </>
  );
}

function CapRow({ label, value }: { label: string; value: Availability | undefined }) {
  if (value === undefined) return <Row label={label} state="pending" detail="Checking…" />;
  const map: Record<Availability, [RowState, string]> = {
    available: ["ok", "Ready on this device"],
    downloadable: ["warn", "Supported. Model needs downloading"],
    downloading: ["warn", "Downloading…"],
    unavailable: ["fail", "Not supported on this device"],
    "api-missing": ["fail", "Not exposed by this browser (check Chrome flag)"],
    error: ["fail", "Probe failed"],
  };
  const [state, detail] = map[value];
  return <Row label={label} state={state} detail={detail} />;
}
