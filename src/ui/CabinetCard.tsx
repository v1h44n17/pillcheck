import { useEffect, useState } from "react";
import type { AddResult, CabinetItem } from "../cabinet/cabinet";
import { addSummary } from "../cabinet/addByVoice";
import { CHECK_ERROR_MESSAGE, type CheckErrorKind } from "../pipeline/messages";
import { ROUTING_POLICY } from "../pipeline/policy";

export type AddState =
  | { phase: "idle" }
  | { phase: "listening"; interim: string }
  | { phase: "understanding"; text: string }
  | { phase: "added"; results: AddResult[] }
  | { phase: "error"; kind: CheckErrorKind };

function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/**
 * Remove needs two taps ("Remove" → "Tap again to remove"). One stray tap must
 * not silently take warfarin off the list that every check depends on.
 */
function RemoveButton({ name, onRemove }: { name: string; onRemove: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      className={`remove-button${armed ? " is-armed" : ""}`}
      aria-label={armed ? `Tap again to remove ${name}` : `Remove ${name}`}
      onClick={() => (armed ? onRemove() : setArmed(true))}
    >
      {armed ? "Tap again to remove" : "Remove"}
    </button>
  );
}

export function CabinetCard({
  items,
  addState,
  busy,
  onAdd,
  onRemove,
}: {
  items: readonly CabinetItem[];
  addState: AddState;
  /** A check is running: adding would compete for the microphone. */
  busy: boolean;
  onAdd: () => void;
  onRemove: (heard: string) => void;
}) {
  const listening = addState.phase === "listening";
  return (
    <section className="cabinet" aria-labelledby="cabinet-title">
      <h2 id="cabinet-title">My medicines</h2>
      <p className="hint">
        <span aria-hidden="true">🔒</span> {ROUTING_POLICY.cabinet.label}. New medicines are checked against this list.
      </p>

      {items.length === 0 ? (
        <p className="cabinet-empty">No medicines yet. Add the ones you take every day.</p>
      ) : (
        <ul className="cabinet-list">
          {items.map((i) => {
            const generic = i.ingredients.join(" + ");
            return (
              <li key={i.heard}>
                <span className="cabinet-name">
                  {titleCase(i.heard)}
                  {generic !== i.heard && <span className="cabinet-generic">{generic}</span>}
                </span>
                <RemoveButton name={titleCase(i.heard)} onRemove={() => onRemove(i.heard)} />
              </li>
            );
          })}
        </ul>
      )}

      <button
        type="button"
        className={`secondary-button add-button${listening ? " is-listening" : ""}`}
        aria-pressed={listening}
        disabled={busy || addState.phase === "understanding"}
        onClick={onAdd}
      >
        {listening ? "I'm done talking" : <><span aria-hidden="true">＋</span> Add a medicine</>}
      </button>

      <div aria-live="polite">
        {listening && (
          <p className="listen-status">
            <span className="listen-dot" aria-hidden="true" />
            Say the name of a medicine you take{addState.interim ? `: “${addState.interim}”` : "."}
          </p>
        )}
        {addState.phase === "understanding" && (
          <p className="listen-status">
            <span className="listen-dot listen-dot-think" aria-hidden="true" />
            Understanding on this device…
          </p>
        )}
        {addState.phase === "added" && <p className="cabinet-result">{addSummary(addState.results)}</p>}
        {addState.phase === "error" && <p className="cabinet-result">{CHECK_ERROR_MESSAGE[addState.kind]}</p>}
      </div>
    </section>
  );
}
