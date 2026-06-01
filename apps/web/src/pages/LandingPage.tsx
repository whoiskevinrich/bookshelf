import { Link } from "react-router-dom";
import { DemoShelf } from "../components/demo/DemoShelf";
import { useTheme } from "../context/ThemeContext";

function SunIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

export function LandingPage() {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-900 transition-colors">
      <header className="border-b border-gray-100 dark:border-zinc-800 px-6 py-4 flex items-center justify-between">
        <span className="font-semibold text-lg tracking-tight dark:text-white">Bookshelf</span>
        <div className="flex items-center gap-3">
          <button
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            className="text-gray-500 hover:text-gray-900 dark:text-zinc-400 dark:hover:text-white transition-colors"
          >
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </button>
          <Link
            to="/auth/login"
            className="text-sm text-gray-600 hover:text-gray-900 dark:text-zinc-300 dark:hover:text-white px-3 py-1.5 rounded transition-colors"
          >
            Sign in
          </Link>
          <Link
            to="/auth/signup"
            className="text-sm bg-gray-900 text-white px-3 py-1.5 rounded hover:bg-gray-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200 transition-colors"
          >
            Sign up
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-16">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold tracking-tight text-gray-900 dark:text-white mb-4">
            Your personal bookshelf
          </h1>
          <p className="text-lg text-gray-500 dark:text-zinc-400 max-w-xl mx-auto mb-8">
            Track the books you own and the ones you want to read next. Simple, fast, yours.
          </p>
          <Link
            to="/auth/signup"
            className="inline-block bg-gray-900 text-white px-6 py-3 rounded-lg text-sm font-medium hover:bg-gray-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200 transition-colors"
          >
            Sign up to build your shelf
          </Link>
        </div>

        <div className="bg-gray-50 dark:bg-zinc-800 rounded-2xl p-8">
          <p className="text-xs font-medium text-gray-400 dark:text-zinc-500 uppercase tracking-widest mb-6 text-center">
            Example shelf
          </p>
          <DemoShelf />
        </div>
      </main>
    </div>
  );
}
