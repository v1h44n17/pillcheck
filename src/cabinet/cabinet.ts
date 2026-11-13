import { lookupMedicine } from "../data/lexicon";
import { normalizeTerm } from "../data/normalize";

/**
 * MEERA'S MEDICINE LIST ("the cabinet"), stored ON THIS DEVICE ONLY.
 *
 * Routing decision (see policy.ts → cabinet): the list lives in this browser's
 * localStorage, never in Firestore. A stored list of someone's medicines is
 * health data; the anonymous account is tied to this browser anyway, so cloud
 * storage would add risk without adding sync. The list only leaves the device
 * as canonical ingredient names inside a Step 3 check, after the leak guard.
 *
 * Only medicines the lexicon recognises can be stored, so the list can never
 * hold a name, a note or anything else free-form.
 */

export const CABINET_KEY = "pillcheck.cabinet.v1";
export const CABINET_MAX = 20; // matches the leak guard's cabinet limit

export interface CabinetItem {
  /** What Meera calls it ("coumadin"). Stays on the device. */
  heard: string;
  /** Canonical ingredients ("warfarin"). What a check may send. */
  ingredients: string[];
  addedAt: number;
}

export type AddResult =
  | { status: "added"; item: CabinetItem }
  | { status: "duplicate"; item: CabinetItem }
  | { status: "unknown"; term: string }
  | { status: "full" };

/** The bit of Web Storage we use, so tests can pass an in-memory version. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): KeyValueStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined; // storage blocked (private mode, policy): list works for this session only
  }
}

export class CabinetStore {
  private items: CabinetItem[];
  private listeners = new Set<() => void>();

  constructor(private readonly storage: KeyValueStorage | undefined = defaultStorage()) {
    this.items = this.load();
  }

  /** Re-validates everything read from storage: tampered or stale entries are dropped. */
  private load(): CabinetItem[] {
    let raw: unknown;
    try {
      raw = JSON.parse(this.storage?.getItem(CABINET_KEY) ?? "[]");
    } catch {
      return [];
    }
    if (!Array.isArray(raw)) return [];
    const out: CabinetItem[] = [];
    for (const r of raw as Array<Partial<CabinetItem>>) {
      const match = typeof r?.heard === "string" ? lookupMedicine(r.heard) : undefined;
      if (!match || out.some((i) => i.heard === match.heard)) continue;
      out.push({ heard: match.heard, ingredients: match.ingredients, addedAt: Number(r.addedAt) || 0 });
      if (out.length === CABINET_MAX) break;
    }
    return out;
  }

  private persist() {
    try {
      this.storage?.setItem(CABINET_KEY, JSON.stringify(this.items));
    } catch {
      // Quota or blocked storage: keep the in-memory list.
    }
    this.listeners.forEach((l) => l());
  }

  list(): readonly CabinetItem[] {
    return this.items;
  }

  /** Names to put in a check request; the leak guard maps them to ingredients. */
  namesForCheck(): string[] {
    return this.items.map((i) => i.heard);
  }

  add(term: string, now = Date.now()): AddResult {
    const match = lookupMedicine(term);
    if (!match) return { status: "unknown", term: normalizeTerm(term) };
    const existing = this.items.find(
      (i) => i.heard === match.heard || i.ingredients.join("+") === match.ingredients.join("+"),
    );
    if (existing) return { status: "duplicate", item: existing };
    if (this.items.length >= CABINET_MAX) return { status: "full" };
    const item: CabinetItem = { heard: match.heard, ingredients: match.ingredients, addedAt: now };
    this.items = [...this.items, item];
    this.persist();
    return { status: "added", item };
  }

  remove(heard: string): void {
    const next = this.items.filter((i) => i.heard !== heard);
    if (next.length === this.items.length) return;
    this.items = next;
    this.persist();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/** The app-wide store. */
export const cabinet = new CabinetStore();
