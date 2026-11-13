import { afterEach, describe, expect, it, vi } from "vitest";
import { biasPhrases, COMMON_MEDICINES } from "../src/data/biasPhrases";
import { lookupMedicine } from "../src/data/lexicon";
import { listenOnce } from "../src/pipeline/step1-transcribe";

describe("biasPhrases", () => {
  it("puts her own medicines first, with the strongest boost", () => {
    const p = biasPhrases(["coumadin", "lipitor"]);
    expect(p.slice(0, 2)).toEqual([
      { phrase: "Coumadin", boost: 6 },
      { phrase: "Lipitor", boost: 6 },
    ]);
    // Not repeated later with the weaker boost.
    expect(p.filter((x) => x.phrase === "Coumadin")).toHaveLength(1);
  });

  it("every phrase is a real medicine, every boost is in Chrome's 0–10 range, and the list is capped", () => {
    const p = biasPhrases(["coumadin"]);
    for (const { phrase, boost } of p) {
      expect(lookupMedicine(phrase), phrase).toBeDefined();
      expect(boost).toBeGreaterThan(0);
      expect(boost).toBeLessThanOrEqual(10);
    }
    expect(p.length).toBeLessThanOrEqual(150);
    expect(p.length).toBeGreaterThan(50);
  });

  it("the common list only contains names the lexicon knows", () => {
    expect(COMMON_MEDICINES.filter((m) => !lookupMedicine(m))).toEqual([]);
  });

  it("includes the name that was misheard in production testing", () => {
    expect(biasPhrases().map((x) => x.phrase)).toContain("Advil");
  });
});

/** Minimal scriptable recogniser with a `phrases` property. */
class BiasableRecognition implements SpeechRecognitionLike {
  static instances: BiasableRecognition[] = [];
  static rejectPhrases = false;
  lang = "";
  continuous = true;
  interimResults = false;
  maxAlternatives = 1;
  processLocally = false;
  phrases: SpeechRecognitionPhraseLike[] = [];
  onresult: SpeechRecognitionLike["onresult"] = null;
  onerror: SpeechRecognitionLike["onerror"] = null;
  onend: SpeechRecognitionLike["onend"] = null;
  constructor() {
    BiasableRecognition.instances.push(this);
  }
  start() {
    queueMicrotask(() => {
      if (BiasableRecognition.rejectPhrases && this.phrases.length) {
        this.onerror?.({ error: "phrases-not-supported" });
        this.onend?.();
        return;
      }
      const result = Object.assign([{ transcript: "can I take Advil", confidence: 0.9 }], { isFinal: true });
      this.onresult?.({ resultIndex: 0, results: [result] });
      this.onend?.();
    });
  }
  stop() {}
  abort() {}
}

class Phrase implements SpeechRecognitionPhraseLike {
  constructor(
    readonly phrase: string,
    readonly boost = 1,
  ) {}
}

function install(withPhraseSupport: boolean) {
  BiasableRecognition.instances = [];
  const SR = BiasableRecognition as unknown as SpeechRecognitionStatic;
  SR.available = vi.fn(async () => "available" as const);
  vi.stubGlobal("SpeechRecognition", SR);
  vi.stubGlobal("SpeechRecognitionPhrase", withPhraseSupport ? Phrase : undefined);
}

afterEach(() => {
  vi.unstubAllGlobals();
  BiasableRecognition.rejectPhrases = false;
});

describe("Step 1 with contextual biasing", () => {
  const phrases = [{ phrase: "Advil", boost: 3 }];

  it("hands the phrases to the on-device recogniser", async () => {
    install(true);
    await expect(listenOnce({ phrases }).result).resolves.toMatchObject({ text: "can I take Advil" });
    const r = BiasableRecognition.instances[0]!;
    expect(r.processLocally).toBe(true);
    expect(r.phrases.map((p) => [p.phrase, p.boost])).toEqual([["Advil", 3]]);
  });

  it("still works on browsers without biasing support", async () => {
    install(false);
    await expect(listenOnce({ phrases }).result).resolves.toMatchObject({ text: "can I take Advil" });
    expect(BiasableRecognition.instances[0]!.phrases).toEqual([]);
  });

  it("retries once without phrases if the recogniser rejects them", async () => {
    install(true);
    BiasableRecognition.rejectPhrases = true;
    await expect(listenOnce({ phrases }).result).resolves.toMatchObject({ text: "can I take Advil" });
    expect(BiasableRecognition.instances).toHaveLength(2);
    expect(BiasableRecognition.instances[1]!.phrases).toEqual([]);
    expect(BiasableRecognition.instances[1]!.processLocally).toBe(true); // still on-device
  });
});
