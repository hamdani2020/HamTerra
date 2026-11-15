// Feature: eco-sentinel-frontend, Property 26: Report download is unmodified
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";

import { reportBlob, reportFileName, saveBlob } from "@/lib/download";

import { propertyConfig } from "./propertyConfig";

/** Blob contents as bytes, through FileReader (jsdom's Blob has no arrayBuffer). */
function bytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Property 26: Report download is unmodified", () => {
  it("saves the response text byte for byte, in a file named with the report ID", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(fc.json(), fc.string({ unit: "grapheme" }), fc.constant('{"a": 1,\n  "b":"ü → 日本"  }\r\n')),
        fc.oneof(fc.uuid(), fc.stringMatching(/^[A-Za-z0-9-]{1,20}$/)),
        async (raw, id) => {
          let saved: { blob: Blob; name: string } | null = null;
          vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
            saved = { blob: blob as Blob, name: "" };
            return "blob:report";
          });
          vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
          const clicks: string[] = [];
          vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
            clicks.push(this.download);
          });

          saveBlob(reportBlob(raw), reportFileName(id));

          expect(clicks).toHaveLength(1);
          expect(clicks[0]).toContain(id);
          expect(saved).not.toBeNull();
          const got = await bytes((saved as unknown as { blob: Blob }).blob);
          // Plain arrays: the two Uint8Arrays come from different realms (jsdom and Node).
          expect(Array.from(got)).toEqual(Array.from(new TextEncoder().encode(raw)));
          vi.restoreAllMocks();
        },
      ),
      propertyConfig,
    );
  });
});
