import { describe, expect, it } from "vitest";

import { checkChunks, type ChunkInfo } from "../../config/chunkCheck";

const chunk = (fileName: string, extra: Partial<ChunkInfo> = {}): ChunkInfo => ({
  fileName,
  isEntry: false,
  isDynamicEntry: false,
  facadeModuleId: null,
  moduleIds: [],
  imports: [],
  ...extra,
});

/** The shape of a correct build: entry, admin chunk, map chunk, shared map hook chunk. */
function goodBuild(): ChunkInfo[] {
  return [
    chunk("index.js", { isEntry: true, facadeModuleId: "/app/index.html", moduleIds: ["/app/src/main.tsx", "/app/src/router.tsx"] }),
    chunk("admin.js", {
      isDynamicEntry: true,
      facadeModuleId: "/app/src/pages/admin/index.tsx",
      moduleIds: ["/app/src/pages/admin/index.tsx", "/app/src/features/admin/AdminUsersPage.tsx"],
      imports: ["index.js"],
    }),
    chunk("MapPage.js", { isDynamicEntry: true, facadeModuleId: "/app/src/pages/MapPage.tsx", moduleIds: ["/app/src/pages/MapPage.tsx"], imports: ["index.js", "useMap.js"] }),
    chunk("useMap.js", { moduleIds: ["/app/src/features/map/useMap.ts", "/app/node_modules/maplibre-gl/dist/maplibre-gl.js"], imports: ["index.js"] }),
    chunk("TimeSeriesPage.js", { isDynamicEntry: true, facadeModuleId: "/app/src/pages/TimeSeriesPage.tsx", moduleIds: ["/app/node_modules/recharts/es6/index.js"] }),
  ];
}

/** The build with one chunk changed. */
const patch = (build: ChunkInfo[], fileName: string, change: (c: ChunkInfo) => Partial<ChunkInfo>): ChunkInfo[] =>
  build.map((c) => (c.fileName === fileName ? { ...c, ...change(c) } : c));

describe("chunk check (Requirement 24.4)", () => {
  it("accepts separate lazy admin and map chunks", () => {
    expect(checkChunks(goodBuild())).toEqual([]);
  });

  it("reports MapLibre or Recharts reachable from the entry", () => {
    const problems = checkChunks(patch(goodBuild(), "index.js", () => ({ imports: ["useMap.js", "TimeSeriesPage.js"] })));
    expect(problems.some((p) => p.startsWith("maplibre-gl in the initial load"))).toBe(true);
    expect(problems.some((p) => p.startsWith("recharts in the initial load"))).toBe(true);
  });

  it("reports admin pages bundled into the entry", () => {
    const build = goodBuild().filter((c) => c.fileName !== "admin.js");
    const problems = checkChunks(patch(build, "index.js", (c) => ({ moduleIds: [...c.moduleIds, "/app/src/pages/admin/index.tsx"] })));
    expect(problems).toContain("the admin pages are not a lazy chunk");
    expect(problems.some((p) => p.startsWith("admin pages in the initial load"))).toBe(true);
  });

  it("reports admin and map pages that load each other", () => {
    expect(checkChunks(patch(goodBuild(), "admin.js", () => ({ imports: ["index.js", "MapPage.js"] })))).toContain("the admin chunk loads the map page");
  });
});
