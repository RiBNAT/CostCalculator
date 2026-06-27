"use client";
import { useEffect, useRef, useState } from "react";

/** Font Awesome glyph. */
export function Icon({ name, solid = true, brand = false, className = "", style }: { name: string; solid?: boolean; brand?: boolean; className?: string; style?: React.CSSProperties }) {
  const weight = brand ? "fa-brands" : solid ? "fa-solid" : "fa-regular";
  return <i className={`${weight} fa-${name} ${className}`} style={style} aria-hidden="true" />;
}

/** A popover dropdown anchored to a trigger button. Closes on outside-click / Escape. */
export function Dropdown({
  trigger, children, align = "right", width = 280,
}: {
  trigger: (open: boolean, toggle: () => void) => React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align?: "left" | "right";
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      {trigger(open, () => setOpen((o) => !o))}
      {open && (
        <div className="ob-pop" style={{ position: "absolute", top: "calc(100% + 6px)", [align]: 0, width } as React.CSSProperties}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function EmptyState({ icon, title, hint, action }: { icon: string; title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} />
      <h3>{title}</h3>
      {hint && <p style={{ margin: "0 0 14px" }}>{hint}</p>}
      {action}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return <div className="empty"><Icon name="spinner" className="spin" /><h3>{label || "Loading…"}</h3></div>;
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="empty">
      <Icon name="triangle-exclamation" />
      <h3>Something went wrong</h3>
      <p style={{ margin: "0 0 14px" }}>{message || "Could not load this data. Please try again."}</p>
      {onRetry && (
        <button className="ob-btn ob-btn--primary" onClick={onRetry}>Try again</button>
      )}
    </div>
  );
}
