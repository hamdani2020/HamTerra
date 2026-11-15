import { useEffect, useState } from "react";

/** `value` after it has stopped changing for `delayMs` (the area search uses 300 ms). */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    // Nothing to wait for when the value has already settled.
    if (Object.is(value, debounced)) return undefined;
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs, debounced]);
  return debounced;
}
