import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "./context/ThemeContext";
import { ScannerPreferencesProvider } from "./context/ScannerPreferencesContext";
import { AuthProvider } from "./context/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AuthRoute } from "./components/AuthRoute";
import { HomeRoute } from "./components/HomeRoute";
import { Footer } from "./components/Footer";
import { AboutPage } from "./pages/AboutPage";
import { ShelfPage } from "./pages/ShelfPage";
import { SingleShelfPage } from "./pages/SingleShelfPage";
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
      <ScannerPreferencesProvider>
        <BrowserRouter>
          <AuthProvider>
            <Routes>
              {/* Public — `/` redirects signed-in users to their shelf */}
              <Route path="/" element={<HomeRoute />} />
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
                path="/shelves/:shelfId"
                element={
                  <ProtectedRoute>
                    <SingleShelfPage />
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
      </ScannerPreferencesProvider>
    </ThemeProvider>
  );
}
