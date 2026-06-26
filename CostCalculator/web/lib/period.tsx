"use client";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import type { Period } from "./types";

type PeriodCtx = {
  periods: Period[];
  loading: boolean;
  selectedId: string | null;
  selected: Period | null;
  select: (id: string) => void;
};
const Ctx = createContext<PeriodCtx>(null as any);
export function usePeriods() { return useContext(Ctx); }

const KEY = "ribnat.period";

export function PeriodProvider({ children }: { children: React.ReactNode }) {
  const { data: periods = [], isLoading } = useQuery({ queryKey: ["periods"], queryFn: api.listPeriods });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!periods.length) return;
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    if (saved && periods.some((p) => p.id === saved)) setSelectedId((cur) => cur ?? saved);
    else setSelectedId((cur) => cur ?? periods[0].id);
  }, [periods]);

  const select = (id: string) => { setSelectedId(id); try { localStorage.setItem(KEY, id); } catch {} };
  const selected = useMemo(() => periods.find((p) => p.id === selectedId) ?? null, [periods, selectedId]);

  return <Ctx.Provider value={{ periods, loading: isLoading, selectedId, selected, select }}>{children}</Ctx.Provider>;
}
