// Money helpers. Backend stores int64 paisa (1 taka = 100 paisa).

/** Indian/Bengali digit grouping: 8,42,500 (lakh/crore). Input is a whole number. */
function groupBD(n: number): string {
  const neg = n < 0;
  const s = String(Math.abs(Math.round(n)));
  let out: string;
  if (s.length <= 3) out = s;
  else {
    const last3 = s.slice(-3);
    const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
    out = rest + "," + last3;
  }
  return (neg ? "-" : "") + out;
}

/** paisa -> "৳12,34,567" (whole taka). */
export function taka(paisa: number): string {
  return "৳" + groupBD((paisa || 0) / 100);
}

/** paisa -> "12,34,567.00" with 2 decimals, no symbol. */
export function takaDecimal(paisa: number): string {
  const t = (paisa || 0) / 100;
  const whole = Math.trunc(Math.abs(t));
  const frac = Math.round((Math.abs(t) - whole) * 100);
  return (t < 0 ? "-" : "") + groupBD(whole) + "." + String(frac).padStart(2, "0");
}

/** paisa -> taka decimal string for editing a budget input ("5000" or "5000.50"). */
export function paisaToInput(paisa: number): string {
  if (paisa % 100 === 0) return String(paisa / 100);
  return (paisa / 100).toFixed(2);
}

/** Client mirror of the backend additive expression parser. Returns paisa or NaN. */
export function evalAmountExpr(expr: string): number {
  const s = (expr || "").trim();
  if (!s || !/^[-+\d.\s]+$/.test(s)) return NaN;
  const parts = s.split(/(?=[+-])/).map((p) => p.trim()).filter(Boolean);
  let total = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!isFinite(v)) return NaN;
    total += v;
  }
  return Math.round(total * 100);
}

export function withSign(paisa: number): string {
  return (paisa < 0 ? "−" : "+") + taka(Math.abs(paisa));
}
