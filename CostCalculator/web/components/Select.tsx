"use client";
import { useEffect, useRef, useState } from "react";

export type Opt = { value: string; label: string; dot?: string; icon?: string };

/** Accessible single-select: keyboard nav (arrows/Home/End/Enter/Esc/type-ahead), ARIA listbox. */
export function Select({ value, onChange, options, placeholder = "Select", pill = false, ariaLabel }: {
  value: string; onChange: (v: string) => void; options: Opt[]; placeholder?: string; pill?: boolean; ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const typed = useRef<{ buf: string; t: number }>({ buf: "", t: 0 });
  const cur = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]); // eslint-disable-line

  const choose = (i: number) => { const o = options[i]; if (o) { onChange(o.value); setOpen(false); } };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(true); }
      return;
    }
    if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(options.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(options.length - 1); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(active); }
    else if (e.key === "Tab") { setOpen(false); }
    else if (e.key.length === 1) {
      const now = Date.now(); const buf = now - typed.current.t < 700 ? typed.current.buf + e.key : e.key;
      typed.current = { buf, t: now };
      const i = options.findIndex((o) => o.label.toLowerCase().startsWith(buf.toLowerCase()));
      if (i >= 0) setActive(i);
    }
  };

  return (
    <div className={`ob-sel${pill ? " ob-sel--pill" : ""}${open ? " open" : ""}`} ref={ref}>
      <button type="button" className="ob-sel__trigger" role="combobox" aria-expanded={open} aria-haspopup="listbox"
        aria-label={ariaLabel} onClick={() => setOpen((o) => !o)} onKeyDown={onKey}>
        <span className="ob-sel__label">{cur?.dot && <span className="cat-dot" style={{ background: cur.dot }} />}{cur ? cur.label : placeholder}</span>
        <i className="fa-solid fa-angle-down chev" aria-hidden="true" />
      </button>
      {open && (
        <div className="ob-sel__menu" role="listbox" tabIndex={-1}>
          {options.length === 0 && <div className="ob-sel__opt muted">No options</div>}
          {options.map((o, i) => (
            <div key={o.value} role="option" aria-selected={o.value === value}
              className={`ob-sel__opt${o.value === value ? " sel" : ""}${i === active ? " focus" : ""}`}
              onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); choose(i); }}>
              {o.dot && <span className="cat-dot" style={{ background: o.dot }} />}
              {o.icon && <i className={`fa-solid fa-${o.icon}`} style={{ width: 16, color: "var(--standard-500)" }} aria-hidden="true" />}
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
