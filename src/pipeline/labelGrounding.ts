/**
 * Grounding for Step 3: official FDA drug-label text (openFDA, public domain).
 *
 * Gemini answers from these excerpts first, so the interaction check rests on
 * the same labels a pharmacist would read, not just on what the model remembers.
 *
 * PRIVACY: only called from step3-check.ts AFTER the leak guard. The request
 * contains one canonical ingredient name (e.g. "warfarin") and nothing else.
 */
const LABEL_API = "https://api.fda.gov/drug/label.json";

/** Label sections that matter for "can I take these together?", in priority order. */
const SECTIONS: Array<[field: string, heading: string, budget: number]> = [
  ["boxed_warning", "Boxed warning", 600],
  ["drug_interactions", "Drug interactions", 2200],
  ["do_not_use", "Do not use", 500],
  ["ask_doctor_or_pharmacist", "Ask a doctor or pharmacist before use if you are", 600],
  ["warnings", "Warnings", 900],
  ["geriatric_use", "Use in older adults", 500],
];

const MAX_CHARS_PER_DRUG = 3500;
export const LABEL_TIMEOUT_MS = 6_000;

export interface LabelExcerpt {
  ingredient: string;
  text: string;
  /** openFDA label set id, for the on-screen "source" link. */
  setId?: string;
}

type LabelRecord = Record<string, unknown> & { set_id?: string };

function sectionText(record: LabelRecord, field: string): string {
  const v = record[field];
  return Array.isArray(v) ? v.filter((s) => typeof s === "string").join(" ").replace(/\s+/g, " ").trim() : "";
}

export function excerptFromLabel(ingredient: string, record: LabelRecord): LabelExcerpt | undefined {
  const parts: string[] = [];
  for (const [field, heading, budget] of SECTIONS) {
    const t = sectionText(record, field);
    if (t) parts.push(`${heading}: ${t.slice(0, budget)}${t.length > budget ? "…" : ""}`);
  }
  if (parts.length === 0) return undefined;
  return { ingredient, text: parts.join("\n").slice(0, MAX_CHARS_PER_DRUG), setId: record.set_id };
}

async function fetchOne(ingredient: string, fetchImpl: typeof fetch): Promise<LabelExcerpt | undefined> {
  const params = new URLSearchParams({ search: `openfda.generic_name:"${ingredient}"`, limit: "5" });
  // A slow label must not stall the answer: give up after LABEL_TIMEOUT_MS (that drug is then ungrounded).
  const res = await fetchImpl(`${LABEL_API}?${params}`, { signal: AbortSignal.timeout(LABEL_TIMEOUT_MS) });
  if (res.status === 404) return undefined; // openFDA: no label found
  if (!res.ok) throw new Error(`openFDA ${res.status}`);
  const { results } = (await res.json()) as { results?: LabelRecord[] };
  // Prefer a label that actually has an interactions section.
  const records = results ?? [];
  const best = records.find((r) => sectionText(r, "drug_interactions")) ?? records[0];
  return best ? excerptFromLabel(ingredient, best) : undefined;
}

/**
 * Fetches excerpts for each ingredient. Never throws: a missing or failed label
 * just means that drug is ungrounded, and Step 3 tells Gemini to be more cautious.
 */
export async function fetchLabelExcerpts(
  ingredients: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<{ excerpts: LabelExcerpt[]; missing: string[] }> {
  const results = await Promise.all(
    ingredients.map((i) => fetchOne(i, fetchImpl).catch(() => undefined)),
  );
  const excerpts = results.filter((r): r is LabelExcerpt => r !== undefined);
  const missing = ingredients.filter((i) => !excerpts.some((e) => e.ingredient === i));
  return { excerpts, missing };
}
