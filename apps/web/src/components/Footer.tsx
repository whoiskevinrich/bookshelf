/**
 * Site-wide footer. Rendered once at the app root so it appears on every route,
 * below each page's `min-h-screen` content.
 *
 * Echoes the header's visual language for cohesion: the same `Bookshelf`
 * wordmark, the matching hairline border + surface, the page's `max-w-5xl`
 * content width, and a left/right composition that mirrors the header's
 * brand-and-nav layout (stacking centered on narrow screens).
 */
export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-paper-300 dark:border-slate-800 bg-paper-100 dark:bg-slate-900 transition-colors">
      <div className="max-w-5xl mx-auto px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-2">
        <span className="font-semibold tracking-tight text-slate-900 dark:text-white">
          Bookshelf
        </span>
        <p className="text-sm text-slate-600 dark:text-slate-400">© {year} Kevin Rich</p>
      </div>
    </footer>
  );
}
