import type { MedicineMatch } from "../data/lexicon";
import { PII_KINDS, type FindingKind, type LeakGuardResult } from "../guards/leakGuard";

const KIND_LABEL: Record<FindingKind, string> = {
  "unexpected-field": "Unexpected extra information",
  "not-a-list": "No medicine to check",
  "not-text": "Something that isn't text",
  "too-many": "Too many items",
  "too-long": "Too long to be a medicine name",
  email: "An email address",
  phone: "A phone number",
  date: "A date (for example, a birthday)",
  "id-number": "An ID or account number",
  digits: "Numbers (a dose, age or time)",
  address: "An address",
  title: "A title such as Mrs or Dr",
  "personal-phrase": "Personal details",
  "possible-name": "What looks like a person's name",
  "unknown-term": "A word that isn't a medicine I know",
};

function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function MatchTag({ m }: { m: MedicineMatch }) {
  const same = m.ingredients.length === 1 && m.ingredients[0] === m.heard;
  return (
    <li>
      {titleCase(m.heard)}
      {!same && <span className="med-generic"> = {m.ingredients.join(" + ")}</span>}
    </li>
  );
}

/** Result of the leak guard, shown under "You asked". */
export function GuardResult({ guard, injected }: { guard: LeakGuardResult; injected: boolean }) {
  if (guard.ok) {
    return (
      <>
        <p className="listen-label">Medicine{guard.matches.length > 1 ? "s" : ""}:</p>
        <ul className="med-list">
          {guard.matches.map((m) => (
            <MatchTag key={m.heard} m={m} />
          ))}
        </ul>
        <p className="guard-ok">
          <span aria-hidden="true">🛡️</span> Passed the leak guard. Only these names would be sent:{" "}
          <code>{guard.payload.medicines.join(", ")}</code>
        </p>
      </>
    );
  }

  return (
    <div className="guard-blocked" role="alert">
      <p className="guard-blocked-title">
        <span aria-hidden="true">🛑</span> Stopped before sending
      </p>
      <p>
        {guard.findings.some((f) => PII_KINDS.has(f.kind))
          ? "Something personal was about to go to the cloud, so PillCheck stopped. "
          : "PillCheck only sends the names of medicines it recognises. "}
        <strong>Nothing left this device.</strong>
      </p>
      {injected && (
        <p className="hint">Demo: a fictional name and birthday were added on purpose (?simulate=inject-pii).</p>
      )}
      <ul className="guard-findings">
        {guard.findings.map((f, i) => (
          <li key={`${f.kind}-${i}`}>
            <strong>{KIND_LABEL[f.kind]}</strong>
            <span>“{f.value}”</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
