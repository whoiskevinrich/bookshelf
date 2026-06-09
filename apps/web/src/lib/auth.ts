import {
  signUp as amplifySignUp,
  confirmSignUp as amplifyConfirmSignUp,
  resendSignUpCode as amplifyResendCode,
  signIn as amplifySignIn,
  signInWithRedirect,
  signOut as amplifySignOut,
  updatePassword as amplifyUpdatePassword,
  fetchAuthSession,
  getCurrentUser as amplifyGetCurrentUser,
  resetPassword as amplifyResetPassword,
  confirmResetPassword as amplifyConfirmResetPassword,
  type SignUpOutput,
  type SignInOutput,
} from "@aws-amplify/auth";

export interface AuthUser {
  userId: string;
  username: string;
}

// ── Error mapping ─────────────────────────────────────────────────────────────

function mapCognitoError(err: unknown): string {
  if (!(err instanceof Error)) return "An unexpected error occurred.";
  switch (err.name) {
    case "UsernameExistsException":
      return "An account with this email already exists.";
    case "UserNotFoundException":
    case "NotAuthorizedException":
      return "Incorrect email or password.";
    case "UserNotConfirmedException":
      return "Please verify your email before signing in.";
    case "CodeMismatchException":
      return "Incorrect or expired code. Try again or request a new one.";
    case "ExpiredCodeException":
      return "This code has expired. Please request a new one.";
    case "LimitExceededException":
      return "Too many attempts. Please wait a moment and try again.";
    case "InvalidPasswordException":
      return "Password does not meet requirements.";
    case "InvalidParameterException":
      return "Please check your input and try again.";
    default:
      return err.message || "An unexpected error occurred.";
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function signUp(email: string, password: string): Promise<SignUpOutput> {
  try {
    return await amplifySignUp({ username: email, password });
  } catch (err) {
    if (err instanceof Error && err.name === "NotAuthorizedException") {
      throw new Error(
        "Sign-up is not available in this environment. Contact the app owner to request access.",
        { cause: err },
      );
    }
    throw new Error(mapCognitoError(err), { cause: err });
  }
}

export async function confirmSignUp(email: string, code: string): Promise<void> {
  try {
    await amplifyConfirmSignUp({ username: email, confirmationCode: code });
  } catch (err) {
    throw new Error(mapCognitoError(err), { cause: err });
  }
}

export async function resendCode(email: string): Promise<void> {
  try {
    await amplifyResendCode({ username: email });
  } catch (err) {
    throw new Error(mapCognitoError(err), { cause: err });
  }
}

export async function signIn(email: string, password: string): Promise<SignInOutput> {
  try {
    return await amplifySignIn({ username: email, password });
  } catch (err) {
    throw new Error(mapCognitoError(err), { cause: err });
  }
}

export async function signOut(): Promise<void> {
  try {
    await amplifySignOut();
  } catch (err) {
    throw new Error(mapCognitoError(err), { cause: err });
  }
}

/** Returns the current Cognito ID token, or null if not authenticated. */
export async function getSession(): Promise<string | null> {
  try {
    const session = await fetchAuthSession();
    return session.tokens?.idToken?.toString() ?? null;
  } catch {
    return null;
  }
}

/** Fetches the session once and derives both the ID token and Google-provider status. */
export async function getSessionData(): Promise<{ idToken: string | null; isGoogleUser: boolean }> {
  try {
    const session = await fetchAuthSession();
    const idToken = session.tokens?.idToken?.toString() ?? null;
    const identities = session.tokens?.idToken?.payload?.["identities"];
    const parsed: unknown =
      typeof identities === "string" ? JSON.parse(identities) : identities;
    const isGoogle =
      Array.isArray(parsed) &&
      parsed.some(
        (id) =>
          typeof id === "object" &&
          id !== null &&
          (id as Record<string, unknown>)["providerType"] === "Google",
      );
    return { idToken, isGoogleUser: isGoogle };
  } catch {
    return { idToken: null, isGoogleUser: false };
  }
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  try {
    const user = await amplifyGetCurrentUser();
    // signInDetails.loginId is the email; username is the Cognito sub UUID
    const email = user.signInDetails?.loginId ?? user.username;
    return { userId: user.userId, username: email };
  } catch {
    return null;
  }
}

export async function resetPassword(email: string): Promise<void> {
  try {
    await amplifyResetPassword({ username: email });
  } catch (err) {
    throw new Error(mapCognitoError(err), { cause: err });
  }
}

export async function confirmResetPassword(
  email: string,
  code: string,
  newPassword: string,
): Promise<void> {
  try {
    await amplifyConfirmResetPassword({ username: email, confirmationCode: code, newPassword });
  } catch (err) {
    throw new Error(mapCognitoError(err), { cause: err });
  }
}

/**
 * Validates a post-login redirect destination against the current origin.
 * Returns the path unchanged if it is same-origin and relative; falls back
 * to /shelf for anything absolute, cross-origin, or empty.
 */
export function safeNext(raw: string | null | undefined): string {
  if (!raw) return "/shelf";
  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return "/shelf";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/shelf";
  }
}

/**
 * Initiates the Google OAuth redirect flow.
 * Saves the post-login destination to sessionStorage so the callback page
 * can restore it after the round-trip through Cognito and Google.
 */
export async function signInWithGoogle(next?: string): Promise<void> {
  sessionStorage.setItem("oauth_next", safeNext(next));
  await signInWithRedirect({ provider: "Google" });
}

/**
 * Returns true if the current session was established via Google OAuth.
 * Checks the `identities` claim in the Cognito ID token, which Cognito
 * populates for all federated sign-ins (including linked accounts).
 */
export async function isGoogleUser(): Promise<boolean> {
  try {
    const session = await fetchAuthSession();
    const identities = session.tokens?.idToken?.payload?.["identities"];
    if (!identities) return false;
    const parsed: unknown = typeof identities === "string" ? JSON.parse(identities) : identities;
    if (!Array.isArray(parsed)) return false;
    return parsed.some(
      (id) =>
        typeof id === "object" &&
        id !== null &&
        (id as Record<string, unknown>)["providerType"] === "Google",
    );
  } catch {
    return false;
  }
}

export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  try {
    await amplifyUpdatePassword({ oldPassword, newPassword });
  } catch (err) {
    if (err instanceof Error && err.name === "NotAuthorizedException") {
      throw new Error("Current password is incorrect.", { cause: err });
    }
    throw new Error(mapCognitoError(err), { cause: err });
  }
}
