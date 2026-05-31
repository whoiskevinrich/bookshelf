import {
  signUp as amplifySignUp,
  confirmSignUp as amplifyConfirmSignUp,
  resendSignUpCode as amplifyResendCode,
  signIn as amplifySignIn,
  signOut as amplifySignOut,
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
    throw new Error(mapCognitoError(err));
  }
}

export async function confirmSignUp(email: string, code: string): Promise<void> {
  try {
    await amplifyConfirmSignUp({ username: email, confirmationCode: code });
  } catch (err) {
    throw new Error(mapCognitoError(err));
  }
}

export async function resendCode(email: string): Promise<void> {
  try {
    await amplifyResendCode({ username: email });
  } catch (err) {
    throw new Error(mapCognitoError(err));
  }
}

export async function signIn(email: string, password: string): Promise<SignInOutput> {
  try {
    return await amplifySignIn({ username: email, password });
  } catch (err) {
    throw new Error(mapCognitoError(err));
  }
}

export async function signOut(): Promise<void> {
  try {
    await amplifySignOut();
  } catch (err) {
    throw new Error(mapCognitoError(err));
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

export async function getCurrentUser(): Promise<AuthUser | null> {
  try {
    const user = await amplifyGetCurrentUser();
    return { userId: user.userId, username: user.username };
  } catch {
    return null;
  }
}

export async function resetPassword(email: string): Promise<void> {
  try {
    await amplifyResetPassword({ username: email });
  } catch (err) {
    throw new Error(mapCognitoError(err));
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
    throw new Error(mapCognitoError(err));
  }
}
