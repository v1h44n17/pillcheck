import type { ProvenanceStep, StepStatus } from "./provenance";

const STATUS_ICON: Record<StepStatus, string> = {
  waiting: "○",
  active: "…",
  done: "✓",
  skipped: "–",
  blocked: "✕",
  failed: "!",
};

const STATUS_TEXT: Record<StepStatus, string> = {
  waiting: "waiting",
  active: "in progress",
  done: "done",
  skipped: "skipped",
  blocked: "blocked",
  failed: "didn't work",
};

/**
 * One row per step: what happened and WHERE it ran. Meera (and a judge) can
 * always see that hearing and understanding stayed on this device.
 */
export function ProvenanceStrip({ steps }: { steps: ProvenanceStep[] }) {
  return (
    <ol className="prov" aria-label="Where each step of this check ran">
      {steps.map((s) => (
        <li key={s.id} className={`prov-step is-${s.status} where-${s.where}`}>
          <span className="prov-icon" aria-hidden="true">
            {STATUS_ICON[s.status]}
          </span>
          <span className="prov-text">
            <span className="prov-label">{s.label}</span>
            <span className="prov-where">{s.where === "cloud" ? "☁️ Cloud" : "🔒 This device"}</span>
            {s.note && <span className="prov-note">{s.note}</span>}
          </span>
          <span className="visually-hidden">: {STATUS_TEXT[s.status]}</span>
        </li>
      ))}
    </ol>
  );
}
