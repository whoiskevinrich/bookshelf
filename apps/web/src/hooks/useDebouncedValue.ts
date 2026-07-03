import { useEffect, useState } from "react";

/**
 * Return `value` delayed by `delayMs` — the debounced copy only updates once the
 * input has been stable for that long. Used to keep expensive work (filtering the
 * whole library on every keystroke) off the typing hot path.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
