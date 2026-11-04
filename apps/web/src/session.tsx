import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, type ReactNode } from "react";
import type { AppConfigDTO, MeDTO } from "@lifepilot/shared";
import { api, ApiError } from "./api";

interface Session {
  me: MeDTO | null;
  config: AppConfigDTO | null;
  loading: boolean;
  refresh: () => Promise<unknown>;
}

const Ctx = createContext<Session>({ me: null, config: null, loading: true, refresh: async () => undefined });

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const config = useQuery({ queryKey: ["config"], queryFn: () => api.get<AppConfigDTO>("/config"), staleTime: Infinity });
  const me = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await api.get<MeDTO>("/auth/me");
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
  });

  const theme = me.data?.preferences.theme;
  useEffect(() => {
    if (!theme) return;
    try {
      localStorage.setItem("lp-theme", theme);
    } catch {
      /* storage unavailable */
    }
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && mq.matches));
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);

  return (
    <Ctx.Provider
      value={{
        me: me.data ?? null,
        config: config.data ?? null,
        loading: me.isLoading || config.isLoading,
        refresh: () => qc.invalidateQueries({ queryKey: ["me"] }),
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useSession = () => useContext(Ctx);

/** The signed-in user's timezone (falls back to the browser's). */
export function useTz(): string {
  const { me } = useSession();
  return me?.preferences.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}
