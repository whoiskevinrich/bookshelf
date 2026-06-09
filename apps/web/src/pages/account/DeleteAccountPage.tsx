import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { deleteAccount } from "../../lib/api-client";
import { useAuth } from "../../context/AuthContext";
import { AppHeader } from "../../components/AppHeader";
import { Button } from "../../components/ui/Button";
import { ApiError } from "../../lib/api-client";
import { inputClass, labelClass } from "../../lib/form-styles";

export function DeleteAccountPage() {
  const navigate = useNavigate();
  const { signOut, isGoogleUser } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleDelete(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await deleteAccount(isGoogleUser ? { confirmation } : { password });
      // signOut clears local Amplify session; Cognito account already gone so call may fail
      try {
        await signOut();
      } catch {
        // ignore — account is deleted, session will expire naturally
      }
      navigate("/auth/login", {
        state: { banner: "Your account has been permanently deleted." },
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError("Incorrect password. Please try again.");
      } else if (err instanceof ApiError && err.status === 429) {
        setError("Too many attempts. Please wait a moment and try again.");
      } else {
        setError(
          err instanceof Error ? err.message : "Failed to delete account. Please try again.",
        );
      }
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-white dark:bg-slate-900 transition-colors">
      <AppHeader />
      <main className="max-w-lg mx-auto px-6 py-10">
        <h1 className="text-2xl font-bold dark:text-white mb-2">Delete account</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-8">
          This will permanently erase your account and all books on your shelf. There is no undo.
        </p>

        <div className="rounded-lg border border-red-200 dark:border-red-900/40 p-4 mb-6">
          <p className="text-sm font-medium text-red-700 dark:text-red-400 mb-2">
            You will permanently lose:
          </p>
          <ul className="text-sm text-slate-500 dark:text-slate-400 list-disc list-inside space-y-1">
            <li>Your account and login access</li>
            <li>All books on your shelf and wishlist</li>
          </ul>
        </div>

        <form
          onSubmit={(e) => {
            void handleDelete(e);
          }}
          className="space-y-4"
        >
          {error && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400">
              {error}
            </div>
          )}

          {isGoogleUser ? (
            <div>
              <label htmlFor="confirmation" className={labelClass}>
                Type <strong>DELETE</strong> to confirm
              </label>
              <input
                id="confirmation"
                type="text"
                autoComplete="off"
                required
                autoFocus
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                className={inputClass}
              />
            </div>
          ) : (
            <div>
              <label htmlFor="password" className={labelClass}>
                Confirm your password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
              />
            </div>
          )}

          <div className="flex items-center gap-4">
            <Button type="submit" variant="danger" loading={loading}>
              {loading ? "Deleting…" : "Permanently delete my account"}
            </Button>
            <Link
              to="/account/settings"
              className="text-sm text-slate-500 dark:text-slate-400 underline underline-offset-2 hover:no-underline hover:text-slate-700 dark:hover:text-slate-200"
            >
              Cancel
            </Link>
          </div>
        </form>
      </main>
    </div>
  );
}
