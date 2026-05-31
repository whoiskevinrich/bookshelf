import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import type { ReactNode } from "react";

/** Redirects already-authenticated users to /shelf. Use on auth pages (login, signup, etc.) */
export function AuthRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/shelf" replace />;
  return <>{children}</>;
}
