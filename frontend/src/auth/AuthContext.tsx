import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { configureApiClient } from '../api/client';
import { fetchMe, login as loginRequest } from '../api/auth';
import type { User, UserRole } from '../types';

const TOKEN_KEY = 'atrium_token';

interface AuthContextValue {
  user: User | null;
  token: string | null;
  loading: boolean;
  primaryRole: UserRole | null;
  venueIds: string[];
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function pickPrimaryRole(user: User | null): UserRole | null {
  if (!user || user.roles.length === 0) return null;
  const priority: UserRole[] = ['PLATFORM_ADMIN', 'VENUE_ADMIN', 'VENUE_STAFF', 'CUSTOMER'];
  for (const role of priority) {
    if (user.roles.some((assignment) => assignment.role === role)) {
      return role;
    }
  }
  return user.roles[0]?.role ?? null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [loading, setLoading] = useState(true);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    configureApiClient({
      getToken: () => localStorage.getItem(TOKEN_KEY),
      onUnauthorized: () => {
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setUser(null);
      },
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function restore(): Promise<void> {
      if (!token) {
        setLoading(false);
        return;
      }
      try {
        const result = await fetchMe();
        if (!cancelled) {
          setUser(result.user);
        }
      } catch {
        if (!cancelled) {
          logout();
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void restore();
    return () => {
      cancelled = true;
    };
  }, [token, logout]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await loginRequest(email, password);
    localStorage.setItem(TOKEN_KEY, result.token);
    setToken(result.token);
    setUser(result.user);
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    token,
    loading,
    primaryRole: pickPrimaryRole(user),
    venueIds: user?.roles.map((role) => role.venueId) ?? [],
    login,
    logout,
  }), [user, token, loading, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
