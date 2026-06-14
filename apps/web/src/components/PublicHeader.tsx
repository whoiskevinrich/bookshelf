import { Link } from "react-router-dom";
import { ThemeToggle } from "./icons/ThemeIcons";
import { appButtonVariantClass } from "./ui/Button";
import { MobileMenu, mobileMenuRowClass } from "./MobileMenu";

const navLinkClass =
  "text-sm text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white px-3 py-1.5 rounded transition-colors";

export function PublicHeader() {
  return (
    <header className="relative border-b border-slate-100 dark:border-slate-800 px-4 sm:px-6 py-4 flex items-center justify-between bg-white dark:bg-slate-900 transition-colors">
      <Link
        to="/"
        className="font-semibold text-lg tracking-tight text-slate-900 dark:text-white hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
      >
        Bookshelf
      </Link>

      {/* Inline nav — sm and up */}
      <nav aria-label="Site navigation" className="hidden sm:flex items-center gap-3">
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

      {/* Mobile cluster — below sm */}
      <div className="flex items-center gap-1 sm:hidden">
        <ThemeToggle />
        <MobileMenu>
          <Link to="/about" className={mobileMenuRowClass}>
            About
          </Link>
          <Link to="/auth/login" className={mobileMenuRowClass}>
            Sign in
          </Link>
          <Link
            to="/auth/signup"
            className={`${mobileMenuRowClass} font-medium text-slate-900 dark:text-white border-t border-slate-100 dark:border-slate-800`}
          >
            Sign up
          </Link>
        </MobileMenu>
      </div>
    </header>
  );
}
