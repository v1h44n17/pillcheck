import { InferenceMode } from "firebase/ai";

/**
 * PILLCHECK ROUTING POLICY: the single source of truth for where each step runs.
 *
 * This is deliberate, per-step routing, not "try on-device, fall back to cloud".
 * Steps that touch the senior's voice or words are pinned to the device and
 * REFUSE if the device can't do them (see src/guards/onDeviceGuard.ts). Only
 * Step 3 uses the cloud, and only with a sanitised list of drug names that has
 * passed the leak guard (Day 5).
 *
 * The README's routing table describes the same facts; if you change a row
 * here, change it there.
 */
export type Where = "on-device" | "cloud";

export interface StepPolicy {
  /** Human label used in the UI provenance strip. */
  label: string;
  where: Where;
  /** What actually does the work. */
  engine: string;
  /** Firebase AI Logic inference mode, when the step uses Firebase AI Logic. */
  firebaseMode: InferenceMode | null;
  /** If on-device isn't possible: refuse (never silently move the step to the cloud). */
  onUnavailable: "refuse" | "show-text-only" | "retry-later";
  /** Exactly what leaves the device during this step. */
  leavesDevice: string;
}

export const ROUTING_POLICY = {
  transcribe: {
    label: "Heard on this device",
    where: "on-device",
    engine: "Chrome on-device speech recognition (SpeechRecognition.processLocally = true)",
    firebaseMode: null,
    onUnavailable: "refuse",
    leavesDevice: "Nothing. Audio and transcript stay in this browser tab's memory.",
  },
  extract: {
    label: "Understood on this device",
    where: "on-device",
    engine: "Gemini Nano via Firebase AI Logic",
    firebaseMode: InferenceMode.ONLY_ON_DEVICE,
    onUnavailable: "refuse",
    leavesDevice: "Nothing. The transcript goes in, a list of drug names comes out.",
  },
  check: {
    label: "Checked in the cloud",
    where: "cloud",
    engine: "Gemini (cloud) via Firebase AI Logic, behind App Check, grounded in openFDA drug labels",
    firebaseMode: InferenceMode.ONLY_IN_CLOUD,
    onUnavailable: "retry-later",
    leavesDevice:
      "Only canonical ingredient names rebuilt by the leak guard, sent to Gemini and to the public openFDA label API. No audio, transcript, name or other identity.",
  },
  speak: {
    label: "Spoken on this device",
    where: "on-device",
    engine: "speechSynthesis with local voices only (localService = true)",
    firebaseMode: null,
    onUnavailable: "show-text-only",
    leavesDevice: "Nothing. Network voices are never used.",
  },
  audit: {
    label: "Logged",
    where: "cloud",
    engine: "Cloud Firestore (per anonymous user)",
    firebaseMode: null,
    onUnavailable: "retry-later",
    leavesDevice: "Timestamp, drug names, where each step ran, leak-guard result. No audio, transcript or PII.",
  },
} as const satisfies Record<string, StepPolicy>;

export type StepId = keyof typeof ROUTING_POLICY;
