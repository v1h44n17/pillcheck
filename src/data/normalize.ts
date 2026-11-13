/**
 * Name normalisation shared by the lexicon build script and the runtime
 * lookup, so "Metformin Hydrochloride" and "metformin" resolve identically.
 */

/** Trailing salt / hydrate words. "metformin hydrochloride" → "metformin". */
const SALT_WORDS = new Set([
  "hydrochloride", "hcl", "hydrobromide", "sodium", "potassium", "calcium", "magnesium",
  "succinate", "tartrate", "bitartrate", "besylate", "maleate", "mesylate", "citrate",
  "acetate", "phosphate", "sulfate", "bromide", "fumarate", "hyclate", "monohydrate",
  "dihydrate", "trihydrate", "hemihydrate", "sesquihydrate", "anhydrous", "dipropionate",
  "propionate", "furoate", "valerate", "disodium", "dihydrochloride", "monosodium",
  "lactate", "gluconate", "tosylate", "napsylate", "pamoate", "hemifumarate",
  "bisulfate", "dimesylate", "dimaleate", "succinate", "decanoate", "enanthate", "cypionate",
]);

/** Lowercase, trim, collapse whitespace. */
export function normalizeTerm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Strip trailing salt words, but never down to nothing ("potassium chloride" stays). */
export function baseName(ingredient: string): string {
  const words = normalizeTerm(ingredient).split(" ");
  while (words.length > 1 && SALT_WORDS.has(words[words.length - 1]!)) words.pop();
  return words.join(" ");
}
