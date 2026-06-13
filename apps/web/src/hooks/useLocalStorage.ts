import { useCallback, useState } from "react";

/**
 * State backed by `localStorage`. Generalizes the persistence approach used by
 * `ThemeContext` so small UI preferences survive reloads.
 *
 * `parse` validates and narrows the stored string back to `T`. Returning `null`
 * (missing, malformed, or a value that's no longer valid) falls back to
 * `initial` — so renaming or removing an option can never wedge the UI on a
 * stale stored value. Values are persisted with `String(value)`, so `T` should
 * be a string (enum) type.
 */
export function useLocalStorage<T extends string>(
  key: string,
  initial: T,
  parse: (raw: string) => T | null,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : (parse(raw) ?? initial);
    } catch {
      // localStorage can throw in private mode / sandboxed iframes.
      return initial;
    }
  });

  const set = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(key, next);
      } catch {
        // Storage unavailable (quota / private mode) — keep the in-memory value.
      }
    },
    [key],
  );

  return [value, set];
}
