import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { signIn, signInWithGoogle, safeNext } from "../../lib/auth";
import { useAuth } from "../../context/AuthContext";
import { AuthLayout } from "../../components/auth/AuthLayout";
import { Button } from "../../components/ui/Button";
import { inputClass, labelClass } from "../../lib/form-styles";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { refreshAuth } = useAuth();

  const banner = (location.state as { banner?: string } | null)?.banner;
  const next = safeNext(searchParams.get("next"));

  // Dev-only convenience: prefill the email (NOT a secret) so local QA against the
  // real Cognito pool skips retyping it on every reload. The `import.meta.env.DEV`
  // guard lets Vite dead-code-eliminate this in production builds, so neither the
  // prefill nor VITE_QA_EMAIL ships. The password is never prefilled — type it or
  // let the browser's password manager autofill it (see .env.example).
  const [email, setEmail] = useState(
    import.meta.env.DEV ? ((import.meta.env.VITE_QA_EMAIL as string | undefined) ?? "") : "",
  );
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await signIn(email, password);
      if (result.isSignedIn) {
        await refreshAuth();
        navigate(next, { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      {banner && (
        <div className="bg-green-50 border-b border-green-200 px-4 py-3 text-sm text-green-700 text-center dark:bg-green-900/30 dark:border-green-800 dark:text-green-400">
          {banner}
        </div>
      )}
      <AuthLayout title="Sign in to your account">
        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
          className="space-y-4"
        >
          {error && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400">
              {error}
              {error.includes("verify your email") && (
                <>
                  {" "}
                  <Link to="/auth/verify" className="font-medium underline">
                    Verify now
                  </Link>
                </>
              )}
            </div>
          )}

          <div>
            <label htmlFor="email" className={labelClass}>
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="password" className={labelClass}>
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
          </div>

          <div className="flex items-center justify-between">
            <Link
              to="/auth/forgot-password"
              className="text-sm text-slate-600 dark:text-slate-400 underline underline-offset-2 hover:text-slate-900 dark:hover:text-white hover:no-underline"
            >
              Forgot password?
            </Link>
          </div>

          <Button type="submit" loading={loading} className="w-full">
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-paper-400 dark:border-slate-700" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-paper-100 dark:bg-slate-900 px-3 text-slate-600 dark:text-slate-400 uppercase tracking-wide">
              or
            </span>
          </div>
        </div>

        <Button
          type="button"
          variant="secondary"
          className="w-full flex items-center justify-center gap-2"
          onClick={() => {
            setError(null);
            // On success the browser redirects away, so this promise only ever
            // settles on failure — surface it instead of failing silently.
            signInWithGoogle(next).catch((err: unknown) => {
              setError(
                err instanceof Error
                  ? err.message
                  : "Couldn't start Google sign-in. Please try again.",
              );
            });
          }}
        >
          <GoogleIcon />
          Continue with Google
        </Button>

        <p className="text-center text-sm text-slate-600 dark:text-slate-400">
          Don&apos;t have an account?{" "}
          <Link
            to="/auth/signup"
            className="font-medium underline underline-offset-2 text-slate-900 dark:text-white hover:no-underline"
          >
            Sign up
          </Link>
        </p>
      </AuthLayout>
    </div>
  );
}
