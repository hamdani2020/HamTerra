import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { hexToChannels, TOKENS } from "@/styles/tokens";

const ROOT = join(__dirname, "..", "..");
const globals = readFileSync(join(ROOT, "src/styles/globals.css"), "utf8");

function files(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path, pattern);
    return pattern.test(name) ? [path] : [];
  });
}

describe("design tokens (Requirements 21.1, 21.2, 21.6, 21.10, 21.11, 21.14)", () => {
  it("declares every token in globals.css with the value from tokens.ts", () => {
    for (const [name, hex] of Object.entries(TOKENS)) {
      const match = globals.match(new RegExp(`--${name}:\\s*([0-9 ]+);`));
      expect(match, `--${name} missing from globals.css`).not.toBeNull();
      expect(match?.[1]?.trim(), `--${name}`).toBe(hexToChannels(hex));
    }
  });

  it("keeps status colours distinct from the primary and secondary emerald", () => {
    const status = ["status-success", "status-warning", "status-error", "status-info"] as const;
    for (const name of status) {
      expect(TOKENS[name]).not.toBe(TOKENS["emerald-700"]);
      expect(TOKENS[name]).not.toBe(TOKENS["emerald-600"]);
    }
  });

  it("uses one card shadow with blur at most 8 px and opacity at most 10%", () => {
    const shadow = globals.match(/--shadow-card:\s*([^;]+);/)?.[1] ?? "";
    // offset-x offset-y blur colour, e.g. "0 1px 3px rgb(15 23 42 / 0.08)"
    const [, blur, alpha] = shadow.match(/^\S+ \S+ (\d+)px rgb\([^/]+\/\s*([0-9.]+)\)$/) ?? [];
    expect(blur, `unexpected shadow: ${shadow}`).toBeDefined();
    expect(Number(blur)).toBeLessThanOrEqual(8);
    expect(Number(alpha)).toBeLessThanOrEqual(0.1);
  });

  it("has exactly one gradient, a background gradient", () => {
    const css = files(join(ROOT, "src"), /\.css$/).map((f) => readFileSync(f, "utf8")).join("\n");
    const tsx = files(join(ROOT, "src"), /\.tsx?$/).map((f) => readFileSync(f, "utf8")).join("\n");
    expect(css.match(/gradient\(/g)?.length).toBe(1);
    expect(css).toMatch(/background-image:\s*linear-gradient/);
    expect(tsx).not.toMatch(/bg-gradient-|gradient\(/);
  });

  it("turns off animation and transition for reduced motion", () => {
    expect(globals).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none !important;[\s\S]*transition: none !important;/,
    );
  });

  it("uses no transition or animation longer than 200 ms", () => {
    for (const file of files(join(ROOT, "src"), /\.(tsx?|css)$/)) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/duration-(\d+)/g)) {
        expect(Number(match[1]), `${file}: ${match[0]}`).toBeLessThanOrEqual(200);
      }
    }
  });

  it("requests no fonts or scripts from other hosts", () => {
    const sources = [
      readFileSync(join(ROOT, "index.html"), "utf8"),
      ...files(join(ROOT, "src"), /\.css$/).map((f) => readFileSync(f, "utf8")),
    ].join("\n");
    expect(sources).not.toMatch(/@import\s+url\(\s*["']?https?:/);
    expect(sources).not.toMatch(/<script[^>]+src=["']https?:/);
    expect(sources).not.toMatch(/<link[^>]+href=["']https?:/);
  });

  it("prints content without navigation and keeps caveats visible", () => {
    const print = readFileSync(join(ROOT, "src/styles/print.css"), "utf8");
    expect(print).toMatch(/@media print/);
    expect(print).toMatch(/nav,[\s\S]*display: none !important/);
    expect(print).toMatch(/\[data-print="show"\][\s\S]*display: block !important/);
  });
});
