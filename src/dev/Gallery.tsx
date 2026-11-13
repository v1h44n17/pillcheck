import type { ReactNode } from "react";
import type { Readiness } from "../guards/onDeviceGuard";
import { scanOutbound } from "../guards/leakGuard";
import { suggestCorrection } from "../data/suggest";
import type { InteractionAnswer, Verdict } from "../pipeline/step3-check";
import { CabinetCard } from "../ui/CabinetCard";
import { ListeningPanel, type CheckState } from "../ui/ListeningPanel";
import { provenanceFor, type LogState } from "../ui/provenance";
import { ProvenanceStrip } from "../ui/ProvenanceStrip";
import { RefusalScreen } from "../ui/RefusalScreen";
import { SetupCard } from "../ui/SetupCard";

/**
 * DEV-ONLY STATE GALLERY (localhost:5173/?gallery)
 *
 * Every screen PillCheck can show, rendered with the real components and
 * realistic data, so the design can be reviewed (and Lighthouse can audit)
 * all states at once. Never included in production builds: main.tsx only
 * imports this when import.meta.env.DEV is true.
 */

const answer = (verdict: Verdict, spoken: string, extra: Partial<InteractionAnswer> = {}): InteractionAnswer => ({
  verdict,
  spoken,
  interactions: [],
  sent: { medicines: ["ibuprofen"], cabinet: ["warfarin", "atorvastatin"] },
  matches: [{ heard: "advil", ingredients: ["ibuprofen"], via: "alias" }],
  grounded: ["ibuprofen", "warfarin", "atorvastatin"],
  ungrounded: [],
  labelSetIds: ["demo-1", "demo-2"],
  where: "cloud",
  inferenceSource: "in_cloud",
  model: "gemini-3.5-flash-lite",
  ...extra,
});

const ASKED = "Can I take Advil?";

const CHECKS: Array<[string, CheckState, LogState]> = [
  ["Listening", { phase: "listening", interim: "can I take ad" }, "none"],
  ["Understanding (Gemini Nano, on device)", { phase: "understanding", text: ASKED }, "none"],
  [
    "Privacy check passed, checking in the cloud",
    { phase: "understood", text: ASKED, guard: scanOutbound({ medicines: ["advil"], cabinet: ["coumadin"] }), injected: false, checking: true },
    "none",
  ],
  [
    "Leak-guard demo: blocked (?simulate=inject-pii)",
    {
      phase: "understood",
      text: ASKED,
      guard: scanOutbound({ medicines: ["advil", "Meera Sharma", "12/03/1951"] }),
      injected: true,
      checking: false,
    },
    "ok",
  ],
  [
    "Did you mean…? (misheard medicine, nothing sent)",
    {
      phase: "understood",
      text: "Can I take Advil with coumdin?",
      guard: scanOutbound({ medicines: ["advil", "coumdin"] }),
      injected: false,
      checking: false,
      suggestion: suggestCorrection(["advil", "coumdin"], [{ kind: "unknown-term", value: "coumdin", field: "medicines" }]),
    },
    "ok",
  ],
  [
    "Answer: avoid",
    {
      phase: "answered",
      text: ASKED,
      answer: answer(
        "avoid",
        "Please don't take Advil with your Coumadin. Using them together greatly raises your risk of serious bleeding. Check with your pharmacist first.",
        { interactions: [{ between: ["ibuprofen", "warfarin"], severity: "major", note: "Raises the risk of serious bleeding." }] },
      ),
    },
    "ok",
  ],
  [
    "Answer: caution, with wait time",
    {
      phase: "answered",
      text: "Can I take Tums with my Synthroid?",
      answer: answer(
        "caution",
        "You can take these together, but wait at least four hours between them so your body can absorb your thyroid medicine.",
        { waitHours: 4, sent: { medicines: ["calcium carbonate"], cabinet: ["levothyroxine"] } },
      ),
    },
    "pending",
  ],
  ["Answer: ok", { phase: "answered", text: "Can I take Tylenol?", answer: answer("ok", "Yes, Tylenol is fine with your other medicines. Don't take more than the label says.") }, "ok"],
  ["Answer: not sure", { phase: "answered", text: "Can I take Zyxlo?", answer: answer("unsure", "I'm not sure about this one. Please check with your pharmacist before taking it.") }, "failed"],
  ["Error: didn't hear anything", { phase: "error", kind: "no-speech" }, "none"],
  ["Error: no medicine named", { phase: "error", kind: "no-medicine" }, "ok"],
  ["Error: cloud unreachable", { phase: "error", kind: "check-unavailable" }, "ok"],
];

const readiness = (overall: Readiness["overall"], detail: "api-missing" | "downloadable" | "simulated"): Readiness => ({
  overall,
  nano: { capability: "nano", state: overall === "needs-setup" ? "needs-setup" : "unsupported", detail },
  speech: {
    capability: "speech",
    state: overall === "needs-setup" ? "needs-setup" : "ready",
    detail: overall === "needs-setup" ? "downloadable" : "available",
  },
  simulation: { noNano: detail === "simulated", noSpeech: false },
});

const CABINET = [
  { heard: "coumadin", ingredients: ["warfarin"], addedAt: 0 },
  { heard: "lisinopril", ingredients: ["lisinopril"], addedAt: 0 },
  { heard: "lipitor", ingredients: ["atorvastatin"], addedAt: 0 },
];

function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="gallery-frame" aria-label={title}>
      <h2 className="gallery-title">{title}</h2>
      {children}
    </section>
  );
}

export function Gallery() {
  return (
    <main className="shell">
      <h1>PillCheck: every screen (dev only)</h1>

      <Frame title="One-time setup">
        <SetupCard readiness={readiness("needs-setup", "downloadable")} setup={{ phase: "running", speech: 1, nano: 0.42 }} onSetup={() => {}} />
      </Frame>

      <Frame title="Refusal: no on-device AI">
        <RefusalScreen readiness={readiness("unsupported", "api-missing")} />
      </Frame>

      {CHECKS.map(([title, state, log]) => {
        const steps = provenanceFor(state, log);
        return (
          <Frame key={title} title={title}>
            <ListeningPanel state={state} onConfirmSuggestion={() => {}} />
            {steps && <ProvenanceStrip steps={steps} />}
          </Frame>
        );
      })}

      <Frame title="My medicines: empty">
        <CabinetCard items={[]} addState={{ phase: "idle" }} busy={false} onAdd={() => {}} onRemove={() => {}} />
      </Frame>
      <Frame title="My medicines: listening to add">
        <CabinetCard items={CABINET} addState={{ phase: "listening", interim: "I take Coumadin" }} busy={false} onAdd={() => {}} onRemove={() => {}} />
      </Frame>
      <Frame title="My medicines: just added">
        <CabinetCard
          items={CABINET}
          addState={{ phase: "added", results: [{ status: "added", item: CABINET[2]! }, { status: "unknown", term: "zyxlo" }] }}
          busy={false}
          onAdd={() => {}}
          onRemove={() => {}}
        />
      </Frame>
    </main>
  );
}
