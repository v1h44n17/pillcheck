import { describe, expect, it } from "vitest";
import { lookupMedicine } from "../src/data/lexicon";
import { EVAL_CASES } from "../src/dev/evalCases";
import { score } from "../src/dev/runEval";

describe("safety eval set", () => {
  it("has 20 dangerous and 10 safe pairs, all made of drugs the lexicon knows", () => {
    expect(EVAL_CASES.filter((c) => c.expect === "dangerous")).toHaveLength(20);
    expect(EVAL_CASES.filter((c) => c.expect === "safe")).toHaveLength(10);
    const unknown = EVAL_CASES.flatMap((c) => [c.medicine, ...c.alreadyTaking]).filter((n) => !lookupMedicine(n));
    expect(unknown).toEqual([]);
  });
});

describe("eval scoring", () => {
  const dangerous = EVAL_CASES.find((c) => c.expect === "dangerous")!;
  const safe = EVAL_CASES.find((c) => c.expect === "safe")!;

  it("a dangerous pair called 'ok' is a missed danger", () => {
    expect(score(dangerous, "ok")).toEqual({ pass: false, failure: "missed-danger" });
    expect(score(dangerous, "caution")).toEqual({ pass: true });
    expect(score(dangerous, "avoid")).toEqual({ pass: true });
  });

  it("a safe pair called 'avoid' is over-warning", () => {
    expect(score(safe, "avoid")).toEqual({ pass: false, failure: "over-warning" });
    expect(score(safe, "ok")).toEqual({ pass: true });
    expect(score(safe, "caution")).toEqual({ pass: true });
  });

  it("'unsure' always passes (it sends Meera to her pharmacist); errors never do", () => {
    expect(score(dangerous, "unsure").pass).toBe(true);
    expect(score(safe, "unsure").pass).toBe(true);
    expect(score(safe, "error")).toEqual({ pass: false, failure: "error" });
  });
});
