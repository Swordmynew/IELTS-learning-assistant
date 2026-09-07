"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { api, UserAccount } from "@/lib/api";

type AuthSession = {
  token: string | null;
  user: UserAccount | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string, remember: boolean) => Promise<UserAccount>;
  register: (displayName: string, email: string, password: string, remember: boolean) => Promise<UserAccount>;
  enterDemo: () => Promise<UserAccount>;
  logout: () => void;
  refreshUser: () => Promise<UserAccount | null>;
};

const AuthSessionContext = createContext<AuthSession>({
  token: null,
  user: null,
  loading: true,
  error: null,
  login: async () => { throw new Error("Auth provider is not ready"); },
  register: async () => { throw new Error("Auth provider is not ready"); },
  enterDemo: async () => { throw new Error("Auth provider is not ready"); },
  logout: () => undefined,
  refreshUser: async () => null,
});

export function useAuth() {
  return useContext(AuthSessionContext);
}

export function useDemoSession() {
  return useAuth();
}

const persistentTokenKey = "ielts-access-token";
const sessionTokenKey = "ielts-session-token";

function readSavedToken() {
  try {
    return localStorage.getItem(persistentTokenKey) ?? sessionStorage.getItem(sessionTokenKey);
  } catch {
    return null;
  }
}

function saveToken(token: string, remember: boolean) {
  try {
    localStorage.removeItem(persistentTokenKey);
    sessionStorage.removeItem(sessionTokenKey);
    (remember ? localStorage : sessionStorage).setItem(
      remember ? persistentTokenKey : sessionTokenKey,
      token,
    );
  } catch {
    // The in-memory session remains usable if browser storage is unavailable.
  }
}

function removeSavedToken() {
  try {
    localStorage.removeItem(persistentTokenKey);
    sessionStorage.removeItem(sessionTokenKey);
    sessionStorage.removeItem("ielts-demo-token");
  } catch {
    // Storage can be unavailable in hardened browsers.
  }
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient());
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<UserAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const saved = readSavedToken();
    if (!saved) { setLoading(false); return; }
    setToken(saved);
    api.me(saved)
      .then(setUser)
      .catch(() => { removeSavedToken(); setToken(null); setUser(null); })
      .finally(() => setLoading(false));
  }, []);

  const establishSession = useCallback(async (accessToken: string, remember: boolean) => {
    const account = await api.me(accessToken);
    saveToken(accessToken, remember);
    setToken(accessToken);
    setUser(account);
    setError(null);
    return account;
  }, []);

  const login = useCallback(async (email: string, password: string, remember: boolean) => {
    const response = await api.login(email, password);
    return establishSession(response.access_token, remember);
  }, [establishSession]);

  const register = useCallback(async (
    displayName: string,
    email: string,
    password: string,
    remember: boolean,
  ) => {
    const response = await api.register(displayName, email, password);
    return establishSession(response.access_token, remember);
  }, [establishSession]);

  const enterDemo = useCallback(async () => {
    const response = await api.demo();
    return establishSession(response.access_token, false);
  }, [establishSession]);

  const logout = useCallback(() => {
    removeSavedToken();
    setToken(null);
    setUser(null);
    setError(null);
    client.clear();
  }, [client]);

  const refreshUser = useCallback(async () => {
    if (!token) return null;
    const account = await api.me(token);
    setUser(account);
    return account;
  }, [token]);

  const session = useMemo(() => ({
    token, user, loading, error, login, register, enterDemo, logout, refreshUser,
  }), [token, user, loading, error, login, register, enterDemo, logout, refreshUser]);
  return (
    <QueryClientProvider client={client}>
      <AuthSessionContext.Provider value={session}>{children}</AuthSessionContext.Provider>
    </QueryClientProvider>
  );
}
