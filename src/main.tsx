import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
// Atkinson Hyperlegible (Braille Institute), designed for low-vision readers.
// Bundled with the app: no request to a font CDN.
import "@fontsource/atkinson-hyperlegible/latin-400.css";
import "@fontsource/atkinson-hyperlegible/latin-700.css";
import "./styles/global.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from index.html");

// Dev-only console helpers (stripped from production: import.meta.env.DEV is false there).
//   await __pillcheck.extract("This is Meera, can I take Advil with my warfarin?")  // Step 2, Nano
//   await __pillcheck.check(["advil", "warfarin"])                                  // guard + Step 3, cloud
if (import.meta.env.DEV) {
  void Promise.all([import("./pipeline/step2-extract"), import("./pipeline/step3-check")]).then(
    ([{ extractMedicines }, { checkInteractions }]) => {
      Object.assign(globalThis, {
        __pillcheck: {
          extract: (t: string) => extractMedicines(t),
          check: (medicines: string[], cabinet?: string[]) => checkInteractions({ medicines, cabinet }),
        },
      });
    },
  );
}

const reactRoot = createRoot(root);

// Dev-only state gallery (?gallery): every screen with fixture data. Not in production builds.
if (import.meta.env.DEV && new URLSearchParams(location.search).has("gallery")) {
  void import("./dev/Gallery").then(({ Gallery }) =>
    reactRoot.render(
      <StrictMode>
        <Gallery />
      </StrictMode>,
    ),
  );
} else {
  reactRoot.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
