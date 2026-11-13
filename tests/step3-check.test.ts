import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteApp, initializeApp } from "firebase/app";
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } from "firebase/ai";
import { LeakBlockedError } from "../src/guards/leakGuard";
import {
  CheckAnswerError,
  checkInteractions,
  checkParams,
  CheckUnavailableError,
  limitSentences,
  personaliseSpoken,
  validateAnswer,
  type CheckOptions,
} from "../src/pipeline/step3-check";

type Models = NonNullable<CheckOptions["models"]>;

const ANSWER = JSON.stringify({
  verdict: "avoid",
  spoken: "Please don't take ibuprofen with warfarin. It raises your bleeding risk. Ask your pharmacist first.",
  interactions: [{ between: ["ibuprofen", "warfarin"], severity: "major", note: "Bleeding risk." }],
});

/** openFDA label API stub: one label per ingredient, with an interactions section. */
function labelFetch() {
  return vi.fn(async (url: string | URL | Request) => {
    const u = new URL(String(url));
    const ingredient = /"(.+)"/.exec(u.searchParams.get("search") ?? "")?.[1] ?? "?";
    return new Response(
      JSON.stringify({ results: [{ set_id: `set-${ingredient}`, drug_interactions: [`Label text for ${ingredient}.`] }] }),
      { status: 200 },
    );
  });
}

function model(text: string | Error) {
  const generateContent = vi.fn(async (_prompt: unknown) => {
    if (text instanceof Error) throw text;
    return { response: { inferenceSource: "in_cloud", text: () => text } };
  });
  return { generateContent };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Step 3 routing", () => {
  it("is pinned to ONLY_IN_CLOUD with a JSON schema and a system instruction", () => {
    const p = checkParams("some-model");
    expect(p.mode).toBe(InferenceMode.ONLY_IN_CLOUD);
    expect(p.inCloudParams?.model).toBe("some-model");
    expect(p.inCloudParams?.generationConfig?.responseMimeType).toBe("application/json");
    expect(p.inCloudParams?.systemInstruction).toBeTruthy();
  });
});

describe("checkInteractions: privacy", () => {
  it("runs the leak guard first: a leaky request reaches neither openFDA nor Gemini", async () => {
    const fetchImpl = labelFetch();
    const m = model(ANSWER);
    await expect(
      checkInteractions(
        { medicines: ["ibuprofen", "Meera Sharma"] },
        { fetchImpl, models: [{ name: "m", model: m }] as unknown as Models },
      ),
    ).rejects.toBeInstanceOf(LeakBlockedError);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(m.generateContent).not.toHaveBeenCalled();
  });

  it("sends only canonical ingredient names: not what Meera said", async () => {
    const fetchImpl = labelFetch();
    const m = model(ANSWER);
    await checkInteractions(
      { medicines: ["Advil"], cabinet: ["Coumadin"] },
      { fetchImpl, models: [{ name: "m", model: m }] as unknown as Models },
    );

    const prompt = String(m.generateContent.mock.calls[0]?.[0]);
    const sent = JSON.parse(prompt) as { asking_about: string[]; already_taking: string[] };
    expect(sent.asking_about).toEqual(["ibuprofen"]);
    expect(sent.already_taking).toEqual(["warfarin"]);
    expect(prompt.toLowerCase()).not.toContain("advil");
    expect(prompt.toLowerCase()).not.toContain("coumadin");

    const urls = fetchImpl.mock.calls.map(([u]) => decodeURIComponent(String(u)).replace(/\+/g, " "));
    expect(urls).toHaveLength(2);
    for (const u of urls) {
      expect(u).toMatch(/^https:\/\/api\.fda\.gov\/drug\/label\.json\?search=openfda\.generic_name:"(ibuprofen|warfarin)"&limit=5$/);
    }
  });
});

describe("checkInteractions: answers and failures", () => {
  it("returns a validated, grounded, personalised answer", async () => {
    const a = await checkInteractions(
      { medicines: ["Advil", "warfarin"] },
      { fetchImpl: labelFetch(), models: [{ name: "primary", model: model(ANSWER) }] as unknown as Models },
    );
    expect(a.verdict).toBe("avoid");
    expect(a.spoken).toBe("Please don't take Advil with warfarin. It raises your bleeding risk. Ask your pharmacist first.");
    expect(a.sent).toEqual({ medicines: ["ibuprofen", "warfarin"], cabinet: [] });
    expect(a.grounded).toEqual(["ibuprofen", "warfarin"]);
    expect(a.labelSetIds).toEqual(["set-ibuprofen", "set-warfarin"]);
    expect(a.model).toBe("primary");
    expect(a.inferenceSource).toBe("in_cloud");
  });

  it("uses her names for medicines on her list too (Coumadin, not warfarin)", async () => {
    const a = await checkInteractions(
      { medicines: ["Advil"], cabinet: ["Coumadin"] },
      { fetchImpl: labelFetch(), models: [{ name: "primary", model: model(ANSWER) }] as unknown as Models },
    );
    expect(a.sent).toEqual({ medicines: ["ibuprofen"], cabinet: ["warfarin"] });
    expect(a.spoken).toBe("Please don't take Advil with Coumadin. It raises your bleeding risk. Ask your pharmacist first.");
  });

  it("moves to the backup cloud model when the first is busy", async () => {
    const busy = model(new Error("[500] This model is currently experiencing high demand"));
    const backup = model(ANSWER);
    const a = await checkInteractions(
      { medicines: ["ibuprofen"] },
      {
        fetchImpl: labelFetch(),
        models: [
          { name: "busy", model: busy },
          { name: "backup", model: backup },
        ] as unknown as Models,
      },
    );
    expect(a.model).toBe("backup");
    expect(busy.generateContent).toHaveBeenCalledTimes(1);
  });

  it("CheckUnavailableError when every model fails; CheckAnswerError when answers are unusable", async () => {
    await expect(
      checkInteractions(
        { medicines: ["ibuprofen"] },
        { fetchImpl: labelFetch(), models: [{ name: "a", model: model(new Error("offline")) }] as unknown as Models },
      ),
    ).rejects.toBeInstanceOf(CheckUnavailableError);
    await expect(
      checkInteractions(
        { medicines: ["ibuprofen"] },
        { fetchImpl: labelFetch(), models: [{ name: "a", model: model("not json") }] as unknown as Models },
      ),
    ).rejects.toBeInstanceOf(CheckAnswerError);
  });

  it("still answers (ungrounded) when openFDA is down", async () => {
    const down = vi.fn(async () => new Response("", { status: 503 }));
    const a = await checkInteractions(
      { medicines: ["ibuprofen"] },
      { fetchImpl: down, models: [{ name: "a", model: model(ANSWER) }] as unknown as Models },
    );
    expect(a.grounded).toEqual([]);
    expect(a.ungrounded).toEqual(["ibuprofen"]);
  });
});

