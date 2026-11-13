import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertLocalSpeechReady,
  assertNanoReady,
  assertRanOnDevice,
  checkLocalSpeech,
  checkNano,
  checkReadiness,
  OnDeviceUnavailableError,
  readSimulation,
  RoutingViolationError,
  type Simulation,
} from "../src/guards/onDeviceGuard";

const NONE: Simulation = { noNano: false, noSpeech: false };

function stubNano(availability: OnDeviceAvailability | Error) {
  const lm = {
    availability: vi.fn(async () => {
      if (availability instanceof Error) throw availability;
      return availability;
    }),
    create: vi.fn(),
  };
  vi.stubGlobal("LanguageModel", lm);
  return lm;
}

function stubSpeech(availability: OnDeviceAvailability | "no-available-method", prefixed = false) {
  const SR = function () {} as unknown as SpeechRecognitionStatic;
  if (availability !== "no-available-method") {
    SR.available = vi.fn(async () => availability);
  }
  vi.stubGlobal(prefixed ? "webkitSpeechRecognition" : "SpeechRecognition", SR);
  return SR;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readSimulation", () => {
  it("is off by default", () => {
    expect(readSimulation("")).toEqual({ noNano: false, noSpeech: false });
  });
  it("parses single, comma-separated and repeated flags", () => {
    expect(readSimulation("?simulate=no-nano")).toEqual({ noNano: true, noSpeech: false });
    expect(readSimulation("?simulate=no-nano,no-speech")).toEqual({ noNano: true, noSpeech: true });
    expect(readSimulation("?simulate=no-speech&simulate=no-nano")).toEqual({ noNano: true, noSpeech: true });
  });
  it("ignores unknown flags (a simulation can only remove capabilities)", () => {
    expect(readSimulation("?simulate=force-cloud,yes-nano")).toEqual({ noNano: false, noSpeech: false });
  });
});

describe("checkNano", () => {
  it("REFUSES when LanguageModel is missing: the exact case where the SDK falls through to cloud", async () => {
    vi.stubGlobal("LanguageModel", undefined);
    expect(await checkNano(NONE)).toEqual({ capability: "nano", state: "unsupported", detail: "api-missing" });
  });

  it.each([
    ["available", "ready"],
    ["downloadable", "needs-setup"],
    ["downloading", "needs-setup"],
    ["unavailable", "unsupported"],
  ] as const)("maps availability %s → %s", async (availability, state) => {
    stubNano(availability);
    expect((await checkNano(NONE)).state).toBe(state);
  });

  it("treats a throwing availability() as unsupported (fail closed)", async () => {
    stubNano(new Error("boom"));
    expect(await checkNano(NONE)).toMatchObject({ state: "unsupported", detail: "error" });
  });

  it("checks with the same session options Step 2 will use", async () => {
    const lm = stubNano("available");
    await checkNano(NONE);
    expect(lm.availability).toHaveBeenCalledWith(
      expect.objectContaining({ expectedInputs: [{ type: "text", languages: ["en"] }] }),
    );
  });

  it("simulation overrides a working device and never touches the API", async () => {
    const lm = stubNano("available");
    expect(await checkNano({ noNano: true, noSpeech: false })).toMatchObject({
      state: "unsupported",
      detail: "simulated",
    });
    expect(lm.availability).not.toHaveBeenCalled();
  });
});

describe("checkLocalSpeech", () => {
  it("REFUSES when the browser can't promise on-device recognition", async () => {
    vi.stubGlobal("SpeechRecognition", undefined);
    vi.stubGlobal("webkitSpeechRecognition", undefined);
    expect((await checkLocalSpeech(NONE)).detail).toBe("api-missing");

    // Plain Web Speech with no `available()`: in Chrome that streams audio to a server.
    stubSpeech("no-available-method");
    expect(await checkLocalSpeech(NONE)).toMatchObject({ state: "unsupported", detail: "api-missing" });
  });

  it("asks for processLocally: true", async () => {
    const SR = stubSpeech("available");
    expect((await checkLocalSpeech(NONE)).state).toBe("ready");
    expect(SR.available).toHaveBeenCalledWith({ langs: ["en-US"], processLocally: true });
  });

  it("falls back to the webkit-prefixed constructor", async () => {
    vi.stubGlobal("SpeechRecognition", undefined);
    stubSpeech("downloadable", true);
    expect((await checkLocalSpeech(NONE)).state).toBe("needs-setup");
  });
});

describe("checkReadiness", () => {
  it("is ready only when both capabilities are ready", async () => {
    stubNano("available");
    stubSpeech("available");
    expect((await checkReadiness(NONE)).overall).toBe("ready");
  });
  it("needs setup if anything is downloadable and nothing is unsupported", async () => {
    stubNano("available");
    stubSpeech("downloadable");
    expect((await checkReadiness(NONE)).overall).toBe("needs-setup");
  });
  it("unsupported wins over everything", async () => {
    stubNano("downloadable");
    stubSpeech("available");
    expect((await checkReadiness({ noNano: false, noSpeech: true })).overall).toBe("unsupported");
  });
});

describe("assertions", () => {
  it("assertNanoReady throws OnDeviceUnavailableError unless ready", async () => {
    vi.stubGlobal("LanguageModel", undefined);
    await expect(assertNanoReady(NONE)).rejects.toBeInstanceOf(OnDeviceUnavailableError);
    stubNano("downloadable"); // not downloaded yet = not usable yet
    await expect(assertNanoReady(NONE)).rejects.toMatchObject({ capability: "nano", detail: "downloadable" });
    stubNano("available");
    await expect(assertNanoReady(NONE)).resolves.toBeUndefined();
  });

  it("assertLocalSpeechReady throws unless ready", async () => {
    stubSpeech("unavailable");
    await expect(assertLocalSpeechReady(NONE)).rejects.toMatchObject({ capability: "speech" });
  });

  it("assertRanOnDevice accepts only the SDK's ON_DEVICE value", () => {
    expect(() => assertRanOnDevice("on_device")).not.toThrow();
    expect(() => assertRanOnDevice("in_cloud")).toThrow(RoutingViolationError);
    expect(() => assertRanOnDevice(undefined)).toThrow(RoutingViolationError);
    // The docs print "ON_DEVICE" (the constant's key), but the runtime value is lowercase.
    expect(() => assertRanOnDevice("ON_DEVICE")).toThrow(RoutingViolationError);
  });
});
