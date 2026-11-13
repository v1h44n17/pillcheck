/**
 * Builds src/data/drug-lexicon.json from openFDA (public domain, CC0).
 *
 *   npm run build:lexicon
 *
 * Output:
 *   ingredients: canonical ingredient names (lowercase, salt forms stripped)
 *   brands:      brand name → canonical ingredient names
 *
 * The leak guard (src/guards/leakGuard.ts) uses this as a closed allowlist:
 * only canonical ingredient names from this file can ever be sent to the cloud.
 *
 * Runs with Node ≥ 23 (native TypeScript type stripping). No API key needed;
 * openFDA allows 240 requests/minute without one, and this makes ~60.
 */
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const API = "https://api.fda.gov/drug/ndc.json";
const OUT = new URL("../src/data/drug-lexicon.json", import.meta.url);
const PRODUCT_TYPES = ["HUMAN PRESCRIPTION DRUG", "HUMAN OTC DRUG"] as const;
const PAGE = 1000;
const MAX_SKIP = 25_000; // openFDA's paging limit

// Shared with the runtime lookup so build-time and run-time names always agree.
import { baseName, normalizeTerm as clean } from "../src/data/normalize.ts";

const WORDS_OK = /^[a-z][a-z \-]*[a-z]$/;

/**
 * Store / private-label brands sell many different drugs under one name. The
 * consistency check below catches most, but openFDA paging only samples ~26k
 * records per product type, so a store brand can LOOK consistent by chance.
 * These are never mapped. A brand starting with one of these words is skipped too.
 */
const STORE_BRANDS = [
  "equate", "cvs", "cvs health", "up and up", "walgreens", "kroger", "good neighbor", "good neighbor pharmacy",
  "leader", "health mart", "care one", "careone", "rite aid", "sunmark", "topcare", "top care", "family wellness",
  "members mark", "kirkland", "kirkland signature", "basic care", "amazon basic care", "signature care",
  "quality choice", "publix", "meijer", "heb", "h-e-b", "hy-vee", "smart sense", "major", "rugby", "select brand",
  "dg health", "healthy accents", "good sense", "exchange select", "premier value", "berkley and jensen",
  "wellness basics", "safeway", "giant eagle", "simply right", "harris teeter", "foodhold", "best choice",
  "valu merchandisers", "western family", "shoprite", "wegmans", "food lion", "hannaford", "medique", "geri-care",
  "equaline", "signature", "pharmacist choice", "healthy living", "assured", "dollar general", "family dollar",
];

/**
 * Words that describe a product rather than name it. A "brand" made ONLY of these
 * ("kids allergy", "sleep aid", "pain relief extra strength") is a generic label
 * used for many different drugs, so it's never mapped.
 */
const DESCRIPTOR_WORDS = new Set([
  "allergy", "relief", "pain", "sleep", "aid", "kids", "childrens", "children", "infants", "infant", "adult",
  "adults", "extra", "strength", "maximum", "regular", "cold", "flu", "cough", "heartburn", "prevention",
  "nighttime", "night", "daytime", "day", "sinus", "headache", "fever", "reducer", "antacid", "laxative",
  "stool", "softener", "multi", "symptom", "severe", "non-drowsy", "chewable", "chewables", "tablets",
  "tablet", "caplets", "softgels", "liquid", "gels", "and", "plus", "complete", "original", "formula",
  "mucus", "congestion", "chest", "nasal", "decongestant", "antihistamine", "acid", "reducer", "gas",
  "anti-diarrheal", "diarrhea", "nausea", "motion", "sickness", "migraine", "arthritis", "back", "body",
  "muscle", "menstrual", "cramps", "sore", "throat", "lozenges", "drops", "mint", "cherry", "berry", "honey",
  "lemon", "orange", "grape", "low", "dose", "baby", "senior", "mens", "womens", "daily", "rapid", "fast",
  "acting", "long", "lasting", "hour", "hours", "release", "extended", "delayed", "coated", "enteric",
]);

function isDescriptorOnly(brand: string): boolean {
  return brand.split(" ").every((w) => DESCRIPTOR_WORDS.has(w));
}
const STORE_PREFIX = new RegExp(`^(${STORE_BRANDS.map((s) => s.replace(/-/g, "\\-")).join("|")})( |$)`);

