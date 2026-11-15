// Feature: eco-sentinel-frontend, Property 14: Concurrency limiter
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { createLimiter } from "@/lib/limiter";

import { propertyConfig } from "./propertyConfig";

type Outcome = "resolve" | "reject" | "abortQueued" | "abortRunning";

const tasks = fc.array(
  fc.record({
    ticks: fc.integer({ min: 0, max: 5 }),
    outcome: fc.constantFrom<Outcome>("resolve", "resolve", "reject", "abortQueued", "abortRunning"),
  }),
  { maxLength: 30 },
);

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("Property 14: Concurrency limiter", () => {
  it("never exceeds max, starts in order, runs every task not aborted while queued", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 20 }), tasks, async (max, specs) => {
        const run = createLimiter(max);
        let running = 0;
        let peak = 0;
        const started: number[] = [];
        const finished: number[] = [];
        const controllers = specs.map(() => new AbortController());

        const promises = specs.map((spec, index) =>
          run(async (signal) => {
            started.push(index);
            running += 1;
            peak = Math.max(peak, running);
            try {
              for (let i = 0; i < spec.ticks; i += 1) await tick();
              if (spec.outcome === "abortRunning") controllers[index]?.abort();
              if (signal?.aborted || spec.outcome === "reject") throw new Error(`task ${index} failed`);
              return index;
            } finally {
              running -= 1;
              finished.push(index);
            }
          }, controllers[index]?.signal).then(
            (value) => ({ index, ok: true as const, value }),
            (error: unknown) => ({ index, ok: false as const, error }),
          ),
        );
        // Abort queued tasks right away: only those not yet started are "aborted while queued".
        const abortedWhileQueued = new Set<number>();
        specs.forEach((spec, index) => {
          if (spec.outcome === "abortQueued" && !started.includes(index)) {
            abortedWhileQueued.add(index);
            controllers[index]?.abort();
          }
        });
        const results = await Promise.all(promises);

        expect(peak).toBeLessThanOrEqual(max);
        expect(running).toBe(0);
        // Submission order among the tasks that started.
        expect(started).toEqual([...started].sort((a, b) => a - b));
        for (const index of abortedWhileQueued) {
          expect(started).not.toContain(index);
          const result = results[index];
          expect(result?.ok).toBe(false);
          if (result && !result.ok) expect((result.error as Error).name).toBe("AbortError");
        }
        for (let index = 0; index < specs.length; index += 1) {
          if (abortedWhileQueued.has(index)) continue;
          expect(started).toContain(index);
          expect(finished).toContain(index);
          const spec = specs[index];
          // A task marked abortQueued that had already started is not aborted, so it resolves.
          expect(results[index]?.ok).toBe(spec?.outcome === "resolve" || spec?.outcome === "abortQueued");
        }
      }),
      propertyConfig,
    );
  });

  it("an already aborted signal rejects without starting", async () => {
    const run = createLimiter(1);
    const controller = new AbortController();
    controller.abort();
    let started = false;
    await expect(
      run(async () => {
        started = true;
      }, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(started).toBe(false);
  });
});
