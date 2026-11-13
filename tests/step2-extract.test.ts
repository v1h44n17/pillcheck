import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteApp, initializeApp } from "firebase/app";
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } from "firebase/ai";
import {
  OnDeviceUnavailableError,
  RoutingViolationError,
  type Simulation,
} from "../src/guards/onDeviceGuard";
import {
  EXTRACTION_PARAMS,
  EXTRACTION_SCHEMA,
  ExtractionError,
  extractMedicines,
  parseExtraction,
  sanitiseNames,
} from "../src/pipeline/step2-extract";

type ModelArg = NonNullable<NonNullable<Parameters<typeof extractMedicines>[1]>["model"]>;

const NONE: Simulation = { noNano: false, noSpeech: false };
const TRANSCRIPT = "This is Meera, born March 3rd, can I take two Advil with my warfarin?";

function fakeModel(text: string, inferenceSource = "on_device") {
  const generateContent = vi.fn(async () => ({ response: { inferenceSource, text: () => text } }));
  return { generateContent, model: { generateContent } as unknown as ModelArg };
}

function stubNanoAvailable() {
  vi.stubGlobal("LanguageModel", { availability: vi.fn(async () => "available"), create: vi.fn() });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Step 2 routing configuration", () => {
  it("is pinned to ONLY_ON_DEVICE with instructions where the on-device path reads them", () => {
    expect(EXTRACTION_PARAMS.mode).toBe(InferenceMode.ONLY_ON_DEVICE);
    const prompts = EXTRACTION_PARAMS.onDeviceParams?.createOptions?.initialPrompts ?? [];
    expect(prompts[0]?.role).toBe("system");
    expect(EXTRACTION_PARAMS.onDeviceParams?.promptOptions?.responseConstraint).toBe(EXTRACTION_SCHEMA);
  });
});

describe("extractMedicines", () => {
  it("REFUSES before calling the SDK when Nano is missing: the transcript is never handed over", async () => {
    vi.stubGlobal("LanguageModel", undefined);
    const { model, generateContent } = fakeModel('{"medicines":["advil"]}');
    await expect(extractMedicines(TRANSCRIPT, { model, sim: NONE })).rejects.toBeInstanceOf(
      OnDeviceUnavailableError,
    );
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("refuses under ?simulate=no-nano even on a capable device", async () => {
    stubNanoAvailable();
    const { model, generateContent } = fakeModel('{"medicines":["advil"]}');
    await expect(
      extractMedicines(TRANSCRIPT, { model, sim: { noNano: true, noSpeech: false } }),
    ).rejects.toBeInstanceOf(OnDeviceUnavailableError);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("returns cleaned medicine names when Nano answers on-device", async () => {
    stubNanoAvailable();
    const { model, generateContent } = fakeModel('{"medicines":["Advil","  warfarin ","advil"]}');
    await expect(extractMedicines(TRANSCRIPT, { model, sim: NONE })).resolves.toEqual({
      medicines: ["advil", "warfarin"],
      where: "on-device",
      inferenceSource: "on_device",
    });
    expect(generateContent).toHaveBeenCalledWith(TRANSCRIPT);
  });

  it("throws RoutingViolationError if the SDK reports the call ran in the cloud", async () => {
    stubNanoAvailable();
    const { model } = fakeModel('{"medicines":["advil"]}', "in_cloud");
    await expect(extractMedicines(TRANSCRIPT, { model, sim: NONE })).rejects.toBeInstanceOf(
      RoutingViolationError,
    );
  });
});

describe("parseExtraction / sanitiseNames", () => {
  it("rejects non-JSON and wrong shapes", () => {
    expect(() => parseExtraction("advil, warfarin")).toThrow(ExtractionError);
    expect(() => parseExtraction('{"drugs":["advil"]}')).toThrow(ExtractionError);
    expect(() => parseExtraction("null")).toThrow(ExtractionError);
  });

  it("drops anything that isn't shaped like a medicine name", () => {
    expect(
      sanitiseNames([
        "aspirin",
        "Meera Sharma 03/03/1951", // digits and slashes
        "meera@example.com",
        "+1 555 0100",
        "200mg",
        42,
        null,
        "a".repeat(41),
        "St John's wort", // apostrophe: dropped here; the Day 5 lexicon handles real brand spellings
        "co-codamol",
        "vitamin d",
      ]),
    ).toEqual(["aspirin", "co-codamol", "vitamin d"]);
  });

  it("caps the list at 5", () => {
    expect(sanitiseNames(["a-a", "b-b", "c-c", "d-d", "e-e", "f-f"])).toHaveLength(5);
  });

  it("allows an empty answer (no medicine mentioned)", () => {
    expect(parseExtraction('{"medicines":[]}')).toEqual([]);
  });
});

describe("real Firebase AI Logic SDK → fake Chrome Prompt API", () => {
  it("sends our system prompt and JSON schema to Nano and makes no network request", async () => {
    const prompt = vi.fn(async (_messages: unknown, _options: unknown) => '{"medicines":["advil","warfarin"]}');
    const create = vi.fn(async (_options: unknown) => ({ prompt, destroy: vi.fn() }));
    vi.stubGlobal("LanguageModel", { availability: vi.fn(async () => "available"), create });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const app = initializeApp(
      { apiKey: "test", projectId: "pillcheck-test", appId: "1:0:web:0" },
      `step2-${Date.now()}`,
    );
    try {
      const model = getGenerativeModel(getAI(app, { backend: new GoogleAIBackend() }), EXTRACTION_PARAMS);
      const result = await extractMedicines(TRANSCRIPT, { model, sim: NONE });

      expect(result).toMatchObject({ medicines: ["advil", "warfarin"], inferenceSource: "on_device" });
      expect(fetchSpy).not.toHaveBeenCalled();

      const createOptions = create.mock.calls.at(-1)?.[0] as unknown as {
        initialPrompts: Array<{ role: string }>;
      };
      expect(createOptions.initialPrompts[0]?.role).toBe("system");

      const [messages, promptOptions] = prompt.mock.calls[0] as unknown as [
        Array<{ role: string; content: Array<{ value: string }> }>,
        { responseConstraint: unknown },
      ];
      expect(messages[0]?.content[0]?.value).toBe(TRANSCRIPT);
      expect(promptOptions.responseConstraint).toBe(EXTRACTION_SCHEMA);
    } finally {
      await deleteApp(app);
    }
  });
});
