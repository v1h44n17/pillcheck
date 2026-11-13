import { InferenceSource } from "firebase/ai";

/**
 * ON-DEVICE GUARD: fail closed, never fail open.
 *
 * PillCheck's privacy promise is that Meera's voice and words are only
 * processed on her own computer. Two capabilities make that possible:
 *
 *   - "speech": Chrome's on-device speech recognition (Step 1)
 *   - "nano":   Gemini Nano via Firebase AI Logic, ONLY_ON_DEVICE (Step 2)
 *
 * If either is missing, PillCheck REFUSES ("I can't check safely on this
 * device"). It never quietly uses a cloud service instead.
 *
 * Why the SDK's own ONLY_ON_DEVICE mode isn't enough (verified in
 * firebase@13.3.0 / @firebase/ai@3.1.0, and proven in
 * tests/sdkFallthrough.test.ts): the SDK only creates its on-device adapter
 * when `globalThis.LanguageModel` exists. When it doesn't, `callCloudOrDevice()`
 * sends the request to the CLOUD even in ONLY_ON_DEVICE mode. So:
 *
 *   1. BEFORE every on-device call: `assertNanoReady()` / `assertLocalSpeechReady()`.
 *      This is the real protection: private text never reaches the SDK.
 *   2. AFTER every on-device call: `assertRanOnDevice(response.inferenceSource)`.
 *      A second line of defence that catches SDK regressions loudly.
 */

/** Language PillCheck listens and understands in (US English for v1). */
export const ON_DEVICE_LANG = "en-US";

/**
 * The Gemini Nano session shape PillCheck uses. Availability depends on these
 * options, so the guard checks with exactly the options Step 2 will use
 * (passed to the SDK as `onDeviceParams.createOptions`).
 */
export const NANO_CREATE_OPTIONS = {
  expectedInputs: [{ type: "text", languages: ["en"] }],
  expectedOutputs: [{ type: "text", languages: ["en"] }],
} satisfies LanguageModelCreateOptionsLite;

export type Capability = "nano" | "speech";
export type CapabilityState = "ready" | "needs-setup" | "unsupported";
export type CapabilityDetail = OnDeviceAvailability | "api-missing" | "error" | "simulated";

export interface CapabilityReport {
  capability: Capability;
  state: CapabilityState;
  detail: CapabilityDetail;
}

export interface Readiness {
  overall: CapabilityState;
  nano: CapabilityReport;
  speech: CapabilityReport;
  simulation: Simulation;
}

/** Thrown when on-device processing isn't possible. The caller must stop. */
export class OnDeviceUnavailableError extends Error {
  constructor(
    readonly capability: Capability,
    readonly detail: CapabilityDetail,
  ) {
    super(`On-device ${capability} unavailable (${detail}). Refusing to continue.`);
    this.name = "OnDeviceUnavailableError";
  }
}

/** Thrown when a call that had to run on-device reports it ran somewhere else. */
export class RoutingViolationError extends Error {
  constructor(readonly observedSource: unknown) {
    super(`Expected on-device inference but the SDK reported "${String(observedSource)}".`);
    this.name = "RoutingViolationError";
  }
}

// ---------------------------------------------------------------------------
// Simulation (demo + testing)
// ---------------------------------------------------------------------------

export interface Simulation {
  noNano: boolean;
  noSpeech: boolean;
}

/**
 * `?simulate=no-nano`, `?simulate=no-speech`, or `?simulate=no-nano,no-speech`.
 *
 * Deliberately allowed in production builds: a simulation can only REMOVE
 * capabilities (make PillCheck refuse), never add or bypass one. That makes it
 * safe to use in the live demo on the deployed URL.
 */
