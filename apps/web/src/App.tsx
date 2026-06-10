import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "./context/ThemeContext";
import { AuthProvider } from "./context/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AuthRoute } from "./components/AuthRoute";
import { Footer } from "./components/Footer";
import { LandingPage } from "./pages/LandingPage";
import { AboutPage } from "./pages/AboutPage";
import { ShelfPage } from "./pages/ShelfPage";
import { WishlistPage } from "./pages/WishlistPage";
import { AccountSettingsPage } from "./pages/account/AccountSettingsPage";
import { ChangePasswordPage } from "./pages/account/ChangePasswordPage";
import { DeleteAccountPage } from "./pages/account/DeleteAccountPage";
import { LoginPage } from "./pages/auth/LoginPage";
import { OAuthCallbackPage } from "./pages/auth/OAuthCallbackPage";
import { SignUpPage } from "./pages/auth/SignUpPage";
import { VerifyPage } from "./pages/auth/VerifyPage";
import { ForgotPasswordPage } from "./pages/auth/ForgotPasswordPage";
import { ResetPasswordPage } from "./pages/auth/ResetPasswordPage";

export function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            {/* Public */}
            <Route path="/" element={<LandingPage />} />
            <Route path="/about" element={<AboutPage />} />

            {/* Auth routes — redirect to /shelf if already signed in */}
            <Route
              path="/auth/login"
              element={
                <AuthRoute>
                  <LoginPage />
                </AuthRoute>
              }
            />
            <Route
              path="/auth/signup"
              element={
                <AuthRoute>
                  <SignUpPage />
                </AuthRoute>
              }
            />
            <Route path="/auth/verify" element={<VerifyPage />} />
            <Route
              path="/auth/forgot-password"
              element={
                <AuthRoute>
                  <ForgotPasswordPage />
                </AuthRoute>
              }
            />
            <Route path="/auth/reset-password" element={<ResetPasswordPage />} />
            {/* OAuth callback — no auth wrapper; user is not yet signed in when this loads */}
            <Route path="/auth/callback" element={<OAuthCallbackPage />} />

            {/* Protected routes */}
            <Route
              path="/shelf"
              element={
                <ProtectedRoute>
                  <ShelfPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/wishlist"
              element={
                <ProtectedRoute>
                  <WishlistPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/account/settings"
              element={
                <ProtectedRoute>
                  <AccountSettingsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/account/change-password"
              element={
                <ProtectedRoute>
                  <ChangePasswordPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/account/delete"
              element={
                <ProtectedRoute>
                  <DeleteAccountPage />
                </ProtectedRoute>
              }
            />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <Footer />
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}
