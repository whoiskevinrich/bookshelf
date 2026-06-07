import { useState, type FormEvent } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { confirmResetPassword } from "../../lib/auth";
import { validatePassword } from "../../lib/passwordRules";
import { AuthLayout } from "../../components/auth/AuthLayout";
import { PasswordChecklist } from "../../components/auth/PasswordChecklist";
import { Button } from "../../components/ui/Button";
import { inputClass, labelClass } from "../../lib/form-styles";

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const emailFromState = (location.state as { email?: string } | null)?.email ?? "";

  const [email, setEmail] = useState(emailFromState);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const validationError =
      validatePassword(password) ?? (password !== confirm ? "Passwords do not match." : null);
    if (validationError) {
      setError(validationError);
      return;
    }
    setLoading(true);
    try {
      await confirmResetPassword(email, code, password);
      navigate("/auth/login", { state: { banner: "Password updated. Please sign in." } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      title="Set a new password"
      subtitle={`Enter the code sent to ${email || "your email"} and your new password.`}
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

        {!emailFromState && (
          <div>
            <label htmlFor="email" className={labelClass}>
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
          </div>
        )}

        <div>
          <label htmlFor="code" className={labelClass}>
            Reset code
          </label>
          <input
            id="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            autoFocus
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className={`${inputClass} tracking-widest text-center text-lg`}
          />
        </div>

        <div>
          <label htmlFor="password" className={labelClass}>
            New password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
          <PasswordChecklist password={password} />
        </div>

        <div>
          <label htmlFor="confirm" className={labelClass}>
            Confirm new password
          </label>
          <input
            id="confirm"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={inputClass}
          />
        </div>

        <Button type="submit" loading={loading} className="w-full">
          {loading ? "Updating password…" : "Update password"}
        </Button>
      </form>

      <p className="text-center text-sm text-slate-600 dark:text-slate-400">
        <Link
          to="/auth/login"
          className="font-medium underline underline-offset-2 text-slate-900 dark:text-white hover:no-underline"
        >
          Back to sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
