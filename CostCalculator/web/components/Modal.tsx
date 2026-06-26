"use client";
import { useEffect, useRef } from "react";
import { Icon } from "./ui";

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])';

/** Modal dialog with focus trap + Escape + backdrop dismiss (dialog.md). */
export function Modal({ title, onClose, children, footer, width = 520 }: {
  title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    const el = ref.current!;
    const list = () => Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((x) => x.offsetParent !== null);
    const t = setTimeout(() => { const f = list(); (f.find((x) => x.tagName === "INPUT") || f[0])?.focus(); }, 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (e.key !== "Tab") return;
      const f = list(); if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { clearTimeout(t); document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; prev?.focus?.(); };
  }, [onClose]);

  return (
    <div className="ob-modal-ov" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ob-modal" style={{ maxWidth: width }} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="ob-modal__head"><h2>{title}</h2><button className="ob-modal__close" onClick={onClose} aria-label="Close dialog"><Icon name="xmark" /></button></div>
        <div className="ob-modal__body">{children}</div>
        {footer && <div className="ob-modal__foot">{footer}</div>}
      </div>
    </div>
  );
}
