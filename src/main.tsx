import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/global.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from index.html");

// Dev-only console helper: try Step 2 on Gemini Nano without speaking, e.g.
//   await __pillcheck.extract("This is Meera, can I take Advil with my warfarin?")
// Stripped from production builds (import.meta.env.DEV is false there).
if (import.meta.env.DEV) {
  void import("./pipeline/step2-extract").then(({ extractMedicines }) => {
    Object.assign(globalThis, { __pillcheck: { extract: (t: string) => extractMedicines(t) } });
  });
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
