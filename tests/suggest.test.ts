import { describe, expect, it } from "vitest";
import { editDistance, suggestCorrection, suggestMedicine } from "../src/data/suggest";
import { scanOutbound } from "../src/guards/leakGuard";

describe("editDistance", () => {
  it("counts insertions, deletions, substitutions and swaps as one edit each", () => {
    expect(editDistance("coumadin", "coumadin")).toBe(0);
    expect(editDistance("coumdin", "coumadin")).toBe(1);
    expect(editDistance("asprin", "aspirin")).toBe(1);
    expect(editDistance("warfrain", "warfarin")).toBe(1); // transposition
    expect(editDistance("", "abc")).toBe(3);
  });
});

describe("suggestMedicine (on-device)", () => {
  it.each([
    ["coumdin", "coumadin"],
    ["cumadin", "coumadin"],
    ["warfrin", "warfarin"],
    ["ibuprofin", "ibuprofen"],
    ["asprin", "aspirin"],
    ["metforman", "metformin"],
    ["lisinoprill", "lisinopril"],
    ["atorvastin", "atorvastatin"],
    ["Eliquiss", "eliquis"],
  ])("%s → %s", (heard, meant) => {
    expect(suggestMedicine(heard)).toBe(meant);
  });

  it("no suggestion for names it already knows, very short words, or nonsense", () => {
    for (const t of ["warfarin", "Advil", "tums", "abc", "zzzz", "banana"]) expect(suggestMedicine(t)).toBeUndefined();
  });

  it("never turns a person's name into a medicine", () => {
    const people = [
      "meera", "patel", "sharma", "gupta", "reddy", "priya", "anita", "sunita", "rahul", "kumar", "singh",
      "john", "mary", "linda", "susan", "david", "smith", "jones", "brown", "garcia", "miller", "cooper",
      "bailey", "bradley", "morgan", "harris", "walker", "mitchell", "carter", "parker", "turner", "collins",
    ];
    for (const p of people) expect(suggestMedicine(p), p).toBeUndefined();
  });

  it("every suggestion is a name the leak guard accepts", () => {
    for (const t of ["coumdin", "warfrin", "ibuprofin", "asprin", "metforman", "eliquiss"]) {
      const s = suggestMedicine(t)!;
      expect(scanOutbound({ medicines: [s] }).ok, s).toBe(true);
    }
  });
});

describe("suggestCorrection", () => {
  const unknown = (value: string) => ({ kind: "unknown-term", value, field: "medicines" });

  it("corrects only the unknown words and keeps the rest", () => {
    expect(suggestCorrection(["advil", "coumdin"], [unknown("coumdin")])).toEqual({
      medicines: ["advil", "coumadin"],
      changes: [{ from: "coumdin", to: "coumadin" }],
    });
  });

  it("no correction when anything personal was found", () => {
    expect(
      suggestCorrection(["coumdin", "Meera Sharma"], [unknown("coumdin"), { kind: "possible-name", value: "Meera Sharma", field: "medicines" }]),
    ).toBeUndefined();
    expect(suggestCorrection(["coumdin 5mg"], [{ kind: "digits", value: "coumdin 5mg", field: "medicines" }])).toBeUndefined();
  });

  it("no correction unless EVERY unknown word has a clear match", () => {
    expect(suggestCorrection(["coumdin", "zzzzz"], [unknown("coumdin"), unknown("zzzzz")])).toBeUndefined();
  });

  it("no correction for unknown words on her saved list (that's fixed in the list, not here)", () => {
    expect(suggestCorrection(["advil"], [{ kind: "unknown-term", value: "coumdin", field: "cabinet" }])).toBeUndefined();
  });
});
