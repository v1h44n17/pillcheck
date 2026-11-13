import { useEffect, useState } from "react";
import { activeFlags, toggleSimulateFlag, type DemoFlag } from "../demo/demoFlags";

const SWITCHES: Array<{ flag: DemoFlag; label: string; shows: string }> = [
  {
    flag: "inject-pii",
    label: "Add a fake name and birthday",
    shows: "The privacy check stops the question before anything is sent.",
  },
  {
    flag: "no-nano",
    label: "Pretend there's no on-device AI",
    shows: "PillCheck refuses out loud instead of using the cloud.",
  },
];

function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    addEventListener("online", on);
    addEventListener("offline", off);
    return () => {
      removeEventListener("online", on);
      removeEventListener("offline", off);
    };
  }, []);
  return online;
}

/**
 * Presenter controls, shown only with ?demo in the URL. The three demo beats:
 *   1. leak guard blocks a fake patient name,
 *   2. no on-device AI → loud refusal,
 *   3. offline → "Hear it again" still works (local voice).
 */
export function DemoPanel({ onFlagsChanged }: { onFlagsChanged: () => void }) {
  const [flags, setFlags] = useState<DemoFlag[]>(() => activeFlags(location.search));
  const online = useOnline();

  function toggle(flag: DemoFlag) {
    const on = !flags.includes(flag);
    const search = toggleSimulateFlag(location.search, flag, on);
    history.replaceState(null, "", `${location.pathname}${search}${location.hash}`);
    setFlags(activeFlags(search));
    onFlagsChanged();
  }

  return (
    <section className="demo-panel" aria-labelledby="demo-title">
      <h2 id="demo-title">Demo controls</h2>
      <ul className="demo-switches">
        {SWITCHES.map(({ flag, label, shows }) => {
          const on = flags.includes(flag);
          return (
            <li key={flag}>
              <button type="button" className={`demo-switch${on ? " is-on" : ""}`} aria-pressed={on} onClick={() => toggle(flag)}>
                <span className="demo-switch-state">{on ? "ON" : "OFF"}</span>
                {label}
              </button>
              <span className="demo-shows">{shows}</span>
            </li>
          );
        })}
        <li>
          <span className={`demo-net${online ? "" : " is-offline"}`}>Network: {online ? "online" : "OFFLINE"}</span>
          <span className="demo-shows">
            Turn Wi-Fi off after an answer, then press “Hear it again”: the voice runs on this computer.
          </span>
        </li>
      </ul>
    </section>
  );
}
