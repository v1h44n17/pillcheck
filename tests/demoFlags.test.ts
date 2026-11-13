import { describe, expect, it } from "vitest";
import { activeFlags, toggleSimulateFlag } from "../src/demo/demoFlags";
import { readSimulation } from "../src/guards/onDeviceGuard";
import { demoInjectionEnabled } from "../src/pipeline/demoInjection";

describe("demo flags in the URL", () => {
  it("turns flags on and off, keeping other parameters", () => {
    let s = "?demo";
    s = toggleSimulateFlag(s, "inject-pii", true);
    expect(s).toBe("?demo=&simulate=inject-pii");
    s = toggleSimulateFlag(s, "no-nano", true);
    expect(activeFlags(s)).toEqual(["inject-pii", "no-nano"]);
    s = toggleSimulateFlag(s, "inject-pii", false);
    expect(s).toBe("?demo=&simulate=no-nano");
    s = toggleSimulateFlag(s, "no-nano", false);
    expect(s).toBe("?demo=");
  });

  it("produces exactly the flags the guards read", () => {
    const s = toggleSimulateFlag(toggleSimulateFlag("", "no-nano", true), "inject-pii", true);
    expect(readSimulation(s)).toEqual({ noNano: true, noSpeech: false });
    expect(demoInjectionEnabled(s)).toBe(true);
  });

  it("ignores unknown flags (there is no way to switch a guard off)", () => {
    expect(activeFlags("?simulate=force-cloud,no-guard,no-nano")).toEqual(["no-nano"]);
  });
});
