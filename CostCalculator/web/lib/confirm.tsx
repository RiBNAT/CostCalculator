"use client";
import { createContext, useCallback, useContext, useRef, useState } from "react";
import { Modal } from "@/components/Modal";
import { Icon } from "@/components/ui";

type ConfirmOpts = { title: string; message?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean; icon?: string };
type Ask = (opts: ConfirmOpts) => Promise<boolean>;

const Ctx = createContext<Ask>(async () => false);
export function useConfirm() { return useContext(Ctx); }

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOpts | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const ask = useCallback<Ask>((o) => {
    setOpts(o);
    return new Promise<boolean>((resolve) => { resolver.current = resolve; });
  }, []);

  const close = (result: boolean) => { resolver.current?.(result); resolver.current = null; setOpts(null); };

  return (
    <Ctx.Provider value={ask}>
      {children}
      {opts && (
        <Modal title={opts.title} width={440} onClose={() => close(false)}
          footer={<>
            <button className="ob-btn ob-btn--secondary" onClick={() => close(false)}>{opts.cancelLabel || "Cancel"}</button>
            <button className={`ob-btn ${opts.danger ? "ob-btn--danger" : "ob-btn--primary"}`} onClick={() => close(true)} autoFocus>
              {opts.icon && <Icon name={opts.icon} />} {opts.confirmLabel || (opts.danger ? "Delete" : "Confirm")}
            </button>
          </>}>
          {opts.message
            ? <p style={{ margin: 0, color: "var(--standard-600)", lineHeight: 1.5 }}>{opts.message}</p>
            : null}
        </Modal>
      )}
    </Ctx.Provider>
  );
}
