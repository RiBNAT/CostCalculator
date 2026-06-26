"use client";
import { createContext, useCallback, useContext, useState } from "react";

type ToastAction = { label: string; onClick: () => void };
type Toast = { id: number; msg: string; action?: ToastAction };
const Ctx = createContext<(msg: string, action?: ToastAction) => void>(() => {});
export function useToast() { return useContext(Ctx); }

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [ts, setTs] = useState<Toast[]>([]);
  const push = useCallback((msg: string, action?: ToastAction) => {
    const id = Date.now() + Math.random();
    setTs((t) => [...t, { id, msg, action }]);
    setTimeout(() => setTs((t) => t.filter((x) => x.id !== id)), action ? 6000 : 2800);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="ob-toasts">
        {ts.map((t) => (
          <div key={t.id} className="ob-toast">
            <span>{t.msg}</span>
            {t.action && (
              <button className="ob-toast__action" onClick={() => { t.action!.onClick(); setTs((x) => x.filter((y) => y.id !== t.id)); }}>
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
