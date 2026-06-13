import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Hub } from "aws-amplify/utils";
import { getCurrentUser, safeNext } from "../../lib/auth";
import { useAuth } from "../../context/AuthContext";

export function OAuthCallbackPage() {
  const navigate = useNavigate();
  const { refreshAuth } = useAuth();
  const [error, setError] = useState<string | null>(null);
  // Prevent double-navigation if both the Hub event and the fast-path check fire
  const handled = useRef(false);

  useEffect(() => {
    async function completeSignIn() {
      if (handled.current) return;
      handled.current = true;
      await refreshAuth();
      const next = safeNext(sessionStorage.getItem("oauth_next"));
      sessionStorage.removeItem("oauth_next");
      navigate(next, { replace: true });
    }

    // Error path: the Hosted UI redirects back with ?error=...&error_description=...
    // when the IdP/OAuth exchange fails (e.g. Cognito "Attribute cannot be updated").
    // Without this, there is no `code` to exchange and no Hub success event ever
    // fires, leaving the spinner running forever. Surface the failure instead.
    const params = new URLSearchParams(window.location.search);
    const oauthError = params.get("error");
    if (oauthError) {
      handled.current = true;
      // Detail is useful for diagnosis but not safe/clear to show users verbatim.
      console.error("OAuth callback error:", oauthError, params.get("error_description"));
      setError("We couldn't complete sign-in. Please try again, or sign in with your email and password.");
      return;
    }

    // Slow path: listen for Amplify's Hub event fired when PKCE exchange completes
    const unsubscribe = Hub.listen("auth", ({ payload }) => {
      if (payload.event === "signInWithRedirect") {
        void completeSignIn();
      } else if (payload.event === "signInWithRedirect_failure") {
        if (!handled.current) {
          handled.current = true;
          setError("Sign-in failed. Please try again.");
        }
      }
    });

    // Fast path: Amplify may have already processed the callback URL before this
    // component mounted — if so, getCurrentUser() returns the user immediately.
    // Only run this when there is no ?code= in the URL; if there is a code,
    // the Hub event handles the exchange (a stale Amplify cache could otherwise
    // complete the fast path before the new token exchange finishes).
    const hasCode = new URLSearchParams(window.location.search).has("code");
    if (!hasCode) {
      void getCurrentUser().then((user) => {
        if (user) void completeSignIn();
      });
    }

    return unsubscribe;
  }, [refreshAuth, navigate]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 px-4">
        <div className="text-center space-y-4 max-w-sm">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          <a
            href="/auth/login"
            className="text-sm underline underline-offset-2 text-slate-700 dark:text-slate-300 hover:no-underline"
          >
            Back to sign in
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
      <div
        role="status"
        aria-label="Completing sign-in"
        className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900 dark:border-white"
      />
    </div>
  );
}
