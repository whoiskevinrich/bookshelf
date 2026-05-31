import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getCurrentUser, getSession, signOut as authSignOut, type AuthUser } from "../lib/auth";

interface AuthState {
  user: AuthUser | null;
  idToken: string | null;
  loading: boolean;
}

interface AuthContextValue extends AuthState {
  refreshAuth: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, idToken: null, loading: true });

  async function loadSession() {
    try {
      const [user, idToken] = await Promise.all([getCurrentUser(), getSession()]);
      setState({ user, idToken, loading: false });
    } catch {
      setState({ user: null, idToken: null, loading: false });
    }
  }

  useEffect(() => {
    void loadSession();
  }, []);

  async function signOut() {
    await authSignOut();
    setState({ user: null, idToken: null, loading: false });
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
