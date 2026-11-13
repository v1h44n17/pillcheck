/**
 * STEP 4: speak an answer aloud, ON-DEVICE ONLY.
 *
 * Routing decision: we only use voices with `localService === true`. Chrome's
 * "Google …" voices are network voices: the text is sent to a server to be
 * synthesised. Local voices also keep working offline once an answer exists.
 *
 * Chrome only lets a page speak after a user gesture, so call this from (or
 * after) a click.
 *
 * Day 2: used for the spoken refusal. Day 7 adds queueing, highlighting and replay.
 */
const PREFERRED_LANG = "en-US";

export function pickLocalVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  const local = voices.filter((v) => v.localService);
  return (
    local.find((v) => v.lang === PREFERRED_LANG && v.default) ??
    local.find((v) => v.lang === PREFERRED_LANG) ??
    local.find((v) => v.lang.startsWith("en"))
  );
}

/**
 * Speaks `text` with a local voice. Resolves when finished. Resolves `false`
 * without speaking if there's no local voice; the text stays on screen either way.
 */
export function speakLocally(text: string): Promise<boolean> {
  if (!("speechSynthesis" in globalThis)) return Promise.resolve(false);
  const voice = pickLocalVoice(speechSynthesis.getVoices());
  if (!voice) return Promise.resolve(false);

  speechSynthesis.cancel(); // never talk over ourselves
  const u = new SpeechSynthesisUtterance(text);
  u.voice = voice;
  u.lang = voice.lang;
  u.rate = 0.9; // a little slower than default: easier to follow
  return new Promise((resolve) => {
    u.onend = () => resolve(true);
    u.onerror = () => resolve(false);
    speechSynthesis.speak(u);
  });
}
