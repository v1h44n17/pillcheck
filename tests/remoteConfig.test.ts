import { describe, expect, it } from "vitest";
import { InferenceMode } from "firebase/ai";
import { DEFAULT_CHECK_MODELS, parseConfig, RC_DEFAULTS } from "../src/firebase/remoteConfig";
import { checkParams } from "../src/pipeline/step3-check";

const defaults = Object.fromEntries(Object.entries(RC_DEFAULTS).map(([k, v]) => [k, String(v)]));

describe("Remote Config: tune, never weaken", () => {
  it("built-in defaults", () => {
    expect(parseConfig(defaults, "defaults")).toMatchObject({
      checkModels: DEFAULT_CHECK_MODELS,
      maxOutputTokens: 1024,
      listenMaxMs: 15_000,
      checksPaused: false,
      source: "defaults",
    });
  });

  it("accepts a valid model list", () => {
    const c = parseConfig({ ...defaults, step3_cloud_models: '["gemini-3.8-flash","gemini-3.5-flash-lite"]' }, "remote");
    expect(c.checkModels).toEqual(["gemini-3.8-flash", "gemini-3.5-flash-lite"]);
  });

  it.each([
    ["a non-Gemini model", '["some-other-llm"]'],
    ["one bad entry among good ones", '["gemini-3.8-flash","http://evil.example"]'],
    ["an empty list", "[]"],
    ["not JSON", "gemini-3.8-flash"],
    ["not a list", '{"model":"gemini-3.8-flash"}'],
  ])("rejects %s and keeps the defaults", (_label, value) => {
    expect(parseConfig({ ...defaults, step3_cloud_models: value }, "remote").checkModels).toEqual(DEFAULT_CHECK_MODELS);
  });

  it("caps the model list at 4", () => {
    const five = JSON.stringify(["gemini-a", "gemini-b", "gemini-c", "gemini-d", "gemini-e"]);
    expect(parseConfig({ ...defaults, step3_cloud_models: five }, "remote").checkModels).toHaveLength(4);
  });

  it("clamps numbers into safe ranges", () => {
    const c = parseConfig({ ...defaults, step3_max_output_tokens: "999999", listen_max_ms: "10" }, "remote");
    expect(c.maxOutputTokens).toBe(2048);
    expect(c.listenMaxMs).toBe(5_000);
    expect(parseConfig({ ...defaults, listen_max_ms: "abc" }, "remote").listenMaxMs).toBe(15_000);
  });

  it("the kill switch only pauses; its message is plain text", () => {
    const c = parseConfig(
      { ...defaults, checks_paused: "true", checks_paused_message: "<b>Back soon</b>, ask your pharmacist." + "x".repeat(300) },
      "remote",
    );
    expect(c.checksPaused).toBe(true);
    expect(c.pausedMessage).not.toMatch(/[<>]/);
    expect(c.pausedMessage.length).toBeLessThanOrEqual(200);
    expect(parseConfig({ ...defaults, checks_paused: "true" }, "remote").pausedMessage).toMatch(/pharmacist/);
  });

  it("has no key that could change routing, guards or what is sent", () => {
    expect(Object.keys(RC_DEFAULTS).sort()).toEqual(
      ["checks_paused", "checks_paused_message", "listen_max_ms", "step3_cloud_models", "step3_max_output_tokens"].sort(),
    );
    // Step 3's mode is hard-coded, whatever model Remote Config picks.
    expect(checkParams("gemini-anything", 300).mode).toBe(InferenceMode.ONLY_IN_CLOUD);
  });
});