describe("validateAnswer", () => {
  const sent = { medicines: ["ibuprofen"], cabinet: ["warfarin"] };

  it("rejects bad JSON and bad verdicts", () => {
    expect(() => validateAnswer("nope", sent)).toThrow(CheckAnswerError);
    expect(() => validateAnswer(JSON.stringify({ verdict: "probably", spoken: "x" }), sent)).toThrow(CheckAnswerError);
  });

  it("keeps the spoken answer to three sentences and falls back when it's empty", () => {
    const long = validateAnswer(JSON.stringify({ verdict: "ok", spoken: "One. Two. Three. Four. Five." }), sent);
    expect(long.spoken).toBe("One. Two. Three.");
    const empty = validateAnswer(JSON.stringify({ verdict: "ok", spoken: "" }), sent);
    expect(empty.spoken).toMatch(/pharmacist/);
  });

  it("drops interactions naming medicines that weren't sent, and implausible wait times", () => {
    const v = validateAnswer(
      JSON.stringify({
        verdict: "caution",
        spoken: "Be careful.",
        waitHours: 400,
        interactions: [
          { between: ["ibuprofen", "warfarin"], severity: "major", note: "Bleeding." },
          { between: ["ibuprofen", "meera"], severity: "major", note: "Invented." },
          { between: ["ibuprofen"], severity: "minor", note: "Malformed." },
        ],
      }),
      sent,
    );
    expect(v.interactions.map((i) => i.between)).toEqual([["ibuprofen", "warfarin"]]);
    expect(v.waitHours).toBeUndefined();
  });

  it("limitSentences handles text without punctuation", () => {
    expect(limitSentences("no punctuation at all")).toBe("no punctuation at all");
  });
});

describe("personaliseSpoken (on-device)", () => {
  it("puts back the name Meera used, without it ever being sent", () => {
    const matches = [
      { heard: "tums", ingredients: ["calcium carbonate"], via: "brand" as const },
      { heard: "levothyroxine", ingredients: ["levothyroxine"], via: "ingredient" as const },
    ];
    expect(personaliseSpoken("Take levothyroxine four hours apart from calcium carbonate.", matches)).toBe(
      "Take levothyroxine four hours apart from Tums.",
    );
  });
});

describe("real Firebase AI Logic SDK", () => {
  it("ONLY_IN_CLOUD never uses Gemini Nano, even when it's available", async () => {
    const prompt = vi.fn();
    vi.stubGlobal("LanguageModel", {
      availability: vi.fn(async () => "available"),
      create: vi.fn(async () => ({ prompt, destroy: vi.fn() })),
    });
    const geminiBody: string[] = [];
    const labels = labelFetch();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url).includes("api.fda.gov")) return labels(url);
        geminiBody.push(String(init?.body));
        return new Response(
          JSON.stringify({ candidates: [{ index: 0, content: { role: "model", parts: [{ text: ANSWER }] } }] }),
          { status: 200 },
        );
      }),
    );

    const app = initializeApp({ apiKey: "test", projectId: "pillcheck-test", appId: "1:0:web:0" }, `step3-${Date.now()}`);
    try {
      const real = getGenerativeModel(getAI(app, { backend: new GoogleAIBackend() }), checkParams("test-model"));
      const a = await checkInteractions({ medicines: ["advil", "warfarin"] }, { models: [{ name: "test-model", model: real }] });

      expect(a.inferenceSource).toBe("in_cloud");
      expect(prompt).not.toHaveBeenCalled();
      expect(geminiBody).toHaveLength(1);
      const body = JSON.parse(geminiBody[0]!) as { contents: Array<{ parts: Array<{ text: string }> }> };
      const userText = body.contents.flatMap((c) => c.parts.map((p) => p.text)).join(" ");
      expect(JSON.parse(userText).asking_about).toEqual(["ibuprofen", "warfarin"]);
      expect(userText.toLowerCase()).not.toContain("advil");
    } finally {
      await deleteApp(app);
    }
  });
});
