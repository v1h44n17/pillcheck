import {
  getGenerativeModel,
  InferenceMode,
  type GenerativeModel,
  type HybridParams,
  type InferenceSource,
} from "firebase/ai";
import { getPillcheckAI } from "../firebase/ai";
import {
  assertNanoReady,
  assertRanOnDevice,
  NANO_CREATE_OPTIONS,
  readSimulation,
  type Simulation,
} from "../guards/onDeviceGuard";
import { ROUTING_POLICY } from "./policy";

/**
 * STEP 2: understand the question ON-DEVICE (Gemini Nano via Firebase AI Logic).
 *
 * This is the "privacy airlock". The full transcript, which may contain a
 * name, a date of birth or a dose, goes IN; only a short list of medicine
 * names comes OUT. Only that list may continue towards the cloud (Step 3), and
 * only after the leak guard (Day 5) has checked it.
 *
 * Routing decisions:
 *   - mode: InferenceMode.ONLY_ON_DEVICE (see policy.ts → extract)
 *   - BEFORE the call: assertNanoReady(). The SDK sends ONLY_ON_DEVICE requests
 *     to the cloud when Nano is missing (tests/sdkFallthrough.test.ts), so the
 *     transcript must never reach the SDK unless Nano is ready.
 *   - AFTER the call: assertRanOnDevice(response.inferenceSource).
 *
 * SDK detail (verified in @firebase/ai@3.1.0): on-device calls ignore
 * `systemInstruction`. Only `createOptions` and the request contents reach
 * Chrome's Prompt API, so the instructions live in `initialPrompts`.
 */

const MAX_MEDICINES = 5;
const MAX_NAME_LENGTH = 40;

const SYSTEM_PROMPT = [
  "You extract medicine names from a short question that an older person asked out loud.",
  'Reply with JSON only, in the form {"medicines": ["..."]}.',
  "Include ONLY names of medicines (generic or brand), lowercase, spelled correctly.",
  "Fix obvious speech-recognition misspellings, e.g. 'ibuprofin' becomes 'ibuprofen'.",
  "NEVER include people's names, dates, ages, doses, amounts, times, places, phone numbers or any other words.",
  'If no medicine is mentioned, reply {"medicines": []}.',
].join(" ");

/** Few-shot examples, including one that deliberately contains personal details. */
const EXAMPLES: Array<[string, string[]]> = [
  ["Can I take ibuprofen?", ["ibuprofen"]],
  ["Is it okay to have Tylenol with my warfarin", ["tylenol", "warfarin"]],
  ["This is Meera, born March third, can I take two aspirin at 8pm with my lisinopril", ["aspirin", "lisinopril"]],
  ["what's the weather like today", []],
];

/** JSON Schema passed to Chrome's Prompt API as `responseConstraint`. */
export const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    medicines: {
      type: "array",
      items: { type: "string", maxLength: MAX_NAME_LENGTH },
      maxItems: MAX_MEDICINES,
    },
  },
  required: ["medicines"],
  additionalProperties: false,
} as const;

export const EXTRACTION_PARAMS: HybridParams = {
  mode: InferenceMode.ONLY_ON_DEVICE,
  onDeviceParams: {
    createOptions: {
      ...NANO_CREATE_OPTIONS,
      initialPrompts: [
        { role: "system", content: [{ type: "text", value: SYSTEM_PROMPT }] },
        ...EXAMPLES.flatMap(([q, meds]) => [
          { role: "user" as const, content: [{ type: "text" as const, value: q }] },
          {
            role: "assistant" as const,
            content: [{ type: "text" as const, value: JSON.stringify({ medicines: meds }) }],
          },
        ]),
      ],
    },
    promptOptions: { responseConstraint: EXTRACTION_SCHEMA },
  },
};

export interface Extraction {
  medicines: string[];
  where: typeof ROUTING_POLICY.extract.where;
  inferenceSource: InferenceSource;
}

export class ExtractionError extends Error {
  constructor(detail: string) {
    super(`Couldn't read the on-device model's answer: ${detail}`);
    this.name = "ExtractionError";
  }
}

type ExtractionModel = Pick<GenerativeModel, "generateContent">;

let defaultModel: ExtractionModel | undefined;
function extractionModel(): ExtractionModel {
  defaultModel ??= getGenerativeModel(getPillcheckAI(), EXTRACTION_PARAMS);
  return defaultModel;
}

/**
 * First-pass clean-up of what Nano returned. NOT the leak guard: Day 5 adds a
 * drug-lexicon allowlist plus PII detection before anything reaches the cloud.
 * This just drops anything that obviously isn't a medicine name.
 */
export function sanitiseNames(values: unknown[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    if (typeof v !== "string") continue;
    const name = v.trim().toLowerCase().replace(/\s+/g, " ");
    if (!name || name.length > MAX_NAME_LENGTH) continue;
    if (!/^[a-z][a-z \-]*[a-z]$/.test(name)) continue; // letters, spaces, hyphens only: no digits, @, /, etc.
    if (!out.includes(name)) out.push(name);
    if (out.length === MAX_MEDICINES) break;
  }
  return out;
}

export function parseExtraction(text: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ExtractionError("not JSON");
  }
  const medicines = (parsed as { medicines?: unknown } | null)?.medicines;
  if (!Array.isArray(medicines)) throw new ExtractionError("missing medicines array");
  return sanitiseNames(medicines);
}

export async function extractMedicines(
  transcript: string,
  opts: { model?: ExtractionModel; sim?: Simulation } = {},
): Promise<Extraction> {
  // 1. BEFORE: the transcript must not reach the SDK unless Nano is ready.
  await assertNanoReady(opts.sim ?? readSimulation());

  const model = opts.model ?? extractionModel();
  const result = await model.generateContent(transcript);

  // 2. AFTER: prove it actually ran on this device.
  const source = result.response.inferenceSource;
  assertRanOnDevice(source);

  return {
    medicines: parseExtraction(result.response.text()),
    where: ROUTING_POLICY.extract.where,
    inferenceSource: source as InferenceSource,
  };
}
