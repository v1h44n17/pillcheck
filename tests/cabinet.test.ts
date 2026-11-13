import { afterEach, describe, expect, it, vi } from "vitest";
import { addByVoice, addSummary, type AddByVoiceDeps, type AddEvent } from "../src/cabinet/addByVoice";
import { CABINET_KEY, CABINET_MAX, CabinetStore, type KeyValueStorage } from "../src/cabinet/cabinet";
import { OnDeviceUnavailableError } from "../src/guards/onDeviceGuard";
import { REFUSAL_SPOKEN } from "../src/pipeline/messages";
import type { ListenHandle } from "../src/pipeline/step1-transcribe";

function memoryStorage(initial?: string): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>(initial ? [[CABINET_KEY, initial]] : []);
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CabinetStore (on-device medicine list)", () => {
  it("adds known medicines with their canonical ingredients and persists them", () => {
    const storage = memoryStorage();
    const store = new CabinetStore(storage);
    expect(store.add("Coumadin", 1)).toEqual({
      status: "added",
      item: { heard: "coumadin", ingredients: ["warfarin"], addedAt: 1 },
    });
    expect(JSON.parse(storage.data.get(CABINET_KEY)!)).toEqual([{ heard: "coumadin", ingredients: ["warfarin"], addedAt: 1 }]);
    expect(new CabinetStore(storage).list()).toHaveLength(1); // survives a reload
  });

  it("refuses anything the lexicon doesn't recognise: no free text can be stored", () => {
    const store = new CabinetStore(memoryStorage());
    expect(store.add("Meera Sharma")).toEqual({ status: "unknown", term: "meera sharma" });
    expect(store.add("take with food")).toMatchObject({ status: "unknown" });
    expect(store.list()).toEqual([]);
  });

  it("treats a brand and its generic as the same medicine", () => {
    const store = new CabinetStore(memoryStorage());
    store.add("coumadin");
    expect(store.add("warfarin")).toMatchObject({ status: "duplicate", item: { heard: "coumadin" } });
    expect(store.add("Coumadin")).toMatchObject({ status: "duplicate" });
  });

  it(`holds at most ${CABINET_MAX}`, () => {
    const names = [
      "warfarin", "lisinopril", "metformin", "atorvastatin", "levothyroxine", "amlodipine", "omeprazole",
      "gabapentin", "sertraline", "furosemide", "metoprolol", "losartan", "simvastatin", "aspirin",
      "clopidogrel", "donepezil", "tamsulosin", "prednisone", "alendronate", "digoxin", "acetaminophen",
    ];
    const store = new CabinetStore(memoryStorage());
    const results = names.map((n) => store.add(n).status);
    expect(results.filter((s) => s === "added")).toHaveLength(CABINET_MAX);
    expect(results.at(-1)).toBe("full");
  });

  it("removes by name and notifies subscribers", () => {
    const store = new CabinetStore(memoryStorage());
    store.add("coumadin");
    const listener = vi.fn();
    store.subscribe(listener);
    store.remove("coumadin");
    expect(store.list()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("re-validates stored data on load: tampered entries are dropped, ingredients come from the lexicon", () => {
    const tampered = JSON.stringify([
      { heard: "coumadin", ingredients: ["something-else"], addedAt: 1 },
      { heard: "Meera Sharma, DOB 1951", ingredients: [], addedAt: 2 },
      { nonsense: true },
      { heard: "coumadin", ingredients: ["warfarin"], addedAt: 3 },
    ]);
    const store = new CabinetStore(memoryStorage(tampered));
    expect(store.list()).toEqual([{ heard: "coumadin", ingredients: ["warfarin"], addedAt: 1 }]);
    expect(new CabinetStore(memoryStorage("{not json")).list()).toEqual([]);
  });

  it("works for the session when storage is blocked", () => {
    const blocked: KeyValueStorage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
    };
    const store = new CabinetStore(blocked);
    expect(store.add("aspirin").status).toBe("added");
    expect(store.namesForCheck()).toEqual(["aspirin"]);
  });
});

describe("addByVoice (Steps 1–2 only)", () => {
  function deps(medicines: string[] | Error, store = new CabinetStore(memoryStorage())) {
    const speak = vi.fn(async (_t: string) => true);
    const d: AddByVoiceDeps = {
      listen: () =>
        ({
          result: Promise.resolve({ text: "I take Coumadin and Lipitor", where: "on-device" }),
          stop: vi.fn(),
          cancel: vi.fn(),
        }) as unknown as ListenHandle,
      extract: vi.fn(async () => {
        if (medicines instanceof Error) throw medicines;
        return { medicines, where: "on-device" as const, inferenceSource: "on_device" as const };
      }),
      speak,
      store,
    };
    return { d, speak, store };
  }

  it("adds what Nano heard, says so, and never touches the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { d, speak, store } = deps(["coumadin", "lipitor"]);
    const events: AddEvent[] = [];
    await addByVoice(d, (e) => events.push(e)).done;

    expect(store.list().map((i) => i.heard)).toEqual(["coumadin", "lipitor"]);
    expect(speak).toHaveBeenCalledWith("I added Coumadin and Lipitor to your medicines.");
    expect(events.map((e) => e.type)).toEqual(["listening", "understanding", "added"]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("explains unknown names and duplicates", () => {
    expect(
      addSummary([
        { status: "added", item: { heard: "lipitor", ingredients: ["atorvastatin"], addedAt: 0 } },
        { status: "duplicate", item: { heard: "coumadin", ingredients: ["warfarin"], addedAt: 0 } },
        { status: "unknown", term: "flibbertigibbet" },
      ]),
    ).toBe(
      "I added Lipitor to your medicines. Coumadin is already on your list. I don't know a medicine called flibbertigibbet. Please check the name.",
    );
  });

  it("refuses out loud when on-device understanding isn't available", async () => {
    const { d, speak, store } = deps(new OnDeviceUnavailableError("nano", "api-missing"));
    const events: AddEvent[] = [];
    await addByVoice(d, (e) => events.push(e)).done;
    expect(events.at(-1)).toEqual({ type: "refused" });
    expect(speak).toHaveBeenCalledWith(REFUSAL_SPOKEN);
    expect(store.list()).toEqual([]);
  });
});