export function readSimulation(search: string = globalThis.location?.search ?? ""): Simulation {
  const flags = new URLSearchParams(search)
    .getAll("simulate")
    .flatMap((v) => v.split(","))
    .map((v) => v.trim());
  return { noNano: flags.includes("no-nano"), noSpeech: flags.includes("no-speech") };
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function classify(a: OnDeviceAvailability): CapabilityState {
  if (a === "available") return "ready";
  if (a === "downloadable" || a === "downloading") return "needs-setup";
  return "unsupported";
}

export async function checkNano(sim: Simulation = readSimulation()): Promise<CapabilityReport> {
  const report = (state: CapabilityState, detail: CapabilityDetail): CapabilityReport => ({
    capability: "nano",
    state,
    detail,
  });
  if (sim.noNano) return report("unsupported", "simulated");

  // The exact condition under which the SDK silently falls through to the cloud.
  const lm = globalThis.LanguageModel;
  if (!lm) return report("unsupported", "api-missing");

  try {
    const a = await lm.availability(NANO_CREATE_OPTIONS);
    return report(classify(a), a);
  } catch {
    return report("unsupported", "error");
  }
}

function speechRecognitionCtor(): SpeechRecognitionStatic | undefined {
  return globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition;
}

export async function checkLocalSpeech(sim: Simulation = readSimulation()): Promise<CapabilityReport> {
  const report = (state: CapabilityState, detail: CapabilityDetail): CapabilityReport => ({
    capability: "speech",
    state,
    detail,
  });
  if (sim.noSpeech) return report("unsupported", "simulated");

  // Without `available()`, this browser can't promise on-device recognition, and
  // plain Web Speech in Chrome streams audio to a server. That's a refusal.
  const SR = speechRecognitionCtor();
  if (!SR?.available) return report("unsupported", "api-missing");

  try {
    const a = await SR.available({ langs: [ON_DEVICE_LANG], processLocally: true });
    return report(classify(a), a);
  } catch {
    return report("unsupported", "error");
  }
}

export async function checkReadiness(sim: Simulation = readSimulation()): Promise<Readiness> {
  const [nano, speech] = await Promise.all([checkNano(sim), checkLocalSpeech(sim)]);
  const states = [nano.state, speech.state];
  const overall: CapabilityState = states.includes("unsupported")
    ? "unsupported"
    : states.includes("needs-setup")
      ? "needs-setup"
      : "ready";
  return { overall, nano, speech, simulation: sim };
}

// ---------------------------------------------------------------------------
// Assertions: call these at the point of use, every time.
// ---------------------------------------------------------------------------

export async function assertNanoReady(sim: Simulation = readSimulation()): Promise<void> {
  const r = await checkNano(sim);
  if (r.state !== "ready") throw new OnDeviceUnavailableError("nano", r.detail);
}

export async function assertLocalSpeechReady(sim: Simulation = readSimulation()): Promise<void> {
  const r = await checkLocalSpeech(sim);
  if (r.state !== "ready") throw new OnDeviceUnavailableError("speech", r.detail);
}

/** Post-call check on `result.response.inferenceSource`. */
export function assertRanOnDevice(source: unknown): void {
  if (source !== InferenceSource.ON_DEVICE) throw new RoutingViolationError(source);
}

// ---------------------------------------------------------------------------
// One-time setup (must run inside a click handler: both APIs need a user gesture)
// ---------------------------------------------------------------------------

export interface SetupProgress {
  capability: Capability;
  /** 0..1 when known; undefined while the browser doesn't report progress. */
  fraction?: number;
}

/**
 * Downloads whatever is missing: the speech language pack and/or the Gemini
 * Nano model. Both downloads start synchronously in the click handler, before
 * any await, so the browser still sees the user gesture.
 */
export async function setupOnDevice(
  current: Readiness,
  onProgress: (p: SetupProgress) => void,
): Promise<Readiness> {
  const jobs: Promise<unknown>[] = [];

  if (current.speech.state === "needs-setup") {
    const SR = speechRecognitionCtor();
    if (SR?.install) {
      onProgress({ capability: "speech" });
      jobs.push(
        SR.install({ langs: [ON_DEVICE_LANG], processLocally: true }).then((ok) => {
          if (!ok) throw new OnDeviceUnavailableError("speech", "error");
          onProgress({ capability: "speech", fraction: 1 });
        }),
      );
    }
  }

  if (current.nano.state === "needs-setup" && globalThis.LanguageModel) {
    onProgress({ capability: "nano", fraction: 0 });
    jobs.push(
      globalThis.LanguageModel.create({
        ...NANO_CREATE_OPTIONS,
        monitor(m) {
          m.addEventListener("downloadprogress", (e) => {
            onProgress({ capability: "nano", fraction: (e as ProgressEvent).loaded });
          });
        },
      }).then((session) => {
        // We only wanted the download; Step 2 creates its own session via the SDK.
        session.destroy();
        onProgress({ capability: "nano", fraction: 1 });
      }),
    );
  }

  await Promise.all(jobs);
  return checkReadiness(current.simulation);
}

// ---------------------------------------------------------------------------
// Informational (not a gate): local text-to-speech voices for Step 4.
// ---------------------------------------------------------------------------

/** Chrome loads voices asynchronously; wait briefly for `voiceschanged`. */
export function countLocalVoices(): Promise<number> {
  if (!("speechSynthesis" in globalThis)) return Promise.resolve(0);
  const count = () => speechSynthesis.getVoices().filter((v) => v.localService).length;
  if (speechSynthesis.getVoices().length > 0) return Promise.resolve(count());
  return new Promise((resolve) => {
    const done = () => resolve(count());
    speechSynthesis.addEventListener("voiceschanged", done, { once: true });
    setTimeout(done, 1500);
  });
}
