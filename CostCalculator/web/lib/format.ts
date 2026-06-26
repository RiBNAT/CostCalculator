import type { Account, AccountKind } from "./types";

// Backend categories carry no color; derive a stable one from the id/name.
const PALETTE = [
  "var(--blue-0)", "var(--green-text)", "var(--purple-text)", "var(--orange-text)",
  "var(--marketing-pink)", "var(--marketing-orange)", "var(--coral-text)",
  "var(--marketing-purple)", "var(--marketing-green)", "var(--standard-700)",
];
export function colorFor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function accountIcon(kind?: AccountKind): string {
  switch (kind) {
    case "bank": return "building-columns";
    case "mobile": return "mobile-screen";
    case "cash": return "money-bill-wave";
    case "savings": return "piggy-bank";
    default: return "wallet";
  }
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** RFC3339 / YYYY-MM-DD -> "24 Jun". */
export function fmtDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(0, 10);
  return `${d.getDate()} ${MON[d.getMonth()]}`;
}
/** "25 May – 24 Jun" for a period. */
export function fmtRange(start?: string, end?: string): string {
  if (!start || !end) return "";
  return `${fmtDate(start)} – ${fmtDate(end)}`;
}
/** Today as YYYY-MM-DD. */
export function todayISO(): string { return new Date().toISOString().slice(0, 10); }
/** RFC3339/ISO -> YYYY-MM-DD (for <input type=date>). */
export function isoDate(iso?: string): string { return (iso || "").slice(0, 10); }

export function lookup<T extends { id: string }>(list: T[] | undefined, id: string): T | undefined {
  return (list || []).find((x) => x.id === id);
}
export function accountName(accounts: Account[] | undefined, id: string): string {
  return lookup(accounts, id)?.name ?? "—";
}
