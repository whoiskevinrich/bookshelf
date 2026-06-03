import { useState, type FormEvent } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { confirmSignUp, resendCode } from "../../lib/auth";
import { AuthLayout } from "../../components/auth/AuthLayout";
import { Button } from "../../components/ui/Button";
import { inputClass, labelClass } from "../../lib/form-styles";

export function VerifyPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const emailFromState = (location.state as { email?: string } | null)?.email ?? "";

  const [email, setEmail] = useState(emailFromState);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await confirmSignUp(email, code);
      navigate("/auth/login", { state: { banner: "Email verified. You can now sign in." } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setResendMessage(null);
    setError(null);
    setResending(true);
    try {
      await resendCode(email);
      setResendMessage("New code sent to your email.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setResending(false);
    }
  }

  return (
    <AuthLayout
      title="Verify your email"
      subtitle={`Enter the 6-digit code sent to ${email || "your email"}.`}
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
        {resendMessage && (
          <div className="rounded-md bg-green-50 p-3 text-sm text-green-700 dark:bg-green-900/30 dark:text-green-400">
            {resendMessage}
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
            Verification code
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

        <Button type="submit" loading={loading} className="w-full">
          {loading ? "Verifying…" : "Verify email"}
        </Button>
      </form>

      <p className="text-center text-sm text-slate-600 dark:text-slate-400">
        Didn&apos;t receive a code?{" "}
        <button
          type="button"
          disabled={resending}
          onClick={() => {
            void handleResend();
          }}
          className="font-medium text-blue-600 hover:text-blue-500 disabled:opacity-50"
        >
          {resending ? "Sending…" : "Resend code"}
        </button>
        {" · "}
        <Link to="/auth/login" className="text-blue-600 hover:text-blue-500">
          Back to sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
