/**
 * Site-wide copyright footer. Rendered once at the app root so it appears on
 * every route, below each page's `min-h-screen` content.
 */
export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-slate-200 dark:border-slate-800 py-6">
      <p className="text-center text-sm text-slate-500 dark:text-slate-400">
        © {year} Bookshelf. All rights reserved.
      </p>
    </footer>
  );
}