function acceptable(name: string, maxWords: number): boolean {
  return name.length >= 3 && name.length <= 40 && WORDS_OK.test(name) && name.split(" ").length <= maxWords;
}

async function get<T>(params: Record<string, string>): Promise<T> {
  const url = `${API}?${new URLSearchParams(params)}`;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url);
    if (res.ok) return (await res.json()) as T;
    if (res.status === 404) return { results: [] } as T; // openFDA: no matches
    if (attempt >= 4) throw new Error(`${res.status} for ${url}`);
    await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
}

type CountResult = { results: Array<{ term: string; count: number }> };
type NdcRecord = {
  brand_name?: string;
  marketing_category?: string;
  route?: string[];
  active_ingredients?: Array<{ name: string }>;
};

async function main() {
  const ingredients = new Set<string>();
  /** brand → set of distinct ingredient signatures seen under that brand name. */
  const brands = new Map<string, Set<string>>();

  for (const type of PRODUCT_TYPES) {
    const { results } = await get<CountResult>({
      search: `product_type:"${type}"`,
      count: "active_ingredients.name.exact",
      limit: String(PAGE),
    });
    for (const { term } of results) {
      const b = baseName(term);
      if (acceptable(b, 4)) ingredients.add(b);
    }
    console.log(`${type}: ${results.length} ingredient terms`);

    // Fetch pages 6 at a time (well under openFDA's 240 requests/minute).
    const skips = Array.from({ length: MAX_SKIP / PAGE + 1 }, (_, i) => i * PAGE);
    const pages: NdcRecord[][] = [];
    for (let i = 0; i < skips.length; i += 6) {
      const batch = await Promise.all(
        skips.slice(i, i + 6).map((skip) =>
          get<{ results: NdcRecord[] }>({ search: `product_type:"${type}"`, limit: String(PAGE), skip: String(skip) }),
        ),
      );
      pages.push(...batch.map((b) => b.results));
      process.stdout.write(`\r${type}: fetched ${pages.length}/${skips.length} pages   `);
    }
    for (const records of pages) {
      for (const r of records) {
        if (!r.brand_name || r.marketing_category?.includes("HOMEOPATHIC")) continue;
        // PillCheck answers questions about pills: only brands taken by mouth.
        if (!r.route?.includes("ORAL")) continue;
        const actives = [...new Set((r.active_ingredients ?? []).map((a) => baseName(a.name)))].sort();
        if (actives.length === 0 || actives.length > 3 || !actives.every((a) => acceptable(a, 4))) continue;
        const brand = clean(r.brand_name);
        if (!acceptable(brand, 3) || STORE_PREFIX.test(brand) || isDescriptorOnly(brand)) continue;
        // A "brand" that is just the generic name (often with its salt) isn't a brand.
        if (actives.includes(baseName(brand))) continue;
        actives.forEach((a) => ingredients.add(a));
        const signatures = brands.get(brand) ?? new Set<string>();
        signatures.add(actives.join("|"));
        brands.set(brand, signatures);
      }
    }
    process.stdout.write("\n");
  }

  // SAFETY: keep a brand only if EVERY product under that name has the same
  // ingredients. Store brands ("equate", "cvs") and umbrella brands sell many
  // different drugs under one name; mapping them would check the wrong drug.
  const brandOut: Record<string, string[]> = {};
  let ambiguous = 0;
  for (const [brand, signatures] of [...brands].sort(([a], [b]) => a.localeCompare(b))) {
    if (signatures.size !== 1) {
      ambiguous++;
      continue;
    }
    if (ingredients.has(brand) || ingredients.has(baseName(brand))) continue;
    brandOut[brand] = [...signatures][0]!.split("|");
  }
  console.log(`Dropped ${ambiguous} ambiguous brands (more than one ingredient set).`);

  const out = {
    source: "openFDA NDC directory (https://open.fda.gov/apis/drug/ndc/), public domain (CC0)",
    generatedAt: new Date().toISOString().slice(0, 10),
    note: "Generated by scripts/build-lexicon.ts. Do not edit by hand; curated additions live in src/data/aliases.ts.",
    ingredients: [...ingredients].sort(),
    brands: brandOut,
  };
  await writeFile(OUT, `${JSON.stringify(out)}\n`);
  console.log(`Wrote ${out.ingredients.length} ingredients, ${Object.keys(brandOut).length} brands → ${OUT.pathname}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
