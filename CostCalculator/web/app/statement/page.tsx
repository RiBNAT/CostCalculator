"use client";
import { Suspense, useEffect, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { taka } from "@/lib/money";
import { colorFor } from "@/lib/format";
import { Icon, Spinner, ErrorState } from "@/components/ui";

const ALL = ["kpis", "income", "categories", "savings", "period", "lends"];

function fmt(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function StatementInner() {
  const sp = useSearchParams();
  const from = sp.get("from") || "";
  const to = sp.get("to") || "";
  const sections = (sp.get("sections") || "kpis,income,categories,savings,period").split(",").filter((s) => ALL.includes(s));
  const has = (s: string) => sections.includes(s);
  const printed = useRef(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["statement", from, to],
    queryFn: () => api.statement(from, to),
    enabled: !!from && !!to,
  });

  useEffect(() => {
    if (data && !printed.current) { printed.current = true; setTimeout(() => window.print(), 400); }
  }, [data]);

  if (!from || !to) return <div className="stmt-page"><ErrorState message="Missing date range." onRetry={undefined} /></div>;
  if (isLoading) return <div className="stmt-page"><Spinner /></div>;
  if (isError || !data) return <div className="stmt-page"><ErrorState message={(error as Error)?.message} onRetry={() => refetch()} /></div>;

  const k = data.kpis;
  const catMax = Math.max(1, ...data.categories.map((c) => c.total));
  const incMax = Math.max(1, k.totalIncome, k.totalSpent, k.netSaved);
  const noActivity = k.totalIncome === 0 && k.totalSpent === 0;

  return (
    <div className="stmt-page">
      <div className="stmt-actions">
        <Link href="/insights" className="ob-btn ob-btn--ghost"><Icon name="arrow-left" /> Back</Link>
        <button className="ob-btn ob-btn--primary" onClick={() => window.print()}><Icon name="download" /> Save as PDF</button>
      </div>

      <div className="stmt">
        <div className="stmt-head">
          <div>
            <div className="stmt-title">Financial statement</div>
            <div className="stmt-sub">{fmt(from)} – {fmt(to)} · generated {fmt(new Date().toISOString())}</div>
          </div>
          <div className="stmt-brand">৳ Ribnat</div>
        </div>

        {noActivity && <p className="stmt-empty">No activity in this range.</p>}

        {has("kpis") && (
          <div className="stmt-kpis">
            <div className="stmt-k"><div className="l">Income</div><div className="v num">{taka(k.totalIncome)}</div></div>
            <div className="stmt-k"><div className="l">Spent</div><div className="v num">{taka(k.totalSpent)}</div></div>
            <div className="stmt-k"><div className="l">Net saved</div><div className="v num">{taka(k.netSaved)}</div></div>
            <div className="stmt-k"><div className="l">Savings rate</div><div className="v num">{k.totalIncome > 0 ? `${k.savingsRatePct}%` : "—"}</div></div>
          </div>
        )}

        {has("income") && (
          <div className="stmt-sec">
            <h3 className="stmt-sec-h">Income &amp; spending</h3>
            <Bar nm="Income" pct={Math.round(k.totalIncome / incMax * 100)} color="var(--marketing-green)" v={k.totalIncome} />
            <Bar nm="Spent" pct={Math.round(k.totalSpent / incMax * 100)} color="var(--blue-0)" v={k.totalSpent} />
            <Bar nm="Net saved" pct={Math.max(0, Math.round(k.netSaved / incMax * 100))} color="var(--marketing-purple)" v={k.netSaved} />
          </div>
        )}

        {has("categories") && data.categories.length > 0 && (
          <div className="stmt-sec">
            <h3 className="stmt-sec-h">Spending by category</h3>
            {data.categories.map((c) => (
              <Bar key={c.categoryId} nm={c.name} pct={Math.round(c.total / catMax * 100)} color={colorFor(c.categoryId)} v={c.total} />
            ))}
          </div>
        )}

        {has("period") && data.periods.length > 0 && (
          <div className="stmt-sec">
            <h3 className="stmt-sec-h">Period breakdown</h3>
            <table className="stmt-table">
              <thead><tr><th>Cycle</th><th className="num">Income</th><th className="num">Spent</th><th className="num">Saved</th></tr></thead>
              <tbody>
                {data.periods.map((p) => (
                  <tr key={p.periodId}><td>{p.name}</td><td className="num">{taka(p.income)}</td><td className="num">{taka(p.spent)}</td><td className="num">{taka(p.saved)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {has("savings") && data.savings.length > 0 && (
          <div className="stmt-sec">
            <h3 className="stmt-sec-h">Savings</h3>
            <table className="stmt-table">
              <thead><tr><th>Account</th><th className="num">Deposited</th></tr></thead>
              <tbody>{data.savings.map((s) => <tr key={s.accountId}><td>{s.name}</td><td className="num">{taka(s.deposited)}</td></tr>)}</tbody>
            </table>
          </div>
        )}

        {has("lends") && (
          <div className="stmt-sec">
            <h3 className="stmt-sec-h">Lends</h3>
            <table className="stmt-table">
              <thead><tr><th>Type</th><th className="num">Amount</th></tr></thead>
              <tbody>
                <tr><td>Given · outstanding</td><td className="num">{taka(data.lends.givenOutstanding)}</td></tr>
                <tr><td>Taken · outstanding</td><td className="num">{taka(data.lends.takenOutstanding)}</td></tr>
                <tr><td>Settled this range</td><td className="num">{taka(data.lends.settledInRange)}</td></tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Bar({ nm, pct, color, v }: { nm: string; pct: number; color: string; v: number }) {
  return (
    <div className="stmt-bar">
      <span className="nm">{nm}</span>
      <span className="track"><span className="fill" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} /></span>
      <span className="vl">{taka(v)}</span>
    </div>
  );
}

export default function StatementPage() {
  return <Suspense fallback={<div className="stmt-page"><Spinner /></div>}><StatementInner /></Suspense>;
}
