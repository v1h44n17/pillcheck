import { defineConfig } from "vitest/config";

/** Firestore rules tests only. Run via `npm run test:rules` (starts the emulator). */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/rules/**/*.test.ts"],
    testTimeout: 20_000,
  },
});
