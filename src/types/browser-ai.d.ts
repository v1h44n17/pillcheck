/**
 * Minimal ambient types for the browser on-device AI surfaces PillCheck probes.
 * Only the members we actually call are declared; the full shapes live in the
 * Chrome Prompt API docs and the Web Speech API spec.
 */

declare global {
  type OnDeviceAvailability = "unavailable" | "downloadable" | "downloading" | "available";

  interface LanguageModelStatic {
    availability(options?: unknown): Promise<OnDeviceAvailability>;
  }

  interface SpeechRecognitionOptions {
    langs: string[];
    /** true = recognise on this device only (Chrome's SODA engine). */
    processLocally?: boolean;
  }

  interface SpeechRecognitionStatic {
    new (): unknown;
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
