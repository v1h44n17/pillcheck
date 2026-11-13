import type { CapabilityReport, Readiness } from "../guards/onDeviceGuard";

/** What PillCheck says, out loud and on screen, when it can't run on-device. */
export const REFUSAL_SPOKEN =
  "I can't check safely on this device. I won't send your question anywhere. " +
  "If you're unsure about a medicine, please call your pharmacist.";

const LABEL: Record<CapabilityReport["capability"], string> = {
  nano: "On-device AI (Gemini Nano)",
  speech: "On-device listening (speech recognition)",
};

function explain(r: CapabilityReport): string {
  switch (r.detail) {
    case "simulated":
      return "Turned off on purpose for this demo (the ?simulate= link).";
    case "api-missing":
      return r.capability === "nano"
        ? "This browser doesn't offer Gemini Nano. Use Chrome 139 or newer on a desktop computer and turn on chrome://flags/#prompt-api-for-gemini-nano-multimodal-input, then relaunch Chrome."
        : "This browser can't recognise speech on the device itself. Use an up-to-date Chrome on a desktop computer.";
    case "unavailable":
      return r.capability === "nano"
        ? "This computer doesn't meet the requirements: about 22 GB of free disk space and a graphics card with more than 4 GB of memory (or 16 GB of RAM)."
        : "Chrome can't recognise US English speech on this device itself. Update Chrome; on-device speech isn't available on every system (for example ChromeOS).";
    default:
      return "The check didn't complete. Restarting Chrome often fixes this.";
  }
}

/**
 * The "loud refusal". Shown whenever a required on-device capability is
 * missing. PillCheck never falls back to a cloud service for Steps 1–2.
 */
export function RefusalScreen({ readiness }: { readiness: Readiness }) {
  const missing = [readiness.nano, readiness.speech].filter((r) => r.state === "unsupported");
  return (
    <section className="refusal" role="alert">
      <h2>I can't check safely on this device.</h2>
      <p>
        To keep your question private, PillCheck only listens and thinks on this computer. This
        computer can't do that right now, so <strong>I won't send your question anywhere.</strong>
      </p>
      <p className="refusal-next">If you're unsure about a medicine, please call your pharmacist.</p>

      <details className="helper">
        <summary>For a family member or helper: what's missing</summary>
        <ul>
          {missing.map((r) => (
            <li key={r.capability}>
              <strong>{LABEL[r.capability]}</strong>
              <span>{explain(r)}</span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
