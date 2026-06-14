import { Link } from "react-router-dom";
import { DemoShelf } from "../components/demo/DemoShelf";
import { PublicHeader } from "../components/PublicHeader";

export function LandingPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-slate-900 transition-colors">
      <PublicHeader />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
        <div className="text-center mb-8 sm:mb-12">
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight text-slate-900 dark:text-white mb-4">
            Your personal bookshelf
          </h1>
          <p className="text-base sm:text-lg text-slate-500 dark:text-slate-400 max-w-xl mx-auto mb-8">
            Track the books you own and the ones you want to read next. Simple, fast, yours.
          </p>
          <Link
            to="/auth/signup"
            className="inline-block bg-slate-900 text-white px-6 py-3 rounded-lg text-sm font-medium hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200 transition-colors"
          >
            Sign up to build your shelf
          </Link>
        </div>

        <div className="bg-slate-50 dark:bg-slate-800 rounded-2xl p-4 sm:p-8">
          <p className="text-sm text-slate-500 dark:text-slate-400 tracking-wide mb-6 text-center">
            See what your shelf could look like
          </p>
          <DemoShelf />
        </div>

        <div className="mt-8 text-center space-y-2">
          <p className="text-sm text-slate-500 dark:text-slate-400">Ready to track your books?</p>
          <Link
            to="/auth/signup"
            className="text-sm font-medium text-slate-900 dark:text-white underline hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          >
            Sign up →
          </Link>
        </div>
      </main>
    </div>
  );
}
