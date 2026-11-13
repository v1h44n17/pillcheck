import type { Readiness } from "../guards/onDeviceGuard";

export type SetupState =
  | { phase: "idle" }
  | { phase: "running"; nano?: number; speech?: number }
  | { phase: "failed"; message: string };

/**
 * One-time setup: downloads the speech language pack and/or Gemini Nano.
 * The button click is required: Chrome only starts these downloads after a
 * user gesture.
 */
export function SetupCard({
  readiness,
  setup,
  onSetup,
}: {
  readiness: Readiness;
  setup: SetupState;
  onSetup: () => void;
}) {
  const running = setup.phase === "running";
  const needsSpeech = readiness.speech.state === "needs-setup";
  const needsNano = readiness.nano.state === "needs-setup";

  return (
    <section className="setup" aria-labelledby="setup-title">
      <h2 id="setup-title">One-time setup</h2>
      <p>
        PillCheck needs to put its listening and thinking tools on this computer, so your questions
        never leave it. This happens once and can take a few minutes.
      </p>

      <button className="big-button" type="button" onClick={onSetup} disabled={running}>
        {running ? "Setting up…" : "Set up PillCheck"}
      </button>

      {running && (
        <ul className="setup-progress" aria-live="polite">
          {needsSpeech && <ProgressRow label="Listening" value={setup.speech} />}
          {needsNano && <ProgressRow label="Understanding (Gemini Nano)" value={setup.nano} />}
        </ul>
      )}

      {setup.phase === "failed" && (
        <p className="setup-error" role="alert">
          Setup didn't finish: {setup.message} Please try again.
        </p>
      )}
    </section>
  );
}

function ProgressRow({ label, value }: { label: string; value: number | undefined }) {
  const done = value === 1;
  return (
    <li>
      <span>
        {label}: {done ? "ready ✓" : value === undefined ? "downloading…" : `${Math.round(value * 100)}%`}
      </span>
      {/* No value attribute → indeterminate bar while the browser reports no progress. */}
      <progress max={1} {...(value === undefined ? {} : { value })} />
    </li>
  );
}
