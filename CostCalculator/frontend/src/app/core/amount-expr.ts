/**
 * Parses an additive taka expression like "360+20+330" into paisa.
 * Mirrors the backend domain.ParseAmountExpr: only + and -, max 2 decimals.
 * Returns null when the expression is invalid.
 */
export function parseAmountExpr(input: string): { total: number; parts: number[] } | null {
  const s = input.replace(/\s+/g, '');
  if (!s) return null;
  if (!/^[+-]?\d+(\.\d{1,2})?([+-]\d+(\.\d{1,2})?)*$/.test(s)) return null;

  const parts: number[] = [];
  let total = 0;
  const re = /([+-]?)(\d+(?:\.\d{1,2})?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const sign = m[1] === '-' ? -1 : 1;
    const [whole, frac = ''] = m[2].split('.');
    const paisa = sign * (parseInt(whole, 10) * 100 + parseInt(frac.padEnd(2, '0') || '0', 10));
    parts.push(paisa);
    total += paisa;
  }
  return { total, parts };
}

/** Formats paisa as a taka string, lakh-grouped: 7400000 -> "74,000". */
export function formatTaka(paisa: number): string {
  const taka = paisa / 100;
  const opts =
    Math.round(taka) === taka ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  return new Intl.NumberFormat('en-IN', opts).format(taka);
}
