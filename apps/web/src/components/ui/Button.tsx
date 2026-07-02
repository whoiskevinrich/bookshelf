import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "app" | "secondary" | "ghost" | "destructive" | "danger";
  size?: "sm" | "md";
  loading?: boolean;
  children: ReactNode;
}

export const appButtonVariantClass =
  "bg-slate-900 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200 disabled:opacity-40";

const variantClasses: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: appButtonVariantClass,
  app: appButtonVariantClass,
  secondary:
    "border border-paper-500 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-paper-200 dark:hover:bg-slate-700 disabled:opacity-40",
  ghost:
    "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white disabled:opacity-40",
  destructive:
    "text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 disabled:opacity-40",
  danger:
    "bg-red-600 text-white hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-500 disabled:opacity-40",
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
      className={`rounded-lg font-medium transition-colors ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
