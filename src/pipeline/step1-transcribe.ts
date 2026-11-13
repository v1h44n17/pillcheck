import {
  assertLocalSpeechReady,
  ON_DEVICE_LANG,
  OnDeviceUnavailableError,
  readSimulation,
  type Simulation,
} from "../guards/onDeviceGuard";
import { ROUTING_POLICY } from "./policy";

/**
 * STEP 1: hear the question, ON-DEVICE ONLY.
 *
 * Routing decision (see policy.ts → transcribe): audio and transcript never
 * leave the device. Chrome's default Web Speech recogniser streams audio to a
 * Google server, so we:
 *   1. run the on-device guard first (language pack installed and available),
 *   2. require the instance to expose `processLocally` and set it to true,
 *   3. read it back; if the browser ignored it, refuse,
 *   4. treat a "network" error as proof the browser tried a server: refuse.
 *
 * The transcript is held in memory only: never logged, stored or sent.
 */

export interface Transcript {
  text: string;
  where: typeof ROUTING_POLICY.transcribe.where;
}

export type ListenErrorKind = "no-speech" | "mic-denied" | "no-mic" | "aborted" | "failed";

/** Recoverable listening problems (not privacy problems). */
export class ListenError extends Error {
  constructor(
    readonly kind: ListenErrorKind,
    detail?: string,
  ) {
    super(detail ? `${kind}: ${detail}` : kind);
    this.name = "ListenError";
  }
}

export interface ListenOptions {
  /** Live partial transcript, for showing words as they're recognised. */
  onInterim?: (text: string) => void;
  /** Hard stop so the mic never stays open. Chrome also stops on silence. */
  maxMs?: number;
  sim?: Simulation;
  /**
   * Contextual biasing: medicine names the recogniser should expect (on-device
   * only). Used when the browser supports it; ignored (with one retry without
   * phrases) when it doesn't. See src/data/biasPhrases.ts.
   */
  phrases?: ReadonlyArray<{ phrase: string; boost: number }>;
}

/** Internal: the recogniser rejected our bias phrases; retry without them. */
class PhrasesRejected extends Error {}

export interface ListenHandle {
  result: Promise<Transcript>;
  /** Stop listening and keep what was heard so far. */
  stop(): void;
  /** Stop listening and discard everything. */
  cancel(): void;
}

const DEFAULT_MAX_MS = 15_000;

function recognizerCtor(): SpeechRecognitionStatic | undefined {
  return globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition;
}

function mapError(code: string): Error {
  switch (code) {
    case "no-speech":
      return new ListenError("no-speech");
    case "aborted":
      return new ListenError("aborted");
    case "not-allowed":
      return new ListenError("mic-denied");
    case "audio-capture":
      return new ListenError("no-mic");
    // The on-device service itself is unavailable: privacy-relevant, so refuse.
    case "service-not-allowed":
    case "language-not-supported":
      return new OnDeviceUnavailableError("speech", "unavailable");
    // On-device recognition needs no network. A network error means the browser
    // tried to reach a speech server. Refuse rather than retry.
    case "network":
      return new OnDeviceUnavailableError("speech", "error");
    case "phrases-not-supported":
      return new PhrasesRejected(code);
    default:
      return new ListenError("failed", code);
  }
}

export function listenOnce(opts: ListenOptions = {}): ListenHandle {
  let rec: SpeechRecognitionLike | undefined;
  let cancelled = false;
  let stopRequested = false;

  /** Sets bias phrases if supported. Returns whether they were applied. */
  function applyPhrases(r: SpeechRecognitionLike): boolean {
    const Phrase = globalThis.SpeechRecognitionPhrase;
    if (!opts.phrases?.length || !Phrase || !("phrases" in r)) return false;
    try {
      r.phrases = opts.phrases.map((p) => new Phrase(p.phrase, p.boost));
      return true;
    } catch {
      return false; // e.g. a boost out of range: just listen without biasing
    }
  }

  async function attempt(usePhrases: boolean): Promise<Transcript> {
    const SR = recognizerCtor();
    if (!SR) throw new OnDeviceUnavailableError("speech", "api-missing");
    const r = new SR();

    // Fail closed: without processLocally we can't guarantee audio stays here.
    if (!("processLocally" in r)) throw new OnDeviceUnavailableError("speech", "api-missing");
    r.processLocally = true;
    if (r.processLocally !== true) throw new OnDeviceUnavailableError("speech", "api-missing");

    r.lang = ON_DEVICE_LANG;
    r.continuous = false; // one question, then stop on silence
    r.interimResults = true;
    r.maxAlternatives = 1;
    if (usePhrases) applyPhrases(r);

    if (cancelled || stopRequested) throw new ListenError("aborted");
    rec = r;

    return new Promise<Transcript>((resolve, reject) => {
      let finalText = "";
      let interimText = "";
      let failure: Error | undefined;
      const timer = setTimeout(() => r.stop(), opts.maxMs ?? DEFAULT_MAX_MS);

      r.onresult = (e) => {
        interimText = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          const text = res?.[0]?.transcript ?? "";
          if (res?.isFinal) finalText += text;
          else interimText += text;
        }
        opts.onInterim?.(`${finalText}${interimText}`.trim());
      };

      r.onerror = (e) => {
        failure = mapError(e.error);
      };

      r.onend = () => {
        clearTimeout(timer);
        if (cancelled) return reject(new ListenError("aborted"));
        if (failure && !(failure instanceof ListenError && failure.kind === "aborted" && stopRequested)) {
          return reject(failure);
        }
        // If the user pressed stop mid-sentence, keep the words heard so far.
        const text = (finalText || interimText).trim();
        if (!text) return reject(new ListenError("no-speech"));
        resolve({ text, where: ROUTING_POLICY.transcribe.where });
      };

      r.start();
    });
  }

  const result = (async (): Promise<Transcript> => {
    await assertLocalSpeechReady(opts.sim ?? readSimulation());
    try {
      return await attempt(true);
    } catch (e) {
      // Biasing must never cost Meera a check: if the recogniser rejected the
      // phrases, listen again without them.
      if (e instanceof PhrasesRejected) return attempt(false);
      throw e;
    }
  })();

  return {
    result,
    stop() {
      stopRequested = true;
      rec?.stop();
    },
    cancel() {
      cancelled = true;
      rec?.abort();
    },
  };
}
