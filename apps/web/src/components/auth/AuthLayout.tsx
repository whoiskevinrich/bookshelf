import type { ReactNode } from "react";

interface AuthLayoutProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

export function AuthLayout({ title, subtitle, children }: AuthLayoutProps) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-zinc-900 px-4 transition-colors">
      <div className="w-full max-w-md space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Bookshelf</h1>
          <h2 className="mt-2 text-xl text-gray-600 dark:text-zinc-300">{title}</h2>
          {subtitle && <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}
