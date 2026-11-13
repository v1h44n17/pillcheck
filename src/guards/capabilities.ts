/**
 * Read-only probe of the on-device capabilities PillCheck depends on.
 *
 * Day 1: report only. Day 2 turns this into the fail-closed onDeviceGuard.
 *
 * WHY THIS EXISTS (verified in firebase@13.3.0 / @firebase/ai@3.1.0 source):
 * the SDK only creates its on-device adapter when `globalThis.LanguageModel`
 * exists. If it doesn't (flag off, unsupported browser), the adapter is
 * undefined, and `callCloudOrDevice()` sends the request to the CLOUD even when
 * the model was created with InferenceMode.ONLY_ON_DEVICE. So we must check for
 * the on-device model ourselves BEFORE any private data reaches the SDK.
 */
export type Availability = OnDeviceAvailability | "api-missing" | "error";

export interface DeviceCapabilities {
  /** Gemini Nano via Chrome's Prompt API (used by Firebase AI Logic on-device). */
  nano: Availability;
  /** Chrome on-device speech recognition (processLocally). */
  localSpeech: Availability;
  /** Text-to-speech voices that run locally (no network needed). */
  localVoices: number;
}

export async function probeCapabilities(lang = "en-US"): Promise<DeviceCapabilities> {
  const [nano, localSpeech, localVoices] = await Promise.all([
    probeNano(),
    probeLocalSpeech(lang),
    countLocalVoices(),
  ]);
  return { nano, localSpeech, localVoices };
}

async function probeNano(): Promise<Availability> {
  const lm = globalThis.LanguageModel;
  if (!lm) return "api-missing";
  try {
    return await lm.availability();
  } catch {
    return "error";
  }
}

async function probeLocalSpeech(lang: string): Promise<Availability> {
  const SR = globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition;
  if (!SR?.available) return "api-missing";
  try {
    return await SR.available({ langs: [lang], processLocally: true });
  } catch {
    return "error";
  }
}

/** Chrome loads voices asynchronously; wait briefly for `voiceschanged`. */
function countLocalVoices(): Promise<number> {
  if (!("speechSynthesis" in globalThis)) return Promise.resolve(0);
  const count = () => speechSynthesis.getVoices().filter((v) => v.localService).length;
  if (speechSynthesis.getVoices().length > 0) return Promise.resolve(count());
  return new Promise((resolve) => {
    const done = () => resolve(count());
    speechSynthesis.addEventListener("voiceschanged", done, { once: true });
    setTimeout(done, 1500);
  });
}
