import type { InteractionAnswer, Verdict } from "../pipeline/step3-check";
import { speakLocally } from "../pipeline/step4-speak";

const VERDICT_UI: Record<Verdict, { icon: string; title: string; tone: string }> = {
  ok: { icon: "✓", title: "Yes, that's okay", tone: "ok" },
  caution: { icon: "!", title: "Yes, but be careful", tone: "caution" },
  avoid: { icon: "✕", title: "Check with your pharmacist first", tone: "avoid" },
  unsure: { icon: "?", title: "I'm not sure", tone: "unsure" },
};

/** The answer Meera hears, plus the "how did we get here" receipt for helpers and judges. */
export function AnswerCard({ answer }: { answer: InteractionAnswer }) {
  const v = VERDICT_UI[answer.verdict];
  return (
    <section className={`answer answer-${v.tone}`} aria-live="polite">
      <p className="answer-verdict">
        <span className="answer-icon" aria-hidden="true">
          {v.icon}
        </span>
        {v.title}
      </p>
      <p className="answer-spoken">{answer.spoken}</p>
      {answer.waitHours !== undefined && (
        <p className="answer-wait">
          Wait <strong>{answer.waitHours} hours</strong> between them.
        </p>
      )}

      <button className="secondary-button" type="button" onClick={() => void speakLocally(answer.spoken)}>
        <span aria-hidden="true">🔊</span> Hear it again
      </button>

      <details className="helper">
        <summary>Why, and what was sent</summary>
        {answer.interactions.length > 0 && (
          <ul>
            {answer.interactions.map((i) => (
              <li key={i.between.join("+")}>
                <strong>
                  {i.between.join(" + ")} ({i.severity})
                </strong>
                <span>{i.note}</span>
              </li>
            ))}
          </ul>
        )}
        <p>
          <strong>Sent to the cloud:</strong> <code>{answer.sent.medicines.join(", ")}</code>
          {answer.sent.cabinet.length > 0 && (
            <>
              {" "}
              with <code>{answer.sent.cabinet.join(", ")}</code>
            </>
          )}
          . Nothing else: no voice, no words you said, no name.
        </p>
        <p>
          <strong>Checked against:</strong>{" "}
          {answer.grounded.length > 0 ? `official FDA labels for ${answer.grounded.join(", ")}` : "no FDA label found"}
          {answer.ungrounded.length > 0 && `; no label found for ${answer.ungrounded.join(", ")}`}. Model:{" "}
          <code>{answer.model}</code>.
        </p>
        {answer.labelSetIds.length > 0 && (
          <p>
            {answer.labelSetIds.map((id, n) => (
              <a
                key={id}
                href={`https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=${encodeURIComponent(id)}`}
                target="_blank"
                rel="noreferrer"
              >
                FDA label {n + 1}
                {n < answer.labelSetIds.length - 1 ? " · " : ""}
              </a>
            ))}
          </p>
        )}
      </details>

      <p className="disclaimer">
        PillCheck is not a doctor. If you feel unwell, call your doctor, or 911 in an emergency.
      </p>
    </section>
  );
}
