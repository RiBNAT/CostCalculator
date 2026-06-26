"use client";
import { evalAmountExpr, taka } from "@/lib/money";

/** Amount field that mirrors the backend additive expression parser with a live ৳ preview. */
export function AmountInput({ value, onChange, id, placeholder = "0", note, invalid }: {
  value: string; onChange: (v: string) => void; id?: string; placeholder?: string; note?: string; invalid?: boolean;
}) {
  const v = evalAmountExpr(value);
  return (
    <>
      <input id={id} className={`ob-input${invalid ? " err" : ""}`} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} autoComplete="off" inputMode="text" />
      <div className="amt-preview">{value && !isNaN(v) ? <>= <b>{taka(v)}</b></> : (note || "")}</div>
    </>
  );
}

export function DateField({ value, onChange, id, min, max }: { value: string; onChange: (v: string) => void; id?: string; min?: string; max?: string }) {
  return <input id={id} type="date" className="ob-input" value={value} min={min} max={max} onChange={(e) => onChange(e.target.value)} />;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="ff">
      <label>{label}{hint && <span className="hint"> — {hint}</span>}</label>
      {children}
    </div>
  );
}
