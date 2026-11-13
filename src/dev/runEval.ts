import { checkInteractions, type Verdict } from "../pipeline/step3-check";
import { EVAL_CASES, type EvalCase } from "./evalCases";

/**
 * DEV-ONLY: runs the safety evaluation through the REAL Step 3 (leak guard →
 * openFDA labels → cloud Gemini behind App Check). Exposed as
 * `__pillcheck.runEval()` on localhost only; App Check means only the app
 * itself can call Gemini, so the eval runs in the browser.
 */
export interface EvalRow {
  case: EvalCase;
  verdict: Verdict | "error";
  pass: boolean;
  /** "missed-danger" is the critical failure; "over-warning" the lesser one. */
  failure?: "missed-danger" | "over-warning" | "error";
  spoken?: string;
  model?: string;
  ms: number;
}

export function score(c: EvalCase, verdict: Verdict | "error"): Pick<EvalRow, "pass" | "failure"> {
  if (verdict === "error") return { pass: false, failure: "error" };
  if (c.expect === "dangerous" && verdict === "ok") return { pass: false, failure: "missed-danger" };
  if (c.expect === "safe" && verdict === "avoid") return { pass: false, failure: "over-warning" };
  return { pass: true };
}

export interface EvalSummary {
  total: number;
  passed: number;
  missedDangers: number;
  overWarnings: number;
  errors: number;
  rows: EvalRow[];
}

export async function runEval(onRow?: (row: EvalRow, i: number) => void): Promise<EvalSummary> {
  const rows: EvalRow[] = [];
  for (const [i, c] of EVAL_CASES.entries()) {
    const t0 = performance.now();
    let row: EvalRow;
    try {
      const a = await checkInteractions({ medicines: [c.medicine], cabinet: c.alreadyTaking });
      row = { case: c, verdict: a.verdict, spoken: a.spoken, model: a.model, ms: Math.round(performance.now() - t0), ...score(c, a.verdict) };
    } catch {
      row = { case: c, verdict: "error", ms: Math.round(performance.now() - t0), ...score(c, "error") };
    }
    rows.push(row);
    onRow?.(row, i);
  }
  return {
    total: rows.length,
    passed: rows.filter((r) => r.pass).length,
    missedDangers: rows.filter((r) => r.failure === "missed-danger").length,
    overWarnings: rows.filter((r) => r.failure === "over-warning").length,
    errors: rows.filter((r) => r.failure === "error").length,
    rows,
  };
}
