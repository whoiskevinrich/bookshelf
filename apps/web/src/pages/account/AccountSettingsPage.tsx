import { Link } from "react-router-dom";
import { AppHeader } from "../../components/AppHeader";
import { Button } from "../../components/ui/Button";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { useAuth } from "../../context/AuthContext";
import { useScannerPreferences } from "../../context/ScannerPreferencesContext";
import { getRuntimeConfig } from "../../lib/runtime-config";

export function AccountSettingsPage() {
  const { user, isGoogleUser } = useAuth();
  const scannerEnabled = getRuntimeConfig().features.scanner;
  const { postScanBehavior, scanMode, setPostScanBehavior, setScanMode } = useScannerPreferences();

  return (
    <div className="min-h-screen bg-white dark:bg-slate-900 transition-colors">
      <AppHeader />
      <main className="max-w-lg mx-auto px-6 py-10">
        <h1 className="text-2xl font-bold dark:text-white mb-8">Account</h1>

        <section className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
            Email address
          </p>
          <p className="text-sm text-slate-900 dark:text-white">{user?.username}</p>
        </section>

        {!isGoogleUser && (
          <section className="mb-8">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-3">
              Security
            </h2>
            <Link
              to="/account/change-password"
              className="text-sm text-slate-700 dark:text-slate-300 underline underline-offset-2 hover:no-underline hover:text-slate-900 dark:hover:text-white"
            >
              Change password
            </Link>
          </section>
        )}

        {scannerEnabled && (
          <section className="mb-8">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-3">
              Scanner
            </h2>
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm text-slate-900 dark:text-white">After scanning</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Confirm each book, or add straight to your shelf.
                  </p>
                </div>
                <SegmentedControl
                  label="After scanning"
                  value={postScanBehavior}
                  onChange={setPostScanBehavior}
                  options={[
                    { value: "confirm", label: "Confirm" },
                    { value: "autoAddOwned", label: "Auto-add" },
                  ]}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm text-slate-900 dark:text-white">Scan mode</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    One book at a time, or keep scanning a whole shelf.
                  </p>
                </div>
                <SegmentedControl
                  label="Scan mode"
                  value={scanMode}
                  onChange={setScanMode}
                  options={[
                    { value: "single", label: "Single" },
                    { value: "continuous", label: "Continuous" },
                  ]}
                />
              </div>
            </div>
          </section>
        )}

        <section className="rounded-lg border border-red-200 dark:border-red-900/40 p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-red-600 dark:text-red-400 mb-2">
            Danger zone
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
            Permanently delete your account and all shelf data. This cannot be undone.
          </p>
          <Link to="/account/delete">
            <Button variant="destructive" size="sm">
              Delete account
            </Button>
          </Link>
        </section>
      </main>
    </div>
  );
}
