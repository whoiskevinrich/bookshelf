import type { ReactNode } from "react";

interface AuthLayoutProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

export function AuthLayout({ title, subtitle, children }: AuthLayoutProps) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-paper-100 dark:bg-slate-900 px-4 transition-colors">
      <div className="w-full max-w-md space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Bookshelf</h1>
          <h2 className="mt-2 text-xl text-slate-600 dark:text-slate-300">{title}</h2>
          {subtitle && (
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{subtitle}</p>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
