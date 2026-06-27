"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, tokens, storedUser, setOnAuthLost } from "./api";
import { useToast } from "./toast";
import type { User } from "./types";

type AuthCtx = {
  user: User | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  google: (idToken: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
};
const Ctx = createContext<AuthCtx>(null as any);
export function useAuth() { return useContext(Ctx); }

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const router = useRouter();
  const toast = useToast();

  useEffect(() => {
    setUser(storedUser.get());
    setReady(true);
    setOnAuthLost(() => {
      storedUser.set(null);
      setUser(null);
      toast("Your session expired — please sign in again.");
      router.replace("/login");
    });
  }, [router, toast]);

  const apply = (r: { user: User; tokens: { accessToken: string; refreshToken: string } }) => {
    tokens.set(r.tokens); storedUser.set(r.user); setUser(r.user);
  };
  const login = useCallback(async (email: string, password: string) => { apply(await api.login({ email, password })); }, []);
  const register = useCallback(async (name: string, email: string, password: string) => { apply(await api.register({ name, email, password })); }, []);
  const google = useCallback(async (idToken: string) => { apply(await api.google(idToken)); }, []);
  const logout = useCallback(() => { tokens.clear(); storedUser.set(null); setUser(null); router.replace("/login"); }, [router]);
  const refresh = useCallback(async () => { const u = await api.me(); storedUser.set(u); setUser(u); }, []);

  return <Ctx.Provider value={{ user, ready, login, register, google, logout, refresh }}>{children}</Ctx.Provider>;
}
