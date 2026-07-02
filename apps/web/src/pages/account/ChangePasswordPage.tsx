import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { changePassword } from "../../lib/auth";
import { validatePassword } from "../../lib/passwordRules";
import { AppHeader } from "../../components/AppHeader";
import { PasswordChecklist } from "../../components/auth/PasswordChecklist";
import { Button } from "../../components/ui/Button";
import { inputClass, labelClass } from "../../lib/form-styles";

export function ChangePasswordPage() {
  const navigate = useNavigate();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const validationError =
      validatePassword(newPassword) ?? (newPassword !== confirm ? "Passwords do not match." : null);
    if (validationError) {
      setError(validationError);
      return;
    }
    setLoading(true);
    try {
      await changePassword(oldPassword, newPassword);
      setSuccess(true);
      setTimeout(() => void navigate("/account/settings"), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-paper-100 dark:bg-slate-900 transition-colors">
      <AppHeader />
      <main className="max-w-lg mx-auto px-6 py-10">
        <h1 className="text-2xl font-bold dark:text-white mb-8">Change password</h1>

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
          {success && (
            <div className="rounded-md bg-green-50 p-3 text-sm text-green-700 dark:bg-green-900/30 dark:text-green-400">
              Password updated. Redirecting…
            </div>
          )}

          <div>
            <label htmlFor="oldPassword" className={labelClass}>
              Current password
            </label>
            <input
              id="oldPassword"
              type="password"
              autoComplete="current-password"
              required
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="newPassword" className={labelClass}>
              New password
            </label>
            <input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={inputClass}
            />
            <PasswordChecklist password={newPassword} />
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

          <Button type="submit" loading={loading} disabled={success} className="w-full">
            {loading ? "Updating…" : "Update password"}
          </Button>
        </form>

        <p className="mt-4 text-center text-sm text-slate-600 dark:text-slate-400">
          <Link
            to="/account/settings"
            className="underline underline-offset-2 hover:no-underline hover:text-slate-700 dark:hover:text-slate-200"
          >
            Back to account settings
          </Link>
        </p>
      </main>
    </div>
  );
}
