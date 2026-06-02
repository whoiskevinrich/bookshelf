import { Link } from "react-router-dom";
import { DemoShelf } from "../components/demo/DemoShelf";
import { ThemeToggle } from "../components/icons/ThemeIcons";

export function LandingPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-zinc-900 transition-colors">
      <header className="border-b border-gray-100 dark:border-zinc-800 px-6 py-4 flex items-center justify-between">
        <span className="font-semibold text-lg tracking-tight dark:text-white">Bookshelf</span>
        <nav aria-label="Site navigation" className="flex items-center gap-3">
          <ThemeToggle />
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
        </nav>
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
          <p className="text-sm text-gray-500 dark:text-zinc-400 tracking-wide mb-6 text-center">
            See what your shelf could look like
          </p>
          <DemoShelf />
        </div>

        <div className="mt-8 text-center space-y-2">
          <p className="text-sm text-gray-500 dark:text-zinc-400">Ready to track your books?</p>
          <Link
            to="/auth/signup"
            className="text-sm font-medium text-gray-900 dark:text-white underline hover:text-gray-600 dark:hover:text-zinc-300 transition-colors"
          >
            Sign up →
          </Link>
        </div>
      </main>
    </div>
  );
}
