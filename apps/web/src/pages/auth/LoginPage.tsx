import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { signIn } from "../../lib/auth";
import { useAuth } from "../../context/AuthContext";
import { AuthLayout } from "../../components/auth/AuthLayout";
import { Button } from "../../components/ui/Button";
import { inputClass, labelClass } from "../../lib/form-styles";

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { refreshAuth } = useAuth();

  const banner = (location.state as { banner?: string } | null)?.banner;
  const next = searchParams.get("next") ?? "/shelf";

  const [email, setEmail] = useState("");
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
              className="text-sm text-slate-500 dark:text-slate-400 underline underline-offset-2 hover:text-slate-900 dark:hover:text-white hover:no-underline"
            >
              Forgot password?
            </Link>
          </div>

          <Button type="submit" loading={loading} className="w-full">
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>

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
