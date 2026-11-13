/**
 * Curated spoken forms that the generated openFDA lexicon can't provide:
 * everyday phrases, non-US names, and common short forms.
 *
 * Every value MUST be a canonical ingredient name that exists in
 * drug-lexicon.json (enforced by tests/lexicon.test.ts), so an alias can
 * never introduce new words into what is sent to the cloud.
 */
export const CURATED_ALIASES: Readonly<Record<string, readonly string[]>> = {
  // Everyday names
  "baby aspirin": ["aspirin"],
  "low dose aspirin": ["aspirin"],
  paracetamol: ["acetaminophen"], // UK / India name
  "vitamin d": ["cholecalciferol"],

  // Well-known US brands, pinned so they never depend on openFDA paging
  advil: ["ibuprofen"],
  motrin: ["ibuprofen"],
  aleve: ["naproxen"],
  tylenol: ["acetaminophen"],
  coumadin: ["warfarin"],
  jantoven: ["warfarin"],
  eliquis: ["apixaban"],
  xarelto: ["rivaroxaban"],
  plavix: ["clopidogrel"],
  lipitor: ["atorvastatin"],
  zocor: ["simvastatin"],
  crestor: ["rosuvastatin"],
  glucophage: ["metformin"],
  synthroid: ["levothyroxine"],
  prilosec: ["omeprazole"],
  nexium: ["esomeprazole"],
  zoloft: ["sertraline"],
  lasix: ["furosemide"],
  norvasc: ["amlodipine"],
  zestril: ["lisinopril"],
  prinivil: ["lisinopril"],
  benadryl: ["diphenhydramine"],
  claritin: ["loratadine"],
  zyrtec: ["cetirizine"],
  neurontin: ["gabapentin"],
  lopressor: ["metoprolol"],
  toprol: ["metoprolol"],
};
