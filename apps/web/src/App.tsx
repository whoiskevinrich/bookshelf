import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AuthRoute } from "./components/AuthRoute";
import { LoginPage } from "./pages/auth/LoginPage";
import { SignUpPage } from "./pages/auth/SignUpPage";
import { VerifyPage } from "./pages/auth/VerifyPage";
import { ForgotPasswordPage } from "./pages/auth/ForgotPasswordPage";
import { ResetPasswordPage } from "./pages/auth/ResetPasswordPage";

// Placeholder — replaced when shelf feature is built
function ShelfPage() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  async function handleSignOut() {
    await signOut();
    navigate("/", { replace: true });
  }
  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">My Shelf</h1>
        <button onClick={() => { void handleSignOut(); }} className="text-sm text-gray-600 hover:text-gray-900">
          Sign out
        </button>
      </div>
      <p className="text-gray-600">Signed in as {user?.username}. Shelf coming soon.</p>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Auth routes — redirect to /shelf if already signed in */}
          <Route path="/auth/login" element={<AuthRoute><LoginPage /></AuthRoute>} />
          <Route path="/auth/signup" element={<AuthRoute><SignUpPage /></AuthRoute>} />
          <Route path="/auth/verify" element={<VerifyPage />} />
          <Route path="/auth/forgot-password" element={<AuthRoute><ForgotPasswordPage /></AuthRoute>} />
          <Route path="/auth/reset-password" element={<ResetPasswordPage />} />

          {/* Protected routes */}
          <Route path="/shelf" element={<ProtectedRoute><ShelfPage /></ProtectedRoute>} />
          <Route path="/wishlist" element={<ProtectedRoute><ShelfPage /></ProtectedRoute>} />
          <Route path="/search" element={<ProtectedRoute><ShelfPage /></ProtectedRoute>} />

          {/* Landing */}
          <Route path="/" element={<Navigate to="/shelf" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
