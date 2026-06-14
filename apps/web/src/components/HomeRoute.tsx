import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { LandingPage } from "../pages/LandingPage";

/**
 * Root route `/`. Signed-in users go straight to their shelf — the landing page
 * is the marketing entry point for logged-out visitors only. Render nothing while
 * auth is resolving so a signed-in user never sees a marketing flash before the
 * redirect (mirrors AuthRoute).
 */
export function HomeRoute() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/shelf" replace />;
  return <LandingPage />;
}
