import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const nm = (p: string) => fileURLToPath(new URL(`./node_modules/${p}`, import.meta.url));

/**
 * Tests must exercise the SAME Firebase AI Logic build that ships to Chrome.
 *
 * Under Node, `firebase/ai` resolves to the SDK's Node build, which has no
 * on-device (Chrome Prompt API) adapter at all, so every hybrid call goes to
 * the cloud regardless of mode. That would make our routing tests meaningless.
 * We therefore let Vitest process Firebase itself and alias the AI package to
 * its browser ESM build.
 */
export default defineConfig({
  resolve: {
    alias: [
      { find: /^firebase\/ai$/, replacement: nm("firebase/ai/dist/esm/index.esm.js") },
      { find: /^@firebase\/ai$/, replacement: nm("@firebase/ai/dist/esm/index.esm.js") },
    ],
  },
  test: {
    environment: "node",
    server: { deps: { inline: [/firebase/] } },
  },
});
