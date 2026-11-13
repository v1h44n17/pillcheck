/// <reference types="node" />
/**
 * Build-level security guarantees.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sourceFiles(p) : /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

describe("secrets never reach the production bundle", () => {
  it("no source file uses import.meta.env as a whole object (it would inline every VITE_* value)", () => {
    const code = (f: string) =>
      readFileSync(f, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
        .replace(/(^|[^:])\/\/.*$/gm, "$1"); // line comments (not URLs)
    const offenders = sourceFiles(join(root, "src")).filter((f) => /import\.meta\.env(?!\.[A-Z_])/.test(code(f)));
    expect(offenders).toEqual([]);
  });
});

describe("Content Security Policy: where the browser lets data go", () => {
  const hosting = JSON.parse(readFileSync(join(root, "firebase.json"), "utf8")).hosting as {
    headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
  };
  const all = hosting.headers.flatMap((h) => h.headers);
  const csp = all.find((h) => h.key === "Content-Security-Policy")!.value;
  const directive = (name: string) =>
    csp
      .split(";")
      .map((d) => d.trim())
      .find((d) => d.startsWith(`${name} `))!
      .split(/\s+/)
      .slice(1);

  it("connect-src is exactly Firebase + openFDA (+ reCAPTCHA for App Check)", () => {
    expect(directive("connect-src").sort()).toEqual(
      [
        "'self'",
        "https://firebasevertexai.googleapis.com", // AI Logic (Step 3)
        "https://firestore.googleapis.com", // audit log
        "https://firebaseappcheck.googleapis.com",
        "https://content-firebaseappcheck.googleapis.com",
        "https://identitytoolkit.googleapis.com", // anonymous auth
        "https://securetoken.googleapis.com",
        "https://firebaseinstallations.googleapis.com", // Remote Config
        "https://firebaseremoteconfig.googleapis.com",
        "https://firebaseremoteconfigrealtime.googleapis.com",
        "https://api.fda.gov", // FDA labels (Step 3 grounding)
        "https://www.google.com/recaptcha/", // App Check attestation
      ].sort(),
    );
  });

  it("locks down everything else", () => {
    expect(directive("default-src")).toEqual(["'self'"]);
    expect(directive("object-src")).toEqual(["'none'"]);
    expect(directive("frame-ancestors")).toEqual(["'none'"]);
    expect(directive("form-action")).toEqual(["'none'"]);
  });

  it("only this site may use the microphone; camera and location are off", () => {
    const pp = all.find((h) => h.key === "Permissions-Policy")!.value;
    expect(pp).toContain("microphone=(self)");
    expect(pp).toContain("camera=()");
    expect(pp).toContain("geolocation=()");
  });
});
