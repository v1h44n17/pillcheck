import { useSyncExternalStore } from "react";
import { cabinet, type CabinetItem } from "./cabinet";

/** The current medicine list; re-renders when it changes. */
export function useCabinet(): readonly CabinetItem[] {
  return useSyncExternalStore(
    (onChange) => cabinet.subscribe(onChange),
    () => cabinet.list(),
  );
}
