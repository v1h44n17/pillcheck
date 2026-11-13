import { getApp } from "firebase/app";
import { fetchAndActivate, getAll, getRemoteConfig } from "firebase/remote-config";

/**
 * REMOTE CONFIG: tune PillCheck without shipping a new build, but NEVER weaken it.
 *
 * Deliberately, there is no key that can:
 *   - move a step between device and cloud (routing modes are hard-coded),
 *   - disable the on-device guard or the leak guard,
 *   - loosen what may be sent.
 * Every value is validated and clamped here; anything invalid falls back to the
 * built-in default. The worst a bad or hostile config can do is pause checks
 * (which makes PillCheck refuse, never leak) or pick another Gemini model.
 */

export const DEFAULT_CHECK_MODELS = ["gemini-3.5-flash-lite", "gemini-3.8-flash"];

/** In-app defaults. remoteconfig.template.json mirrors these. */
export const RC_DEFAULTS = {
  step3_cloud_models: JSON.stringify(DEFAULT_CHECK_MODELS),
  step3_max_output_tokens: 1024,
  listen_max_ms: 15_000,
  checks_paused: false,
  checks_paused_message: "",
} as const;

export type ConfigSource = "defaults" | "remote" | "cached";

export interface PillcheckConfig {
  checkModels: string[];
  maxOutputTokens: number;
  listenMaxMs: number;
  checksPaused: boolean;
  pausedMessage: string;
  source: ConfigSource;
}

const DEFAULT_PAUSED_MESSAGE =
  "PillCheck is taking a short break. Please ask your pharmacist about your medicine.";

const MODEL_NAME = /^gemini-[a-z0-9.\-]{1,40}$/;

function clamp(n: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

/** Pure: raw Remote Config strings → a validated config. Exported for tests. */
export function parseConfig(raw: Partial<Record<keyof typeof RC_DEFAULTS, string>>, source: ConfigSource): PillcheckConfig {
  let models: string[] = DEFAULT_CHECK_MODELS;
  try {
    const parsed: unknown = JSON.parse(raw.step3_cloud_models ?? "");
    // All-or-nothing: one bad entry means the whole list is ignored. Then keep the first 4.
    if (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every((m): m is string => typeof m === "string" && MODEL_NAME.test(m))
    ) {
      models = [...new Set(parsed)].slice(0, 4);
    }
  } catch {
    // keep defaults
  }

  const pausedRaw = (raw.checks_paused_message ?? "").replace(/[<>]/g, "").trim().slice(0, 200);

  return {
    checkModels: models,
    maxOutputTokens: clamp(Number(raw.step3_max_output_tokens), 256, 2048, RC_DEFAULTS.step3_max_output_tokens),
    listenMaxMs: clamp(Number(raw.listen_max_ms), 5_000, 30_000, RC_DEFAULTS.listen_max_ms),
    checksPaused: raw.checks_paused === "true",
    pausedMessage: pausedRaw || DEFAULT_PAUSED_MESSAGE,
    source,
  };
}

const stringDefaults = Object.fromEntries(
  Object.entries(RC_DEFAULTS).map(([k, v]) => [k, String(v)]),
) as Record<keyof typeof RC_DEFAULTS, string>;

let current: PillcheckConfig = parseConfig(stringDefaults, "defaults");

/** The config in effect right now (defaults until loadPillcheckConfig() finishes). */
export function getConfig(): PillcheckConfig {
  return current;
}

/**
 * Fetches and activates Remote Config. Never throws: on any failure (offline,
 * App Check, unsupported) PillCheck keeps its safe built-in defaults.
 */
export async function loadPillcheckConfig(): Promise<PillcheckConfig> {
  try {
    const rc = getRemoteConfig(getApp());
    rc.settings.minimumFetchIntervalMillis = import.meta.env.DEV ? 30_000 : 60 * 60 * 1000;
    rc.settings.fetchTimeoutMillis = 5_000;
    rc.defaultConfig = { ...RC_DEFAULTS };
    const fetched = await fetchAndActivate(rc);
    const all = getAll(rc);
    const raw = Object.fromEntries(Object.keys(RC_DEFAULTS).map((k) => [k, all[k]?.asString() ?? ""]));
    const anyRemote = Object.keys(RC_DEFAULTS).some((k) => all[k]?.getSource() === "remote");
    current = parseConfig(raw, anyRemote ? (fetched ? "remote" : "cached") : "defaults");
  } catch {
    // keep defaults
  }
  return current;
}
