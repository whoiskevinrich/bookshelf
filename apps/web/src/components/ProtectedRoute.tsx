import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import type { ReactNode } from "react";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div
          role="status"
          aria-label="Loading"
          className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"
        />
      </div>
    );
  }

  if (!user) {
    return <Navigate to={`/auth/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  }

  return <>{children}</>;
}
