import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { ScannerPreferencesProvider, useScannerPreferences } from "./ScannerPreferencesContext";

function wrapper({ children }: { children: ReactNode }) {
  return <ScannerPreferencesProvider>{children}</ScannerPreferencesProvider>;
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("ScannerPreferencesContext — scanDestination (BOOKSHELF-58)", () => {
  it("defaults to owned when nothing is stored", () => {
    const { result } = renderHook(() => useScannerPreferences(), { wrapper });
    expect(result.current.scanDestination).toBe("owned");
  });

  it("persists a change and preselects it on the next open (remount)", () => {
    const first = renderHook(() => useScannerPreferences(), { wrapper });
    act(() => first.result.current.setScanDestination("want"));
    expect(window.localStorage.getItem("scanner:destination")).toBe("want");

    // A fresh provider (reopening the scanner) reads the remembered destination.
    const second = renderHook(() => useScannerPreferences(), { wrapper });
    expect(second.result.current.scanDestination).toBe("want");
  });

  it("falls back to owned for a malformed / legacy stored value", () => {
    window.localStorage.setItem("scanner:destination", "somewhere-else");
    const { result } = renderHook(() => useScannerPreferences(), { wrapper });
    expect(result.current.scanDestination).toBe("owned");
  });
});

describe("ScannerPreferencesContext — scanShelfId (BOOKSHELF-85)", () => {
  it("defaults to null (no shelf) when nothing is stored", () => {
    const { result } = renderHook(() => useScannerPreferences(), { wrapper });
    expect(result.current.scanShelfId).toBeNull();
  });

  it("persists a chosen shelf id and round-trips through localStorage", () => {
    const first = renderHook(() => useScannerPreferences(), { wrapper });
    act(() => first.result.current.setScanShelfId("shelf-123"));
    expect(window.localStorage.getItem("scanner:shelfId")).toBe("shelf-123");

    const second = renderHook(() => useScannerPreferences(), { wrapper });
    expect(second.result.current.scanShelfId).toBe("shelf-123");
  });

  it("clearing back to null stores an empty string, not the literal 'null'", () => {
    const { result } = renderHook(() => useScannerPreferences(), { wrapper });
    act(() => result.current.setScanShelfId("shelf-123"));
    act(() => result.current.setScanShelfId(null));
    expect(result.current.scanShelfId).toBeNull();
    expect(window.localStorage.getItem("scanner:shelfId")).toBe("");
  });
});
