import { useState } from "react";
import { describeEntry, fetchMyReceipt, summarizeReceipt, type ReceiptEntry } from "../receipt/receipt";

type LoadState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "loaded"; entries: ReceiptEntry[] }
  | { phase: "failed" };

const TIME = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * Meera's own audit log, read back in plain language. It shows, for every
 * past check, where the steps ran and exactly which names left the computer.
 */
export function PrivacyReceipt() {
  const [state, setState] = useState<LoadState>({ phase: "idle" });

  function load() {
    setState({ phase: "loading" });
    fetchMyReceipt()
      .then((entries) => setState({ phase: "loaded", entries }))
      .catch(() => setState({ phase: "failed" }));
  }

  return (
    <section className="helpers-section receipt" aria-labelledby="receipt-title">
      <h2 id="receipt-title">Privacy receipt</h2>
      <p>Every check is recorded: where each step ran, and exactly what was sent online. Never your voice or your words.</p>

      <button type="button" className="secondary-button" onClick={load} disabled={state.phase === "loading"}>
        {state.phase === "loading" ? "Loading…" : state.phase === "loaded" ? "Refresh" : "Show my privacy log"}
      </button>
      {state.phase === "failed" && <p role="alert">Couldn't load the log right now. Please try again later.</p>}

      {state.phase === "loaded" && <ReceiptList entries={state.entries} />}
    </section>
  );
}

function ReceiptList({ entries }: { entries: ReceiptEntry[] }) {
  if (entries.length === 0) return <p>No checks yet.</p>;
  const s = summarizeReceipt(entries);
  return (
    <>
      <p className="receipt-summary" aria-live="polite">
        <strong>
          {s.checks} check{s.checks === 1 ? "" : "s"}.
        </strong>{" "}
        The only things that ever left this computer were medicine names
        {s.namesEverSent.length ? `: ${s.namesEverSent.join(", ")}` : " (none so far)"}.
        {s.blocked > 0 && ` ${s.blocked} stopped by the privacy check.`}
        {s.refused > 0 && ` ${s.refused} refused because the private steps weren't available.`}
      </p>
      <ol className="receipt-list">
        {entries.map((e) => (
          <li key={e.id}>
            <span className="receipt-time">{e.at ? TIME.format(e.at) : "Just now"}</span>
            <span className="receipt-what">{describeEntry(e)}</span>
            <span className="receipt-tags">
              {e.extractOnDevice && <span className="tag">🔒 Understood on this device</span>}
              {e.checkedInCloud ? (
                <span className="tag tag-cloud">☁️ Sent: {[...e.sentMedicines, ...e.sentCabinet].join(", ")}</span>
              ) : (
                <span className="tag">Sent: nothing</span>
              )}
              {e.guard === "blocked" && <span className="tag tag-blocked">Privacy check: {e.findings.join(", ")}</span>}
              {e.demo && <span className="tag">Demo</span>}
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}
