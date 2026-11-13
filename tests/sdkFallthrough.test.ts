/**
 * EVIDENCE TEST: why PillCheck has its own on-device guard.
 *
 * With firebase@13.3.0 (@firebase/ai@3.1.0), a model created with
 * InferenceMode.ONLY_ON_DEVICE sends the request to the CLOUD whenever
 * `globalThis.LanguageModel` doesn't exist (Gemini Nano flag off, other
 * browsers, etc.). This test calls the real SDK with a stubbed `fetch` and
 * shows that happening, then shows PillCheck's guard stopping the request
 * before it reaches the SDK.
 *
 * If a future SDK version fixes this, the first test will fail. That's
 * intended: re-check the behaviour, then update this test and the README.
 *
 * vitest.config.ts aliases firebase/ai to its BROWSER build: the Node build has
 * no on-device adapter at all, so it would "prove" this trivially. The control
 * test below (Nano present → stays on-device) confirms the browser build is the
 * one under test.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteApp, initializeApp } from "firebase/app";
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } from "firebase/ai";
import { assertNanoReady, OnDeviceUnavailableError } from "../src/guards/onDeviceGuard";

const FAKE_CONFIG = {
  apiKey: "test-api-key",
  projectId: "pillcheck-test",
  appId: "1:000000000000:web:0000000000000000",
};

const PRIVATE_TRANSCRIPT = "It's Meera. Can I take ibuprofen with my warfarin?";

function cloudResponse() {
  return new Response(
    JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "ibuprofen, warfarin" }] }, index: 0 }] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Firebase AI Logic SDK, ONLY_ON_DEVICE without a LanguageModel", () => {
  it("sends the private prompt to the cloud anyway (documented SDK behaviour)", async () => {
    vi.stubGlobal("LanguageModel", undefined);
    const fetchSpy = vi.fn(async () => cloudResponse());
    vi.stubGlobal("fetch", fetchSpy);

    const app = initializeApp(FAKE_CONFIG, `fallthrough-${Date.now()}`);
    try {
      const ai = getAI(app, { backend: new GoogleAIBackend() });
      const model = getGenerativeModel(ai, { mode: InferenceMode.ONLY_ON_DEVICE });

      const result = await model.generateContent(PRIVATE_TRANSCRIPT);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toMatch(/^https:\/\/firebasevertexai\.googleapis\.com\//);
      expect(String(init.body)).toContain("Meera"); // the private transcript left the device
      expect(result.response.inferenceSource).toBe("in_cloud");
    } finally {
      await deleteApp(app);
    }
  });

  it("control: with Gemini Nano present, the same call stays on-device (proves this is the browser build)", async () => {
    const prompt = vi.fn(async () => "ibuprofen");
    vi.stubGlobal("LanguageModel", {
      availability: vi.fn(async () => "available"),
      create: vi.fn(async () => ({ prompt, destroy: vi.fn() })),
    });
    const fetchSpy = vi.fn(async () => cloudResponse());
    vi.stubGlobal("fetch", fetchSpy);

    const app = initializeApp(FAKE_CONFIG, `control-${Date.now()}`);
    try {
      const ai = getAI(app, { backend: new GoogleAIBackend() });
      const model = getGenerativeModel(ai, { mode: InferenceMode.ONLY_ON_DEVICE });
      const result = await model.generateContent(PRIVATE_TRANSCRIPT);

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(prompt).toHaveBeenCalledTimes(1);
      expect(result.response.inferenceSource).toBe("on_device");
    } finally {
      await deleteApp(app);
    }
  });

  it("PillCheck's guard refuses BEFORE the SDK is called, so nothing is sent", async () => {
    vi.stubGlobal("LanguageModel", undefined);
    const fetchSpy = vi.fn(async () => cloudResponse());
    vi.stubGlobal("fetch", fetchSpy);

    // What Step 2 will do: guard first, SDK second.
    const step2 = async () => {
      await assertNanoReady({ noNano: false, noSpeech: false });
      throw new Error("unreachable: SDK would be called here");
    };

    await expect(step2()).rejects.toBeInstanceOf(OnDeviceUnavailableError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
