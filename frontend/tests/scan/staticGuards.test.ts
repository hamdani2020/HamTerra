import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const SRC = join(ROOT, "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|js|jsx|css|html)$/.test(name) ? [path] : [];
  });
}

const files = sourceFiles(SRC).map((path) => ({
  path: relative(ROOT, path).split(sep).join("/"),
  text: readFileSync(path, "utf8"),
}));

// Requirement 23.11 and 2.4: no provider host and no secret-like variable in the bundle.
const PROVIDER_HOSTS = [/agromonitoring\.com/i, /openweathermap\.org/i, /weatherapi\.com/i];
const SECRET_NAME = /\b[A-Za-z0-9_]*(SECRET|API_KEY)[A-Za-z0-9_]*\b/;

// Backend API paths may only be written in the endpoint module. In-app route paths share
// these prefixes (for example /areas/:areaId), so they live in one route module that is
// exempt as well. Both modules are created in later tasks.
const API_PREFIXES = ["/areas", "/admin", "/reports", "/observations", "/settings", "/me"];
const PATH_EXEMPT = new Set(["src/core/api/endpoints.ts", "src/lib/routes.ts"]);
const STRING_LITERAL = /(["'`])(\/[^"'`\s]*)\1/g;

export function apiPathLiterals(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(STRING_LITERAL)) {
    const value = match[2] ?? "";
    if (API_PREFIXES.some((p) => value === p || value.startsWith(`${p}/`) || value.startsWith(`${p}?`))) {
      found.push(value);
    }
  }
  return found;
}

describe("static guards", () => {
  it("finds source files to scan", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("references no AgroMonitoring or Weather API host", () => {
    const offenders = files
      .filter((f) => PROVIDER_HOSTS.some((host) => host.test(f.text)))
      .map((f) => f.path);
    expect(offenders, `provider host referenced in: ${offenders.join(", ")}`).toEqual([]);
  });

  it("declares no variable whose name contains SECRET or API_KEY", () => {
    const offenders = files.filter((f) => SECRET_NAME.test(f.text)).map((f) => f.path);
    expect(offenders, `secret-like name in: ${offenders.join(", ")}`).toEqual([]);
  });

  it("writes Backend API paths only in the endpoint module", () => {
    const offenders = files
      .filter((f) => !PATH_EXEMPT.has(f.path))
      .flatMap((f) => apiPathLiterals(f.text).map((p) => `${f.path}: ${p}`));
    expect(offenders, `API path literal outside endpoints.ts: ${offenders.join(", ")}`).toEqual(
      [],
    );
  });

  it("detects path literals (self-check of the scanner)", () => {
    expect(apiPathLiterals(`fetch("/areas/" + id); const x = '/admin/users?limit=1';`)).toEqual([
      "/areas/",
      "/admin/users?limit=1",
    ]);
    expect(apiPathLiterals(`"/areasx" "/meeting" "/" "/auth/callback"`)).toEqual([]);
  });
});

describe("dependency pinning (Requirement 22.12)", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const all = { ...pkg.dependencies, ...pkg.devDependencies };

  it("has dependencies to check", () => {
    expect(Object.keys(all).length).toBeGreaterThan(0);
  });

  it("uses exact versions for every direct dependency", () => {
    const ranged = Object.entries(all)
      .filter(([, version]) => /^[\^~><*]/.test(version) || !/^\d+\.\d+\.\d+/.test(version))
      .map(([name, version]) => `${name}@${version}`);
    expect(ranged, `version ranges found: ${ranged.join(", ")}`).toEqual([]);
  });

  it("commits a lock file", () => {
    expect(statSync(join(ROOT, "package-lock.json")).isFile()).toBe(true);
  });
});
