import { useEffect, useRef, useState, type ReactNode } from "react";

/** Shared row styling for items placed inside the mobile menu panel. */
export const mobileMenuRowClass =
  "block w-full text-left px-4 py-3 text-sm text-slate-700 dark:text-slate-200 " +
  "hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors";

function HamburgerIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-6 h-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-6 h-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Hamburger toggle + drop-down panel for narrow screens (rendered below `sm`).
 * The panel is positioned against the nearest positioned ancestor — the header
 * must be `relative`. Closes on link/button tap (children bubble a click), on
 * Escape, on outside click, and when the viewport grows past `sm`; focus returns
 * to the toggle on keyboard close.
 */
export function MobileMenu({ children, label = "Menu" }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape closes and restores focus to the toggle.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        btnRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Outside click closes.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // The toggle is hidden at `sm`+, so an open panel would orphan — close it.
  useEffect(() => {
    if (!open) return;
    const mq = window.matchMedia("(min-width: 640px)");
    function onChange() {
      if (mq.matches) setOpen(false);
    }
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [open]);

  // Move focus into the panel on open.
  useEffect(() => {
    if (open) panelRef.current?.querySelector<HTMLElement>("a, button")?.focus();
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls="mobile-nav"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-center w-11 h-11 -mr-2 rounded text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white transition-colors"
      >
        {open ? <CloseIcon /> : <HamburgerIcon />}
      </button>
      {open && (
        <div
          id="mobile-nav"
          ref={panelRef}
          onClick={() => setOpen(false)}
          className="absolute left-0 right-0 top-full z-50 flex flex-col bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 shadow-sm animate-fade-up"
        >
          {children}
        </div>
      )}
    </>
  );
}
