import type { BootReport } from "../boot";
import type { Readiness } from "../guards/onDeviceGuard";
import { ROUTING_POLICY, type StepId } from "../pipeline/policy";
import { SystemCheck } from "./SystemCheck";

/** The order a check runs in, plus where her list lives. */
const SHOWN: StepId[] = ["transcribe", "extract", "guard", "check", "speak", "audit", "cabinet"];

/**
 * Everything technical lives here, collapsed by default, so Meera's screen
 * stays simple, while a family member, pharmacist or judge can see exactly
 * how PillCheck works and whether this computer is set up correctly.
 */
export function HelpersDrawer({
  report,
  readiness,
  voices,
}: {
  report: BootReport | null;
  readiness: Readiness | null;
  voices: number | null;
}) {
  return (
    <details className="helpers">
      <summary>For family &amp; helpers</summary>

      <section className="helpers-section" aria-labelledby="privacy-title">
        <h2 id="privacy-title">How PillCheck protects privacy</h2>
        <ul className="policy-list">
          {SHOWN.map((id) => {
            const p = ROUTING_POLICY[id];
            return (
              <li key={id}>
                <span className={`policy-where where-${p.where}`}>{p.where === "cloud" ? "☁️ Cloud" : "🔒 This device"}</span>
                <strong>{p.label}</strong>
                <span>Leaves the device: {p.leavesDevice}</span>
              </li>
            );
          })}
        </ul>
        <p>If this computer can't do the private steps itself, PillCheck refuses instead of using the cloud.</p>
      </section>

      <SystemCheck report={report} readiness={readiness} voices={voices} />
    </details>
  );
}
