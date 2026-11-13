import { describe, expect, it } from "vitest";
import data from "../src/data/drug-lexicon.json";
import { CURATED_ALIASES } from "../src/data/aliases";
import { isCanonicalIngredient, lookupMedicine } from "../src/data/lexicon";
import { baseName } from "../src/data/normalize";

const brands = data.brands as Record<string, string[]>;

describe("generated lexicon (openFDA)", () => {
  it("is big enough to be useful", () => {
    expect(data.ingredients.length).toBeGreaterThan(1500);
    expect(Object.keys(brands).length).toBeGreaterThan(1000);
  });

  it("contains no digits or symbols anywhere: nothing in it can look like PII", () => {
    const ok = /^[a-z][a-z \-]*[a-z]$/;
    for (const i of data.ingredients) expect(i).toMatch(ok);
    for (const [b, ings] of Object.entries(brands)) {
      expect(b).toMatch(ok);
      for (const i of ings) expect(isCanonicalIngredient(i)).toBe(true);
    }
  });

  it("drops ambiguous store brands that sell many different drugs", () => {
    const storePrefixes = ["equate", "equaline", "cvs", "up and up", "walgreens", "kroger", "good neighbor", "leader", "kirkland"];
    for (const b of Object.keys(brands)) {
      for (const s of storePrefixes) expect(b === s || b.startsWith(`${s} `), `${b} is a store brand`).toBe(false);
    }
  });

  it("drops generic labels that many different products use", () => {
    for (const label of ["kids allergy", "allergy relief", "sleep aid", "pain relief", "cold and flu"]) {
      expect(brands[label], label).toBeUndefined();
    }
  });
});

describe("curated aliases", () => {
  it("only point at canonical ingredients, so they can't add new words to what's sent", () => {
    for (const [alias, ings] of Object.entries(CURATED_ALIASES)) {
      expect(ings.length, alias).toBeGreaterThan(0);
      for (const i of ings) expect(isCanonicalIngredient(i), `${alias} → ${i}`).toBe(true);
    }
  });
});

describe("lookupMedicine", () => {
  it.each([
    ["ibuprofen", ["ibuprofen"], "ingredient"],
    ["Advil", ["ibuprofen"], "alias"],
    ["tylenol", ["acetaminophen"], "alias"],
    ["paracetamol", ["acetaminophen"], "alias"],
    ["Plavix", ["clopidogrel"], "alias"],
    ["eliquis", ["apixaban"], "alias"],
    ["metformin hydrochloride", ["metformin"], "ingredient"],
    ["Levothyroxine Sodium", ["levothyroxine"], "ingredient"],
  ] as const)("%s → %j", (term, ingredients, via) => {
    expect(lookupMedicine(term)).toEqual({ heard: term.toLowerCase(), ingredients, via });
  });

  it("covers the medicines seniors most often take", () => {
    const common = [
      "warfarin", "apixaban", "rivaroxaban", "clopidogrel", "aspirin", "atorvastatin", "simvastatin",
      "rosuvastatin", "lisinopril", "losartan", "amlodipine", "metoprolol", "carvedilol", "furosemide",
      "hydrochlorothiazide", "spironolactone", "metformin", "glipizide", "insulin glargine", "levothyroxine",
      "omeprazole", "pantoprazole", "gabapentin", "sertraline", "donepezil", "tamsulosin", "prednisone",
      "acetaminophen", "ibuprofen", "naproxen", "diphenhydramine", "alendronate", "digoxin",
    ];
    const missing = common.filter((c) => !lookupMedicine(c));
    expect(missing).toEqual([]);
  });

  it("does not know people", () => {
    for (const n of ["meera", "sharma", "meera sharma", "john", "mary"]) expect(lookupMedicine(n)).toBeUndefined();
  });

  it("baseName strips salts but never to nothing", () => {
    expect(baseName("CLOPIDOGREL BISULFATE")).toBe("clopidogrel");
    expect(baseName("potassium chloride")).toBe("potassium chloride");
    expect(baseName("sodium")).toBe("sodium");
  });
});
