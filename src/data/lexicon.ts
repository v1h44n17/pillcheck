import data from "./drug-lexicon.json";
import { CURATED_ALIASES } from "./aliases";
import { baseName, normalizeTerm } from "./normalize";

/**
 * Closed vocabulary of medicines (openFDA, public domain + curated aliases).
 *
 * The leak guard only lets CANONICAL INGREDIENT NAMES from this lexicon leave
 * the device. Whatever Meera said ("Advil", "baby aspirin") is mapped to
 * ingredients here, and the mapped values (not her words) are what's sent.
 */
export interface MedicineMatch {
  /** The term as Nano extracted it (normalised). Stays on the device. */
  heard: string;
  /** Canonical ingredient names. These are what may be sent. */
  ingredients: string[];
  via: "ingredient" | "brand" | "alias";
}

const INGREDIENTS: ReadonlySet<string> = new Set(data.ingredients);
const BRANDS: Readonly<Record<string, string[]>> = data.brands;

export const LEXICON_INFO = {
  source: data.source,
  generatedAt: data.generatedAt,
  ingredientCount: INGREDIENTS.size,
  brandCount: Object.keys(BRANDS).length,
};

/**
 * Names "Did you mean…?" may suggest: curated aliases, plus canonical ingredients
 * of 8+ letters. Not the ~1,400 openFDA brands, and not short ingredients: too
 * close to people's names ("Meera" → "Menera", "Cooper" → "copper").
 * suggest.ts adds the common household medicines on top.
 */
export function suggestableNames(): string[] {
  return [...new Set([...Object.keys(CURATED_ALIASES), ...[...INGREDIENTS].filter((i) => i.length >= 8)])];
}

export function isCanonicalIngredient(name: string): boolean {
  return INGREDIENTS.has(name);
}

export function lookupMedicine(term: string): MedicineMatch | undefined {
  const heard = normalizeTerm(term);
  if (!heard) return undefined;

  const alias = CURATED_ALIASES[heard];
  if (alias && alias.length > 0) return { heard, ingredients: [...alias], via: "alias" };

  // Ingredient names win over brand names: they're unambiguous.
  if (INGREDIENTS.has(heard)) return { heard, ingredients: [heard], via: "ingredient" };

  const base = baseName(heard);
  if (INGREDIENTS.has(base)) return { heard, ingredients: [base], via: "ingredient" };

  const brand = BRANDS[heard];
  if (brand) return { heard, ingredients: [...brand], via: "brand" };

  return undefined;
}
