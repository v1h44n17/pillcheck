/**
 * Demo switches live in the URL (?simulate=…), the same flags the guards
 * already read, so a demo link can be shared and reloaded. Every flag can
 * only REMOVE a capability or ADD something the leak guard blocks, so
 * flipping them can make PillCheck refuse, never make it send more.
 */
export const DEMO_FLAGS = ["inject-pii", "no-nano", "no-speech"] as const;
export type DemoFlag = (typeof DEMO_FLAGS)[number];

export function activeFlags(search: string): DemoFlag[] {
  const set = new Set(
    new URLSearchParams(search)
      .getAll("simulate")
      .flatMap((v) => v.split(","))
      .map((v) => v.trim()),
  );
  return DEMO_FLAGS.filter((f) => set.has(f));
}

/** Returns a new query string with `flag` switched on or off; other parameters are kept. */
export function toggleSimulateFlag(search: string, flag: DemoFlag, on: boolean): string {
  const params = new URLSearchParams(search);
  const next = new Set(activeFlags(search));
  if (on) next.add(flag);
  else next.delete(flag);
  params.delete("simulate");
  if (next.size) params.set("simulate", [...next].join(","));
  const s = params.toString().replace(/%2C/g, ",");
  return s ? `?${s}` : "";
}
