/**
 * Minimal ambient types for the browser on-device AI surfaces PillCheck probes.
 * Only the members we actually call are declared; the full shapes live in the
 * Chrome Prompt API docs and the Web Speech API spec.
 */

declare global {
  type OnDeviceAvailability = "unavailable" | "downloadable" | "downloading" | "available";

  interface LanguageModelExpectedIO {
    type: "text" | "image" | "audio";
    languages?: string[];
  }

  interface LanguageModelCreateOptionsLite {
    expectedInputs?: LanguageModelExpectedIO[];
    expectedOutputs?: LanguageModelExpectedIO[];
    monitor?(m: EventTarget): void;
  }

  interface LanguageModelStatic {
    availability(options?: LanguageModelCreateOptionsLite): Promise<OnDeviceAvailability>;
    create(options?: LanguageModelCreateOptionsLite): Promise<{ destroy(): void }>;
  }

  interface SpeechRecognitionOptions {
    langs: string[];
    /** true = recognise on this device only (Chrome's SODA engine). */
    processLocally?: boolean;
  }

  interface SpeechRecognitionAlternativeLike {
    readonly transcript: string;
    readonly confidence: number;
  }

  interface SpeechRecognitionResultLike {
    readonly isFinal: boolean;
    readonly length: number;
    readonly [index: number]: SpeechRecognitionAlternativeLike;
  }

  interface SpeechRecognitionEventLike {
    readonly resultIndex: number;
    readonly results: { readonly length: number; readonly [index: number]: SpeechRecognitionResultLike };
  }

  interface SpeechRecognitionPhraseLike {
    readonly phrase: string;
    readonly boost: number;
  }

  // eslint-disable-next-line no-var
  var SpeechRecognitionPhrase: (new (phrase: string, boost?: number) => SpeechRecognitionPhraseLike) | undefined;

  interface SpeechRecognitionErrorEventLike {
    readonly error: string;
    readonly message?: string;
  }

  /** The members PillCheck uses on a SpeechRecognition instance. */
  interface SpeechRecognitionLike {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    maxAlternatives: number;
    /** Chrome: true = recognise on-device only. Absent on browsers that can't. */
    processLocally?: boolean;
    /** Contextual biasing (Chrome 15x+): phrases the recogniser should expect. */
    phrases?: SpeechRecognitionPhraseLike[];
    onresult: ((e: SpeechRecognitionEventLike) => void) | null;
    onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
    onend: (() => void) | null;
    start(): void;
    stop(): void;
    abort(): void;
  }

  interface SpeechRecognitionStatic {
    new (): SpeechRecognitionLike;
    /** Present in Chrome builds that support on-device recognition. */
    available?(options: SpeechRecognitionOptions): Promise<OnDeviceAvailability>;
    install?(options: SpeechRecognitionOptions): Promise<boolean>;
  }

  // eslint-disable-next-line no-var
  var LanguageModel: LanguageModelStatic | undefined;
  // eslint-disable-next-line no-var
  var SpeechRecognition: SpeechRecognitionStatic | undefined;
  // eslint-disable-next-line no-var
  var webkitSpeechRecognition: SpeechRecognitionStatic | undefined;
  // eslint-disable-next-line no-var
  var FIREBASE_APPCHECK_DEBUG_TOKEN: boolean | string | undefined;
}

export {};
