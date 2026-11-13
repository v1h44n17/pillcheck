import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OnDeviceUnavailableError } from "../src/guards/onDeviceGuard";
import { ListenError, listenOnce } from "../src/pipeline/step1-transcribe";

/** A scriptable stand-in for Chrome's SpeechRecognition. */
class FakeRecognition implements SpeechRecognitionLike {
  static last: FakeRecognition | undefined;
  lang = "";
  continuous = true;
  interimResults = false;
  maxAlternatives = 5;
  processLocally = false;
  onresult: SpeechRecognitionLike["onresult"] = null;
  onerror: SpeechRecognitionLike["onerror"] = null;
  onend: SpeechRecognitionLike["onend"] = null;
  started = false;

  constructor() {
    FakeRecognition.last = this;
  }
  start() {
    this.started = true;
  }
  stop() {
    queueMicrotask(() => this.onend?.());
  }
  abort() {
    queueMicrotask(() => {
      this.onerror?.({ error: "aborted" });
      this.onend?.();
    });
  }

  // --- test helpers ---
  say(text: string, isFinal: boolean) {
    const result = Object.assign([{ transcript: text, confidence: 0.9 }], { isFinal });
    this.onresult?.({ resultIndex: 0, results: [result] });
  }
  fail(code: string) {
    this.onerror?.({ error: code });
    this.onend?.();
  }
  end() {
    this.onend?.();
  }
}

/** A browser that offers Web Speech but has no on-device mode at all. */
class ServerOnlyRecognition {
  lang = "";
  continuous = true;
  interimResults = false;
  maxAlternatives = 1;
  onresult = null;
  onerror = null;
  onend = null;
  start = vi.fn();
  stop() {}
  abort() {}
}

/** A browser that has the property but silently ignores attempts to set it. */
class IgnoresProcessLocally extends FakeRecognition {
  constructor() {
    super();
    Object.defineProperty(this, "processLocally", {
      get: () => false,
      set: () => {},
      configurable: true,
    });
  }
}

function installRecognizer(ctor: unknown, availability: OnDeviceAvailability = "available") {
  const SR = ctor as SpeechRecognitionStatic;
  SR.available = vi.fn(async () => availability);
  vi.stubGlobal("SpeechRecognition", SR);
}

/** Lets the guard's async checks finish so the recogniser exists. */
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  FakeRecognition.last = undefined;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Step 1: listenOnce (on-device speech)", () => {
  it("configures on-device recognition and returns the final transcript", async () => {
    installRecognizer(FakeRecognition);
    const interim: string[] = [];
    const h = listenOnce({ onInterim: (t) => interim.push(t) });
    await flush();

    const rec = FakeRecognition.last!;
    expect(rec.processLocally).toBe(true);
    expect(rec.lang).toBe("en-US");
    expect(rec.continuous).toBe(false);
    expect(rec.interimResults).toBe(true);
    expect(rec.started).toBe(true);

    rec.say("can I take ibu", false);
    rec.say("Can I take ibuprofen?", true);
    rec.end();

    await expect(h.result).resolves.toEqual({ text: "Can I take ibuprofen?", where: "on-device" });
    expect(interim).toEqual(["can I take ibu", "Can I take ibuprofen?"]);
  });

  it("REFUSES on a browser without processLocally and never opens the mic", async () => {
    installRecognizer(ServerOnlyRecognition);
    const h = listenOnce();
    await expect(h.result).rejects.toBeInstanceOf(OnDeviceUnavailableError);
  });

  it("REFUSES if the browser ignores processLocally = true", async () => {
    installRecognizer(IgnoresProcessLocally);
    const h = listenOnce();
    await expect(h.result).rejects.toBeInstanceOf(OnDeviceUnavailableError);
    expect(FakeRecognition.last?.started).toBe(false);
  });

  it("REFUSES before creating a recogniser if the language pack isn't installed", async () => {
    installRecognizer(FakeRecognition, "downloadable");
    const h = listenOnce();
    await expect(h.result).rejects.toMatchObject({ capability: "speech", detail: "downloadable" });
    expect(FakeRecognition.last).toBeUndefined();
  });

  it("treats a network error as a privacy failure, not a retryable glitch", async () => {
    installRecognizer(FakeRecognition);
    const h = listenOnce();
    await flush();
    FakeRecognition.last!.fail("network");
    await expect(h.result).rejects.toBeInstanceOf(OnDeviceUnavailableError);
  });

  it.each([
    ["no-speech", "no-speech"],
    ["not-allowed", "mic-denied"],
    ["audio-capture", "no-mic"],
    ["bad-grammar", "failed"],
  ] as const)("maps recogniser error %s → ListenError(%s)", async (code, kind) => {
    installRecognizer(FakeRecognition);
    const h = listenOnce();
    await flush();
    FakeRecognition.last!.fail(code);
    await expect(h.result).rejects.toMatchObject({ name: "ListenError", kind });
  });

  it("silence with no words → no-speech", async () => {
    installRecognizer(FakeRecognition);
    const h = listenOnce();
    await flush();
    FakeRecognition.last!.end();
    await expect(h.result).rejects.toMatchObject({ kind: "no-speech" });
  });

  it("stop() keeps the words heard so far", async () => {
    installRecognizer(FakeRecognition);
    const h = listenOnce();
    await flush();
    FakeRecognition.last!.say("is warfarin okay", false);
    h.stop();
    await expect(h.result).resolves.toMatchObject({ text: "is warfarin okay" });
  });

  it("cancel() discards everything", async () => {
    installRecognizer(FakeRecognition);
    const h = listenOnce();
    await flush();
    FakeRecognition.last!.say("is warfarin okay", false);
    h.cancel();
    const err = await h.result.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ListenError);
    expect(err).toMatchObject({ kind: "aborted" });
  });

  it("closes the mic after maxMs even if the user keeps talking", async () => {
    vi.useFakeTimers();
    try {
      installRecognizer(FakeRecognition);
      const h = listenOnce({ maxMs: 1000 });
      await vi.advanceTimersByTimeAsync(0);
      FakeRecognition.last!.say("and another thing", false);
      await vi.advanceTimersByTimeAsync(1000);
      await expect(h.result).resolves.toMatchObject({ text: "and another thing" });
    } finally {
      vi.useRealTimers();
    }
  });
});
