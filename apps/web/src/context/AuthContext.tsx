import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import {
  getCurrentUser,
  getSessionData,
  signOut as authSignOut,
  type AuthUser,
} from "../lib/auth";

interface AuthState {
  user: AuthUser | null;
  idToken: string | null;
  loading: boolean;
  isGoogleUser: boolean;
}

interface AuthContextValue extends AuthState {
  refreshAuth: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const SIGNED_OUT: AuthState = { user: null, idToken: null, loading: false, isGoogleUser: false };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    idToken: null,
    loading: true,
    isGoogleUser: false,
  });

  const loadSession = useCallback(async () => {
    try {
      const [user, { idToken, isGoogleUser }] = await Promise.all([
        getCurrentUser(),
        getSessionData(),
      ]);
      setState({ user, idToken, loading: false, isGoogleUser });
    } catch {
      setState(SIGNED_OUT);
    }
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  async function signOut() {
    await authSignOut();
    setState(SIGNED_OUT);
  }

  return (
    <AuthContext.Provider value={{ ...state, refreshAuth: loadSession, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
