/**
 * Colour contrast for older eyes: every text colour on every background must
 * meet WCAG AAA (7:1), in BOTH the light and the dark theme. Tokens are read
 * straight from the stylesheet, so a future colour tweak can't silently regress.
 */
/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Read the stylesheet from disk (Vitest doesn't process CSS imports by default).
const css = readFileSync(new URL("../src/styles/global.css", import.meta.url), "utf8");

function block(source: string, startMarker: string): Record<string, string> {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`marker not found: ${startMarker}`);
  const open = source.indexOf("{", start);
  const close = source.indexOf("}", open);
  const tokens: Record<string, string> = {};
  for (const m of source.slice(open + 1, close).matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) tokens[m[1]!] = m[2]!;
  return tokens;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) =>
    v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const light = block(css, ":root {");
const dark = { ...light, ...block(css, ':root:not([data-theme="light"]) {') };

const TEXT = ["ink", "ink-soft", "ok", "warn", "fail", "focus"];
const BACKGROUNDS = ["bg", "surface"];

describe.each([
  ["light", light],
  ["dark", dark],
])("%s theme", (_name, t) => {
  it("has every token defined", () => {
    for (const k of [...TEXT, ...BACKGROUNDS, "brand", "brand-ink"]) expect(t[k], k).toMatch(/^#/);
  });

  it.each(TEXT.flatMap((fg) => BACKGROUNDS.map((bg) => [fg, bg] as const)))("%s on %s ≥ 7:1 (AAA)", (fg, bg) => {
    expect(ratio(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(7);
  });

  it("big-button text on brand ≥ 7:1", () => {
    expect(ratio(t["brand-ink"]!, t.brand!)).toBeGreaterThanOrEqual(7);
  });

  it.each(["ok", "warn", "fail"])("verdict icon glyph (surface) on %s ≥ 4.5:1", (tone) => {
    expect(ratio(t.surface!, t[tone]!)).toBeGreaterThanOrEqual(4.5);
  });
});

it("never fades text with opacity (animations scale only)", () => {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  expect(withoutComments).not.toMatch(/opacity\s*:/);
});
