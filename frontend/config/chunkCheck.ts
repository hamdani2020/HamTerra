/**
 * Build-time chunk check (Requirement 24.4). The admin pages and the map page must be
 * separate lazy chunks, and neither they nor MapLibre or Recharts may load with the entry.
 * Pure, so it is unit tested; `chunkCheckPlugin` runs it on every production build.
 */
import type { Plugin } from "vite";

export interface ChunkInfo {
  fileName: string;
  isEntry: boolean;
  isDynamicEntry: boolean;
  facadeModuleId: string | null;
  moduleIds: readonly string[];
  /** Static imports, by file name. */
  imports: readonly string[];
}

const ADMIN_PAGES = /[\\/]src[\\/]pages[\\/]admin[\\/]index\.tsx$/;
const MAP_PAGE = /[\\/]src[\\/]pages[\\/]MapPage\.tsx$/;

/** Modules that must never load with the entry chunk. */
export const LAZY_ONLY: readonly { name: string; pattern: RegExp }[] = [
  { name: "admin pages", pattern: /[\\/]src[\\/]pages[\\/]admin[\\/]/ },
  { name: "admin features", pattern: /[\\/]src[\\/]features[\\/]admin[\\/]/ },
  { name: "map page", pattern: MAP_PAGE },
  { name: "maplibre-gl", pattern: /[\\/]node_modules[\\/]maplibre-gl[\\/]/ },
  { name: "recharts", pattern: /[\\/]node_modules[\\/]recharts[\\/]/ },
];

function closure(start: readonly ChunkInfo[], byFile: Map<string, ChunkInfo>): ChunkInfo[] {
  const seen = new Map<string, ChunkInfo>();
  const stack = [...start];
  while (stack.length > 0) {
    const chunk = stack.pop() as ChunkInfo;
    if (seen.has(chunk.fileName)) continue;
    seen.set(chunk.fileName, chunk);
    for (const file of chunk.imports) {
      const next = byFile.get(file);
      if (next) stack.push(next);
    }
  }
  return [...seen.values()];
}

/** Returns one message per problem; an empty list means the split is as required. */
export function checkChunks(chunks: readonly ChunkInfo[]): string[] {
  const problems: string[] = [];
  const byFile = new Map(chunks.map((c) => [c.fileName, c]));
  const entries = chunks.filter((c) => c.isEntry);
  if (entries.length === 0) problems.push("no entry chunk");

  const initial = closure(entries, byFile);
  for (const { name, pattern } of LAZY_ONLY) {
    const hit = initial.find((c) => c.moduleIds.some((id) => pattern.test(id)));
    if (hit) problems.push(`${name} in the initial load (chunk ${hit.fileName})`);
  }

  const admin = chunks.find((c) => c.facadeModuleId !== null && ADMIN_PAGES.test(c.facadeModuleId));
  const map = chunks.find((c) => c.facadeModuleId !== null && MAP_PAGE.test(c.facadeModuleId));
  if (!admin?.isDynamicEntry) problems.push("the admin pages are not a lazy chunk");
  if (!map?.isDynamicEntry) problems.push("the map page is not a lazy chunk");
  if (admin && map) {
    if (admin.fileName === map.fileName) problems.push("the admin pages and the map page share a chunk");
    if (closure([admin], byFile).some((c) => c.moduleIds.some((id) => MAP_PAGE.test(id)))) {
      problems.push("the admin chunk loads the map page");
    }
    if (closure([map], byFile).some((c) => c.moduleIds.some((id) => ADMIN_PAGES.test(id)))) {
      problems.push("the map chunk loads the admin pages");
    }
  }
  return problems;
}

/** Fails `vite build` when `checkChunks` reports a problem. */
export function chunkCheckPlugin(): Plugin {
  return {
    name: "eco-chunk-check",
    apply: "build",
    generateBundle(_options, bundle) {
      const chunks: ChunkInfo[] = [];
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue;
        chunks.push({
          fileName: output.fileName,
          isEntry: output.isEntry,
          isDynamicEntry: output.isDynamicEntry,
          facadeModuleId: output.facadeModuleId,
          moduleIds: output.moduleIds,
          imports: output.imports,
        });
      }
      const problems = checkChunks(chunks);
      if (problems.length > 0) this.error(`Chunk check failed (Requirement 24.4): ${problems.join("; ")}`);
    },
  };
}
