import { CURATED_ALIASES } from "./aliases";
import { lookupMedicine } from "./lexicon";

/**
 * Contextual biasing for on-device speech recognition (Step 1).
 *
 * Found in production testing (14 Nov 2026): Chrome's on-device recogniser
 * heard "Advil" as "Behind Patel". Drug names are rare words, so we tell the
 * recogniser which ones to expect: her own medicines most strongly, then the
 * medicines older adults take most often.
 *
 * Privacy: this list goes to the ON-DEVICE recogniser only (processLocally),
 * never to a server.
 */

/** Medicines most often taken by older adults (brand and generic). Each must exist in the lexicon. */
export const COMMON_MEDICINES = [
  // pain / fever
  "Advil", "Motrin", "ibuprofen", "Aleve", "naproxen", "Tylenol", "acetaminophen", "aspirin", "baby aspirin",
  // blood thinners
  "Coumadin", "warfarin", "Eliquis", "apixaban", "Xarelto", "rivaroxaban", "Plavix", "clopidogrel",
  // heart / blood pressure
  "Lipitor", "atorvastatin", "Zocor", "simvastatin", "Crestor", "rosuvastatin", "lisinopril", "Zestril",
  "losartan", "amlodipine", "Norvasc", "metoprolol", "Lopressor", "Toprol", "carvedilol", "furosemide",
  "Lasix", "hydrochlorothiazide", "spironolactone", "digoxin",
  // diabetes / thyroid
  "metformin", "Glucophage", "glipizide", "levothyroxine", "Synthroid",
  // stomach
  "omeprazole", "Prilosec", "esomeprazole", "Nexium", "pantoprazole", "Tums", "calcium carbonate",
  // nerves / mood / memory
  "gabapentin", "Neurontin", "sertraline", "Zoloft", "donepezil",
  // other common
  "tamsulosin", "alendronate", "prednisone", "Benadryl", "diphenhydramine", "Claritin", "loratadine",
  "Zyrtec", "cetirizine", "vitamin D", "paracetamol",
] as const;

export interface BiasPhrase {
  phrase: string;
  boost: number;
}

const OWN_BOOST = 6;
const COMMON_BOOST = 3;
const MAX_PHRASES = 150;

function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** Her medicines first (strongest), then common ones, then curated aliases; deduplicated, capped. */
export function biasPhrases(cabinetNames: readonly string[] = []): BiasPhrase[] {
  const out: BiasPhrase[] = [];
  const seen = new Set<string>();
  const add = (name: string, boost: number) => {
    const key = name.toLowerCase();
    if (seen.has(key) || !lookupMedicine(name) || out.length >= MAX_PHRASES) return;
    seen.add(key);
    out.push({ phrase: titleCase(name), boost });
  };
  cabinetNames.forEach((n) => add(n, OWN_BOOST));
  COMMON_MEDICINES.forEach((n) => add(n, COMMON_BOOST));
  Object.keys(CURATED_ALIASES).forEach((n) => add(n, COMMON_BOOST));
  return out;
}
