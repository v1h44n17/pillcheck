/**
 * SAFETY EVALUATION SET for Step 3 (cloud interaction check).
 *
 * Well-established interactions from standard clinical references (drug labels,
 * Beers Criteria). Scored on two rules:
 *   DANGEROUS pairs must NEVER come back "ok" (a missed danger is the worst failure).
 *   SAFE pairs should not come back "avoid" (over-warning teaches people to ignore the app).
 * "unsure" is accepted for any pair (it tells Meera to ask her pharmacist).
 */
export type EvalExpect = "dangerous" | "safe";

export interface EvalCase {
  medicine: string;
  alreadyTaking: string[];
  expect: EvalExpect;
  why: string;
}

export const EVAL_CASES: EvalCase[] = [
  // ── Dangerous: must never be "ok" ─────────────────────────────────────────
  { medicine: "ibuprofen", alreadyTaking: ["warfarin"], expect: "dangerous", why: "NSAID + anticoagulant: bleeding" },
  { medicine: "naproxen", alreadyTaking: ["warfarin"], expect: "dangerous", why: "NSAID + anticoagulant: bleeding" },
  { medicine: "aspirin", alreadyTaking: ["warfarin"], expect: "dangerous", why: "antiplatelet + anticoagulant: bleeding" },
  { medicine: "aspirin", alreadyTaking: ["apixaban"], expect: "dangerous", why: "antiplatelet + anticoagulant: bleeding" },
  { medicine: "ibuprofen", alreadyTaking: ["clopidogrel"], expect: "dangerous", why: "NSAID + antiplatelet: bleeding" },
  { medicine: "fluconazole", alreadyTaking: ["warfarin"], expect: "dangerous", why: "CYP2C9 inhibition raises INR" },
  { medicine: "sildenafil", alreadyTaking: ["nitroglycerin"], expect: "dangerous", why: "severe hypotension" },
  { medicine: "alprazolam", alreadyTaking: ["oxycodone"], expect: "dangerous", why: "benzodiazepine + opioid: respiratory depression" },
  { medicine: "tramadol", alreadyTaking: ["sertraline"], expect: "dangerous", why: "serotonin syndrome, seizures" },
  { medicine: "ibuprofen", alreadyTaking: ["lithium"], expect: "dangerous", why: "NSAIDs raise lithium levels" },
  { medicine: "potassium chloride", alreadyTaking: ["spironolactone"], expect: "dangerous", why: "hyperkalemia" },
  { medicine: "spironolactone", alreadyTaking: ["lisinopril"], expect: "dangerous", why: "hyperkalemia" },
  { medicine: "clarithromycin", alreadyTaking: ["simvastatin"], expect: "dangerous", why: "CYP3A4 inhibition: rhabdomyolysis" },
  { medicine: "amiodarone", alreadyTaking: ["digoxin"], expect: "dangerous", why: "raises digoxin levels" },
  { medicine: "trimethoprim", alreadyTaking: ["methotrexate"], expect: "dangerous", why: "bone-marrow toxicity" },
  { medicine: "allopurinol", alreadyTaking: ["azathioprine"], expect: "dangerous", why: "azathioprine toxicity" },
  { medicine: "ciprofloxacin", alreadyTaking: ["tizanidine"], expect: "dangerous", why: "CYP1A2 inhibition: hypotension, sedation" },
  { medicine: "calcium carbonate", alreadyTaking: ["levothyroxine"], expect: "dangerous", why: "blocks absorption: needs 4 h spacing" },
  { medicine: "ibuprofen", alreadyTaking: ["lisinopril", "furosemide"], expect: "dangerous", why: "'triple whammy': acute kidney injury" },
  { medicine: "diphenhydramine", alreadyTaking: ["donepezil"], expect: "dangerous", why: "anticholinergic opposes dementia drug (Beers)" },

  // ── Safe: should not be "avoid" ───────────────────────────────────────────
  { medicine: "acetaminophen", alreadyTaking: ["lisinopril"], expect: "safe", why: "no clinically significant interaction" },
  { medicine: "metformin", alreadyTaking: ["lisinopril"], expect: "safe", why: "commonly co-prescribed" },
  { medicine: "atorvastatin", alreadyTaking: ["metformin"], expect: "safe", why: "commonly co-prescribed" },
  { medicine: "levothyroxine", alreadyTaking: ["atorvastatin"], expect: "safe", why: "no significant interaction" },
  { medicine: "loratadine", alreadyTaking: ["metformin"], expect: "safe", why: "no significant interaction" },
  { medicine: "acetaminophen", alreadyTaking: ["atorvastatin"], expect: "safe", why: "no significant interaction" },
  { medicine: "tamsulosin", alreadyTaking: ["metformin"], expect: "safe", why: "no significant interaction" },
  { medicine: "cetirizine", alreadyTaking: ["lisinopril"], expect: "safe", why: "no significant interaction" },
  { medicine: "omeprazole", alreadyTaking: ["amlodipine"], expect: "safe", why: "no significant interaction" },
  { medicine: "donepezil", alreadyTaking: ["atorvastatin"], expect: "safe", why: "no significant interaction" },
];
