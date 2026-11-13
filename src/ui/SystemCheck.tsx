import type { BootReport } from "../boot";
import type { CapabilityReport, Readiness } from "../guards/onDeviceGuard";

type RowState = "ok" | "warn" | "fail" | "pending";

/** Technical status panel (for helpers and judges). Day 10 tucks it away for Meera. */
export function SystemCheck({
  report,
  readiness,
  voices,
}: {
  report: BootReport | null;
  readiness: Readiness | null;
  voices: number | null;
}) {
  return (
    <details className="panel" open>
      <summary>System check</summary>
      <ul className="checks">
        <BootRows report={report} />
        <CapRow label="Gemini Nano (on-device AI)" r={readiness?.nano} />
        <CapRow label="On-device speech recognition" r={readiness?.speech} />
        <Row
          label="On-device voices for speaking"
          state={voices == null ? "pending" : voices > 0 ? "ok" : "warn"}
          detail={voices == null ? "Checking…" : `${voices} available`}
        />
      </ul>
    </details>
  );
}

function Row({ label, state, detail }: { label: string; state: RowState; detail: string }) {
  const icon = { ok: "✓", warn: "!", fail: "✕", pending: "…" }[state];
  return (
    <li className={`check check-${state}`}>
      <span className="check-icon" aria-hidden="true">
        {icon}
      </span>
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
      <Row label="Firebase config" state="fail" detail={`Missing in .env.local: ${report.missing.join(", ")}`} />
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

function CapRow({ label, r }: { label: string; r: CapabilityReport | undefined }) {
  if (!r) return <Row label={label} state="pending" detail="Checking…" />;
  const detail: Record<CapabilityReport["detail"], string> = {
    available: "Ready on this device",
    downloadable: "Supported. Needs one-time setup",
    downloading: "Downloading…",
    unavailable: "Not supported on this device",
    "api-missing": "Not exposed by this browser",
    error: "Check failed",
    simulated: "Turned off (?simulate)",
  };
  const state: RowState = r.state === "ready" ? "ok" : r.state === "needs-setup" ? "warn" : "fail";
  return <Row label={label} state={state} detail={detail[r.detail]} />;
}
