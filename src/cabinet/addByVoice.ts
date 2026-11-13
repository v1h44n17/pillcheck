import { getConfig } from "../firebase/remoteConfig";
import { OnDeviceUnavailableError, RoutingViolationError } from "../guards/onDeviceGuard";
import { CHECK_ERROR_MESSAGE, REFUSAL_SPOKEN, type CheckErrorKind } from "../pipeline/messages";
import { ListenError, listenOnce, type ListenHandle, type ListenOptions } from "../pipeline/step1-transcribe";
import { ExtractionError, extractMedicines, type Extraction } from "../pipeline/step2-extract";
import { speakLocally } from "../pipeline/step4-speak";
import { cabinet as defaultStore, type AddResult, type CabinetStore } from "./cabinet";

/**
 * "Add a medicine" by voice. Uses ONLY the on-device steps:
 *   Step 1 (on-device speech) → Step 2 (Gemini Nano) → lexicon → this browser's storage.
 * No network request is made at any point: there's nothing to check yet, so
 * nothing needs to leave the device.
 */

export interface AddByVoiceDeps {
  listen: (opts: ListenOptions) => ListenHandle;
  extract: (transcript: string) => Promise<Extraction>;
  speak: (text: string) => Promise<boolean>;
  store: Pick<CabinetStore, "add">;
}

export const defaultAddDeps: AddByVoiceDeps = {
  listen: (opts) => listenOnce({ ...opts, maxMs: getConfig().listenMaxMs }),
  extract: (t) => extractMedicines(t),
  speak: speakLocally,
  store: defaultStore,
};

export type AddEvent =
  | { type: "listening"; interim: string }
  | { type: "understanding"; text: string }
  | { type: "added"; text: string; results: AddResult[] }
  | { type: "error"; kind: CheckErrorKind }
  | { type: "refused" }
  | { type: "idle" };

function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function joinNames(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** Short spoken summary, e.g. "I added Coumadin and Lipitor to your medicines." */
export function addSummary(results: AddResult[]): string {
  const added = results.flatMap((r) => (r.status === "added" ? [titleCase(r.item.heard)] : []));
  const dupes = results.flatMap((r) => (r.status === "duplicate" ? [titleCase(r.item.heard)] : []));
  const unknown = results.flatMap((r) => (r.status === "unknown" ? [r.term] : []));
  const parts: string[] = [];
  if (added.length) parts.push(`I added ${joinNames(added)} to your medicines.`);
  if (dupes.length) parts.push(`${joinNames(dupes)} ${dupes.length > 1 ? "are" : "is"} already on your list.`);
  if (unknown.length) parts.push(`I don't know a medicine called ${joinNames(unknown)}. Please check the name.`);
  if (results.some((r) => r.status === "full")) parts.push("Your list is full. Please remove one first.");
  return parts.join(" ");
}

export function addByVoice(deps: AddByVoiceDeps, onEvent: (e: AddEvent) => void) {
  onEvent({ type: "listening", interim: "" });
  const listening = deps.listen({ onInterim: (interim) => onEvent({ type: "listening", interim }) });

  const done = (async (): Promise<AddResult[] | undefined> => {
    try {
      const heard = await listening.result;
      onEvent({ type: "understanding", text: heard.text });
      const { medicines } = await deps.extract(heard.text);
      if (medicines.length === 0) {
        onEvent({ type: "error", kind: "no-medicine" });
        await deps.speak(CHECK_ERROR_MESSAGE["no-medicine"]);
        return [];
      }
      const results = medicines.map((m) => deps.store.add(m));
      onEvent({ type: "added", text: heard.text, results });
      await deps.speak(addSummary(results));
      return results;
    } catch (e) {
      if (e instanceof OnDeviceUnavailableError || e instanceof RoutingViolationError) {
        onEvent({ type: "refused" });
        await deps.speak(REFUSAL_SPOKEN);
        return undefined;
      }
      const kind: CheckErrorKind =
        e instanceof ListenError ? e.kind : e instanceof ExtractionError ? "not-understood" : "failed";
      if (kind === "aborted") {
        onEvent({ type: "idle" });
        return undefined;
      }
      onEvent({ type: "error", kind });
      await deps.speak(CHECK_ERROR_MESSAGE[kind]);
      return undefined;
    }
  })();

  return { stop: () => listening.stop(), cancel: () => listening.cancel(), done };
}
