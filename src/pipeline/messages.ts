import { PII_KINDS, type Finding } from "../guards/leakGuard";
import type { ListenErrorKind } from "./step1-transcribe";

/**
 * Everything PillCheck says out loud (besides the answer itself).
 * Short, plain, and each one tells Meera what to do next.
 */

export type CheckErrorKind =
  | ListenErrorKind
  | "no-medicine"
  | "not-understood"
  | "check-unavailable"
  | "check-failed";

export const CHECK_ERROR_MESSAGE: Record<CheckErrorKind, string> = {
  "no-speech": "I didn't hear anything. Press the button and say the name of your medicine.",
  "mic-denied": "I need to use the microphone. Please allow it, then press the button again.",
  "no-mic": "I can't find a microphone. Please check it's plugged in, then press the button again.",
  aborted: "",
  failed: "Something went wrong while listening. Please press the button and try again.",
  "no-medicine": "I didn't catch the name of a medicine. Press the button and say the medicine's name.",
  "not-understood": "Sorry, I didn't understand that. Press the button and try again.",
  "check-unavailable": "I couldn't check right now. Please try again in a minute, or ask your pharmacist.",
  "check-failed": "I couldn't get a clear answer. Please ask your pharmacist before taking it.",
};

export const REFUSAL_SPOKEN =
  "I can't check safely on this device. I won't send your question anywhere. " +
  "If you're unsure about a medicine, please call your pharmacist.";

/** What PillCheck says when the leak guard blocks. */
export function blockedSpokenMessage(findings: Finding[]): string {
  if (findings.some((f) => PII_KINDS.has(f.kind))) {
    return "I stopped before checking, because something personal was about to be sent. Nothing left this device.";
  }
  const unknown = findings.find((f) => f.kind === "unknown-term");
  if (unknown) {
    return `I don't know a medicine called ${unknown.value}. Please check the name and try again.`;
  }
  return "I stopped before checking, because something about the question didn't look right. Nothing left this device.";
}
