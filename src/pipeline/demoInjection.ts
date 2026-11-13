/**
 * DEMO: prove the leak guard works.
 *
 * `?simulate=inject-pii` appends a fictional patient's name and date of birth
 * to Gemini Nano's output, i.e. it simulates the on-device model leaking
 * personal details. The leak guard must then block the cloud call.
 *
 * Safe to leave enabled in production: it only ever ADDS things the guard
 * blocks, so it can make PillCheck refuse, never make it send more.
 */
export const DEMO_PII = ["Meera Sharma", "12/03/1951"] as const;

export function demoInjectionEnabled(search: string = globalThis.location?.search ?? ""): boolean {
  return new URLSearchParams(search)
    .getAll("simulate")
    .flatMap((v) => v.split(","))
    .some((v) => v.trim() === "inject-pii");
}

export function withDemoInjection(medicines: string[], search?: string): { medicines: string[]; injected: boolean } {
  if (!demoInjectionEnabled(search)) return { medicines, injected: false };
  return { medicines: [...medicines, ...DEMO_PII], injected: true };
}
