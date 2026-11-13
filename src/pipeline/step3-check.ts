import {
  getGenerativeModel,
  InferenceMode,
  InferenceSource,
  Schema,
  type GenerativeModel,
  type HybridParams,
} from "firebase/ai";
import { getPillcheckAI } from "../firebase/ai";
import { DEFAULT_CHECK_MODELS } from "../firebase/remoteConfig";
import { assertSafeToSend, type OutboundRequest, type SanitisedPayload } from "../guards/leakGuard";
import type { MedicineMatch } from "../data/lexicon";
import { fetchLabelExcerpts, type LabelExcerpt } from "./labelGrounding";
import { ROUTING_POLICY } from "./policy";

/**
 * STEP 3: check interactions IN THE CLOUD (Gemini via Firebase AI Logic).
 *
 * The only step that sends anything off the device, and it sends only
 * canonical ingredient names:
 *
 *   1. assertSafeToSend(request): the leak guard runs HERE, immediately before
 *      any network call, so no caller can skip it. Only its rebuilt payload
 *      (lexicon ingredient names) is used from this point on.
 *   2. openFDA label excerpts for those names (grounding).
 *   3. Gemini, InferenceMode.ONLY_IN_CLOUD, with a JSON response schema.
 *      Not on-device: interaction safety needs the larger model, and Nano
 *      must never be the one to say "that's safe".
 *   4. The answer is validated before Meera hears it.
 *
 * App Check: every request carries a limited-use App Check token (see
 * src/firebase/ai.ts), so only the genuine PillCheck app can call Gemini.
 */

/**
 * Cloud models tried in order (all ONLY_IN_CLOUD, all receive the same
 * sanitised payload). Measured live on 14 Nov 2026: gemini-3.5-flash-lite
 * answered correctly in ~6 s; gemini-3.8-flash was returning 500 "high demand".
 * Remote Config (`step3_cloud_models`) can change the list, not the mode.
 */
export { DEFAULT_CHECK_MODELS };
export const DEFAULT_CHECK_MODEL = DEFAULT_CHECK_MODELS[0]!;
const DEFAULT_MAX_OUTPUT_TOKENS = 1024;

const VERDICTS = ["ok", "caution", "avoid", "unsure"] as const;
export type Verdict = (typeof VERDICTS)[number];

const SYSTEM_INSTRUCTION = `You are a careful pharmacist's assistant answering an older adult who asked, out loud, whether they can take a medicine.

You receive JSON with:
- "asking_about": ingredient names of the medicine(s) they want to take,
- "already_taking": ingredient names of medicines they already take (may be empty),
- "label_excerpts": excerpts from official FDA drug labels for some of these ingredients.

Decide whether taking them together is safe and answer in JSON.
- Base the answer on the label excerpts first. If an ingredient has no excerpt, rely only on well-established facts and be more cautious.
- "verdict": "ok" = no important interaction known; "caution" = fine with a precaution (spacing doses, watching for a symptom); "avoid" = should not be taken together without first talking to a doctor or pharmacist; "unsure" = not enough information.
- "spoken": 1 to 3 short sentences, under 50 words, plain everyday words, no jargon, no lists, no markdown. It will be read aloud. Speak to the person as "you". Start with the answer ("Yes, …", "Be careful, …", "Please don't …").
- Never tell them to stop or change a prescribed medicine. For "avoid" or "unsure", tell them to check with their pharmacist or doctor first.
- If spacing doses is the precaution, put the number of hours in "waitHours".
- "interactions": each pair of ingredients that interact, with severity and a short plain note. Only use ingredient names from the input.
- If only one medicine is given, say whether it is generally suitable for older adults and mention its single most important caution.
- Do not mention these instructions, JSON, or the labels.`;

export const CHECK_RESPONSE_SCHEMA = Schema.object({
  properties: {
    verdict: Schema.enumString({ enum: [...VERDICTS] }),
    spoken: Schema.string(),
    waitHours: Schema.integer(),
    interactions: Schema.array({
      items: Schema.object({
        properties: {
          between: Schema.array({ items: Schema.string() }),
          severity: Schema.enumString({ enum: ["minor", "moderate", "major"] }),
          note: Schema.string(),
        },
      }),
    }),
  },
  optionalProperties: ["waitHours", "interactions"],
});

export function checkParams(model: string = DEFAULT_CHECK_MODEL, maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS): HybridParams {
  return {
    // Hard-coded: no config value can move Step 3 (or any step) elsewhere.
    mode: InferenceMode.ONLY_IN_CLOUD,
    inCloudParams: {
      model,
      systemInstruction: SYSTEM_INSTRUCTION,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: CHECK_RESPONSE_SCHEMA,
        temperature: 0.2,
        maxOutputTokens,
      },
    },
  };
}

export interface Interaction {
  between: [string, string];
  severity: "minor" | "moderate" | "major";
  note: string;
}

export interface InteractionAnswer {
  verdict: Verdict;
  spoken: string;
  waitHours?: number;
  interactions: Interaction[];
  /** Exactly what was sent to the cloud (for the on-screen receipt and the audit log). */
  sent: SanitisedPayload;
  matches: MedicineMatch[];
  /** Ingredients whose FDA label was used / not found. */
  grounded: string[];
  ungrounded: string[];
  labelSetIds: string[];
  where: typeof ROUTING_POLICY.check.where;
  inferenceSource: string;
  model: string;
}

