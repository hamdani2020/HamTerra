/** Every bundled observation preview by file name. Only URLs: an image loads when shown. */
export const PREVIEW_URLS: Record<string, string> = Object.fromEntries(
  Object.entries(import.meta.glob<string>("./previews/*.png", { eager: true, query: "?url", import: "default" })).map(([path, url]) => [
    path.slice(path.lastIndexOf("/") + 1),
    url,
  ]),
);
