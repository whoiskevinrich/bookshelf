import { Link } from "react-router-dom";
import { ThemeToggle } from "./icons/ThemeIcons";
import { appButtonVariantClass } from "./ui/Button";

const navLinkClass =
  "text-sm text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white px-3 py-1.5 rounded transition-colors";

export function PublicHeader() {
  return (
    <header className="border-b border-slate-100 dark:border-slate-800 px-6 py-4 flex items-center justify-between bg-white dark:bg-slate-900 transition-colors">
      <Link
        to="/"
        className="font-semibold text-lg tracking-tight text-slate-900 dark:text-white hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
      >
        Bookshelf
      </Link>
      <nav aria-label="Site navigation" className="flex items-center gap-3">
        <ThemeToggle />
        <Link to="/about" className={navLinkClass}>
          About
        </Link>
        <Link to="/auth/login" className={navLinkClass}>
          Sign in
        </Link>
        <Link
          to="/auth/signup"
          className={`text-sm px-3 py-1.5 rounded font-medium transition-colors ${appButtonVariantClass}`}
        >
          Sign up
        </Link>
      </nav>
    </header>
  );
}
