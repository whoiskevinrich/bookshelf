import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { resetPassword } from "../../lib/auth";
import { AuthLayout } from "../../components/auth/AuthLayout";
import { Button } from "../../components/ui/Button";
import { inputClass, labelClass } from "../../lib/form-styles";

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await resetPassword(email);
      navigate("/auth/reset-password", { state: { email } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="Enter your email and we'll send you a reset code."
    >
      <form
        onSubmit={(e) => {
          void handleSubmit(e);
        }}
        className="space-y-4"
      >
        {error && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400">
            {error}
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

        <Button type="submit" loading={loading} className="w-full">
          {loading ? "Sending…" : "Send reset code"}
        </Button>
      </form>

      <p className="text-center text-sm text-gray-600 dark:text-zinc-400">
        <Link to="/auth/login" className="font-medium text-indigo-600 hover:text-indigo-500">
          Back to sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
