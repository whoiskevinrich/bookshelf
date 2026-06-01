import { Link } from "react-router-dom";
import { DemoShelf } from "../components/demo/DemoShelf";

export function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-gray-100 px-6 py-4 flex items-center justify-between">
        <span className="font-semibold text-lg tracking-tight">Bookshelf</span>
        <div className="flex gap-3">
          <Link
            to="/auth/login"
            className="text-sm text-gray-600 hover:text-gray-900 px-3 py-1.5 rounded transition-colors"
          >
            Sign in
          </Link>
          <Link
            to="/auth/signup"
            className="text-sm bg-gray-900 text-white px-3 py-1.5 rounded hover:bg-gray-700 transition-colors"
          >
            Sign up
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-16">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold tracking-tight text-gray-900 mb-4">
            Your personal bookshelf
          </h1>
          <p className="text-lg text-gray-500 max-w-xl mx-auto mb-8">
            Track the books you own and the ones you want to read next. Simple, fast, yours.
          </p>
          <Link
            to="/auth/signup"
            className="inline-block bg-gray-900 text-white px-6 py-3 rounded-lg text-sm font-medium hover:bg-gray-700 transition-colors"
          >
            Sign up to build your shelf
          </Link>
        </div>

        <div className="bg-gray-50 rounded-2xl p-8">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-widest mb-6 text-center">
            Example shelf
          </p>
          <DemoShelf />
        </div>
      </main>
    </div>
  );
}
