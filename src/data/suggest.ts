import { COMMON_MEDICINES } from "./biasPhrases";
import { lookupMedicine, suggestableNames } from "./lexicon";
import { normalizeTerm } from "./normalize";

/**
 * "Did you mean…?" Runs ON THE DEVICE against the lexicon.
 *
 * Only clear near-misses: same first letter, and at most 1 edit for names up to
 * 6 letters, 2 edits for longer ones. If two names are equally close, no
 * suggestion: we never guess between medicines.
 */

/** Damerau-Levenshtein (optimal string alignment) distance. */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return d[a.length]![b.length]!;
}

let names: string[] | undefined;

export function suggestMedicine(term: string): string | undefined {
  const t = normalizeTerm(term).replace(/[^a-z ]/g, "");
  if (t.length < 4) return undefined;
  const maxEdits = t.length <= 6 ? 1 : 2;
  // Well-known names only, and only ones the lexicon really resolves.
  names ??= [...new Set([...suggestableNames(), ...COMMON_MEDICINES.map((n) => n.toLowerCase())])].filter((n) =>
    lookupMedicine(n),
  );

  let best: string | undefined;
  let bestDist = Infinity;
  let tie = false;
  for (const n of names) {
    if (n[0] !== t[0] || Math.abs(n.length - t.length) > maxEdits) continue;
    const dist = editDistance(t, n);
    if (dist === 0) return undefined; // already a known name: nothing to suggest
    if (dist < bestDist) {
      best = n;
      bestDist = dist;
      tie = false;
    } else if (dist === bestDist) {
      tie = true;
    }
  }
  return best && bestDist <= maxEdits && !tie ? best : undefined;
}

export interface Correction {
  /** The corrected list to re-check (still goes through the leak guard). */
  medicines: string[];
  /** For the screen and the voice: what was heard → what we think was meant. */
  changes: Array<{ from: string; to: string }>;
}

/**
 * A "Did you mean…?" correction, only when the guard blocked SOLELY because of
 * unknown medicine words, and EVERY one of them has a clear near-miss.
 * Anything personal (or anything else odd) → no suggestion: the block stands.
 */
export function suggestCorrection(
  medicines: string[],
  findings: ReadonlyArray<{ kind: string; value: string; field: string }>,
): Correction | undefined {
  if (findings.length === 0 || !findings.every((f) => f.kind === "unknown-term" && f.field === "medicines")) {
    return undefined;
  }
  const unknown = new Set(findings.map((f) => f.value));
  const changes: Correction["changes"] = [];
  const corrected: string[] = [];
  for (const m of medicines) {
    const heard = m.trim();
    if (!unknown.has(heard)) {
      corrected.push(m);
      continue;
    }
    const to = suggestMedicine(heard);
    if (!to) return undefined;
    changes.push({ from: heard, to });
    corrected.push(to);
  }
  return changes.length > 0 ? { medicines: corrected, changes } : undefined;
}
