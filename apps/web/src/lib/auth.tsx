import { useQueryClient } from '@tanstack/react-query';
import type {
  AuthResponse,
  LoginInput,
  RegisterInput,
  User,
} from '@trialmatch/shared';
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Navigate, useLocation } from 'react-router';
import { api, setUnauthorizedHandler, tokenStore } from './api';

const USER_KEY = 'trialmatch.user';

interface AuthState {
  user: User | null;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

function readUser(): User | null {
  try {
    return tokenStore.get()
      ? (JSON.parse(sessionStorage.getItem(USER_KEY) ?? 'null') as User)
      : null;
  } catch {
    return null;
  }
}

/**
 * The token lives in sessionStorage: one sign-in per tab, gone when the tab closes.
 * (Any script on the page could read it; an HttpOnly cookie is the stricter option.)
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(readUser);
  const queryClient = useQueryClient();

  const start = useCallback((res: AuthResponse) => {
    tokenStore.set(res.accessToken);
    sessionStorage.setItem(USER_KEY, JSON.stringify(res.user));
    setUser(res.user);
  }, []);

  const logout = useCallback(() => {
    tokenStore.clear();
    sessionStorage.removeItem(USER_KEY);
    queryClient.clear(); // never show one user's cached data to the next
    setUser(null);
  }, [queryClient]);

  useEffect(() => setUnauthorizedHandler(logout), [logout]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      login: async (input) =>
        start(
          await api<AuthResponse>('/auth/login', {
            method: 'POST',
            body: input,
          }),
        ),
      register: async (input) =>
        start(
          await api<AuthResponse>('/auth/register', {
            method: 'POST',
            body: input,
          }),
        ),
      logout,
    }),
    [user, start, logout],
  );
  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthState {
  const ctx = use(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Sends signed-out visitors to /login, remembering where they were going. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user)
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname + location.search }}
      />
    );
  return children;
}

/** Only in-app paths are allowed as a return target (no open redirects). */
export function safeReturnPath(from: unknown): string {
  return typeof from === 'string' &&
    from.startsWith('/') &&
    !from.startsWith('//')
    ? from
    : '/trials';
}
