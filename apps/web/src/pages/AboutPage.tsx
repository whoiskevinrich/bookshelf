import { PublicHeader } from "../components/PublicHeader";

const sectionHeadingClass =
  "text-xl font-semibold tracking-tight text-slate-900 dark:text-white mb-4";

export function AboutPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-slate-900 transition-colors">
      <PublicHeader />

      <main className="max-w-2xl mx-auto px-6 py-16">
        <article>
          <h1 className="text-4xl font-bold tracking-tight text-slate-900 dark:text-white mb-4">
            About Bookshelf
          </h1>
          <p className="text-lg text-slate-500 dark:text-slate-400 mb-12 max-w-xl">
            Bookshelf is two things at once: a real, usable app for tracking the books you own and
            want to read — and a live experiment in how far you can get building a web app almost
            entirely through conversation with Claude Code.
          </p>

          <section aria-labelledby="experiment-heading">
            <h2
              id="experiment-heading"
              className={sectionHeadingClass}
            >
              The experiment
            </h2>
            <div className="space-y-4">
              <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                The goal was simple: start from nothing and build as much of a production-quality
                web app as possible using Claude Code as the primary development tool. That means
                the architecture decisions, the CDK infrastructure, the API, the authentication
                flow, and the React frontend were all shaped through back-and-forth with an AI —
                not by writing code from scratch in an editor.
              </p>
              <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                Some things still required human judgment: deciding what to build, reviewing what
                the AI produced, catching mistakes, and steering when it went off course. But the
                heavy lifting — scaffolding, implementation, debugging — was largely delegated.
              </p>
              <p className="text-slate-600 dark:text-slate-400 leading-relaxed italic">
                This page exists because it seemed dishonest not to say so.
              </p>
            </div>
          </section>

          <section aria-labelledby="app-heading" className="mt-12">
            <h2
              id="app-heading"
              className={sectionHeadingClass}
            >
              What it does
            </h2>
            <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
              The app itself is straightforward: sign up, add books to your shelf (ones you own) or
              your wishlist (ones you want to read), and keep track of both. Nothing more.
            </p>
          </section>

          <footer className="mt-16 pt-6 border-t border-slate-100 dark:border-slate-800">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Built by{" "}
              <a
                href="https://github.com/whoiskevinrich"
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-900 dark:text-white underline hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              >
                Kevin Rich
              </a>
              . Source on{" "}
              <a
                href="https://github.com/whoiskevinrich/bookshelf"
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-900 dark:text-white underline hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              >
                GitHub
              </a>
              .
            </p>
          </footer>
        </article>
      </main>
    </div>
  );
}
