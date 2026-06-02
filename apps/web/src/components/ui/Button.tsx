import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "app" | "secondary" | "ghost" | "destructive";
  size?: "sm" | "md";
  loading?: boolean;
  children: ReactNode;
}

const variantClasses: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary:
    "bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50",
  app: "bg-gray-900 text-white hover:bg-gray-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200 disabled:opacity-40",
  secondary:
    "border border-gray-300 dark:border-zinc-600 text-gray-700 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-700 disabled:opacity-40",
  ghost:
    "text-gray-500 hover:text-gray-900 dark:text-zinc-400 dark:hover:text-white disabled:opacity-40",
  destructive:
    "text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 disabled:opacity-40",
};

const sizeClasses: Record<NonNullable<ButtonProps["size"]>, string> = {
  sm: "px-2.5 py-1 text-xs",
  md: "px-4 py-2 text-sm",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  children,
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      disabled={disabled ?? loading}
      className={`rounded-md font-medium transition-colors ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
