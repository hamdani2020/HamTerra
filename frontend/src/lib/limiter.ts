/**
 * FIFO concurrency limiter (frontend design, Concurrency Limiter; Requirement 24.6).
 * At most `max` tasks run at once, tasks start in submission order, a task aborted while
 * queued never starts, and a slot is released when its task settles.
 */
export type Limited = <T>(task: (signal: AbortSignal | undefined) => Promise<T>, signal?: AbortSignal) => Promise<T>;

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error && signal.reason.name === "AbortError") return signal.reason;
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

interface Entry {
  start: () => void;
  cancelled: boolean;
}

export function createLimiter(max: number): Limited {
  if (!Number.isInteger(max) || max < 1) throw new RangeError("max must be a positive integer");
  let running = 0;
  const queue: Entry[] = [];

  function next(): void {
    while (running < max && queue.length > 0) {
      const entry = queue.shift();
      if (entry && !entry.cancelled) entry.start();
    }
  }

  return function run<T>(task: (signal: AbortSignal | undefined) => Promise<T>, signal?: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError(signal));
        return;
      }
      const entry: Entry = {
        cancelled: false,
        start: () => {
          signal?.removeEventListener("abort", onAbort);
          running += 1;
          let settled: Promise<T>;
          try {
            settled = task(signal);
          } catch (error) {
            settled = Promise.reject(error);
          }
          settled.then(resolve, reject).finally(() => {
            running -= 1;
            next();
          });
        },
      };
      function onAbort(): void {
        // Only reached while queued: the listener is removed when the task starts.
        entry.cancelled = true;
        const index = queue.indexOf(entry);
        if (index >= 0) queue.splice(index, 1);
        if (signal) reject(abortError(signal));
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      queue.push(entry);
      next();
    });
  };
}