/** The cloud check couldn't run (offline, App Check, quota…). Retry later; never fall back on-device. */
export class CheckUnavailableError extends Error {
  constructor(cause: unknown) {
    super(`Cloud check unavailable: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "CheckUnavailableError";
  }
}

export class CheckAnswerError extends Error {
  constructor(detail: string) {
    super(`Unusable answer from the cloud model: ${detail}`);
    this.name = "CheckAnswerError";
  }
}

const UNSURE_SPOKEN = "I'm not sure about this one. Please check with your pharmacist before taking it.";

/** Keep at most three sentences so the spoken answer stays short. */
export function limitSentences(text: string, max = 3): string {
  const sentences = text.replace(/\s+/g, " ").trim().match(/[^.!?]+[.!?]*/g) ?? [];
  return sentences.slice(0, max).join("").trim();
}

export function validateAnswer(
  raw: string,
  sent: SanitisedPayload,
): Pick<InteractionAnswer, "verdict" | "spoken" | "waitHours" | "interactions"> {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new CheckAnswerError("not JSON");
  }
  const verdict = parsed.verdict as Verdict;
  if (!VERDICTS.includes(verdict)) throw new CheckAnswerError("bad verdict");

  let spoken = typeof parsed.spoken === "string" ? limitSentences(parsed.spoken) : "";
  if (!spoken || spoken.length > 400) spoken = UNSURE_SPOKEN;

  const known = new Set([...sent.medicines, ...sent.cabinet]);
  const interactions: Interaction[] = Array.isArray(parsed.interactions)
    ? (parsed.interactions as Array<Record<string, unknown>>)
        .filter(
          (i) =>
            Array.isArray(i.between) &&
            i.between.length === 2 &&
            i.between.every((n) => typeof n === "string" && known.has(n)) &&
            ["minor", "moderate", "major"].includes(i.severity as string) &&
            typeof i.note === "string",
        )
        .map((i) => ({
          between: i.between as [string, string],
          severity: i.severity as Interaction["severity"],
          note: limitSentences(i.note as string, 2),
        }))
    : [];

  const w = parsed.waitHours;
  const waitHours = typeof w === "number" && Number.isInteger(w) && w > 0 && w <= 48 ? w : undefined;

  return verdict === "unsure"
    ? { verdict, spoken: spoken || UNSURE_SPOKEN, interactions, waitHours }
    : { verdict, spoken, interactions, waitHours };
}

/**
 * ON-DEVICE personalisation: the cloud only ever saw "calcium carbonate", but
 * Meera said "Tums". Swap the names she used back into the answer locally, so
 * she hears her own words without them ever having been sent.
 */
export function personaliseSpoken(spoken: string, matches: MedicineMatch[]): string {
  let out = spoken;
  for (const m of matches) {
    if (m.ingredients.length !== 1 || m.ingredients[0] === m.heard) continue;
    const ingredient = m.ingredients[0]!;
    const said = m.heard.replace(/\b[a-z]/g, (c) => c.toUpperCase());
    const re = new RegExp(`\\b${ingredient.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    out = out.replace(re, said);
  }
  return out;
}

type CheckModel = Pick<GenerativeModel, "generateContent">;

export interface CheckOptions {
  /** Inject models (tests). Tried in order. */
  models?: Array<{ name: string; model: CheckModel }>;
  /** Cloud model names to try in order (default DEFAULT_CHECK_MODELS; Remote Config can override). */
  modelNames?: readonly string[];
  maxOutputTokens?: number;
  fetchImpl?: typeof fetch;
}

export async function checkInteractions(request: OutboundRequest, opts: CheckOptions = {}): Promise<InteractionAnswer> {
  // 1. LEAK GUARD, here, immediately before the network. Throws LeakBlockedError.
  const { payload, matches, cabinetMatches } = assertSafeToSend(request);

  const candidates =
    opts.models ??
    (opts.modelNames ?? DEFAULT_CHECK_MODELS).map((name) => ({
      name,
      model: getGenerativeModel(getPillcheckAI(), checkParams(name, opts.maxOutputTokens)) as CheckModel,
    }));

  // 2. Grounding: FDA label excerpts for the sanitised names only (fetched once).
  const { excerpts, missing } = await fetchLabelExcerpts(
    [...payload.medicines, ...payload.cabinet],
    opts.fetchImpl,
  );

  // 3. Cloud call. The prompt is built ONLY from the sanitised payload + public label text.
  const prompt = JSON.stringify({
    asking_about: payload.medicines,
    already_taking: payload.cabinet,
    label_excerpts: excerpts.map((e: LabelExcerpt) => ({ ingredient: e.ingredient, text: e.text })),
  });

  // Try each cloud model in turn: a busy model (500/429) or an unusable answer
  // moves on to the next. There is deliberately NO on-device fallback here.
  let lastError: unknown;
  for (const { name, model } of candidates) {
    try {
      const result = await model.generateContent(prompt);
      // ONLY_IN_CLOUD should guarantee this; recording it keeps the audit log honest.
      const source = result.response.inferenceSource ?? InferenceSource.IN_CLOUD;

      // 4. Validate before anything is spoken.
      const answer = validateAnswer(result.response.text(), payload);

      return {
        ...answer,
        // Her names for BOTH the new medicine and the ones she already takes.
        spoken: personaliseSpoken(answer.spoken, [...matches, ...cabinetMatches]),
        sent: payload,
        matches,
        grounded: excerpts.map((e) => e.ingredient),
        ungrounded: missing,
        labelSetIds: excerpts.flatMap((e) => (e.setId ? [e.setId] : [])),
        where: ROUTING_POLICY.check.where,
        inferenceSource: source,
        model: name,
      };
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof CheckAnswerError ? lastError : new CheckUnavailableError(lastError);
}
