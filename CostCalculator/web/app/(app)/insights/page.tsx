"use client";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { usePeriods } from "@/lib/period";
import { taka } from "@/lib/money";
import { colorFor } from "@/lib/format";
import type { Account } from "@/lib/types";
import { Icon, Spinner, EmptyState } from "@/components/ui";
import { ReportDialog } from "@/components/ReportDialog";

const isExternal = (a?: Account) => a?.kind === "virtual" && a?.virtualRole === "external";

export default function InsightsPage() {
  const { selected } = usePeriods();
  const pid = selected?.id;
  const [showReport, setShowReport] = useState(false);
  const { data: summary, isLoading } = useQuery({ queryKey: ["summary", pid], queryFn: () => api.periodSummary(pid!), enabled: !!pid });
  const { data: trends } = useQuery({ queryKey: ["trends", pid], queryFn: () => api.periodTrends(pid!), enabled: !!pid });
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: api.listAccounts });
  const { data: transfers = [] } = useQuery({ queryKey: ["transfers", pid], queryFn: () => api.listTransfers(pid!), enabled: !!pid });
  const { data: expenses = [] } = useQuery({ queryKey: ["expenses", pid], queryFn: () => api.listExpenses(pid!), enabled: !!pid });

  const external = accounts.find(isExternal);
  const income = useMemo(() => transfers.filter((t) => external && t.fromAccountId === external.id).reduce((s, t) => s + t.amount, 0), [transfers, external]);

  const exportCsv = async () => {
    if (!pid) return;
    const blob = await api.exportCsv(pid);
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `${selected?.name || "period"}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  const header = (
    <div className="breadcrumb-bar">
      <nav className="breadcrumb"><Icon name="folder" solid={false} /><span className="crumb-link">Dashboard</span><Icon name="chevron-right" /><span className="crumb-cur">Insights</span></nav>
      <div className="bc-actions">
        <button className="ob-btn ob-btn--secondary" onClick={exportCsv}><Icon name="arrow-up-from-bracket" /> Export CSV</button>
        <button className="ob-btn ob-btn--primary" onClick={() => setShowReport(true)}><Icon name="file-arrow-down" /> Download report</button>
      </div>
    </div>
  );

  if (!selected) return <>{header}<div className="page"><EmptyState icon="calendar-plus" title="No period selected" /></div></>;
  if (isLoading || !summary) return <>{header}<div className="page"><Spinner /></div></>;

  const cats = (summary.categoryTotals || []).filter((c) => c.total > 0).sort((a, b) => b.total - a.total);
  const spent = cats.reduce((s, c) => s + c.total, 0);
  const saved = Math.max(0, income - spent);
  const rate = income > 0 ? Math.round(saved / income * 100) : 0;

  // Month-over-month from trends.comparison (current vs previous per category).
  const mom = [...(trends?.comparison || [])].filter((c) => c.current > 0 || c.previous > 0).sort((a, b) => (b.current + b.previous) - (a.current + a.previous));

  // Top subcategories by spend.
  const groups: Record<string, { catId: string; sub: string; amt: number }> = {};
  expenses.forEach((e) => { const k = `${e.categoryId}|${e.subcategory}`; (groups[k] ||= { catId: e.categoryId, sub: e.subcategory, amt: 0 }).amt += e.amount; });
  const topSubs = Object.values(groups).sort((a, b) => b.amt - a.amt).slice(0, 6);
  const subMax = topSubs[0]?.amt || 1;
  const catName = (id: string) => summary.categoryTotals.find((c) => c.categoryId === id)?.name || "—";

  return (
    <>
      {header}
      <div className="page">
        <div className="insight-cards">
          <div className="kpi"><div className="kpi__label"><Icon name="arrow-right-to-bracket" /> Income</div><div className="kpi__value num">{taka(income)}</div><div className="kpi__sub">{income > 0 ? "logged via Transfers" : "add income in Transfers"}</div></div>
          <div className="kpi"><div className="kpi__label"><Icon name="receipt" /> Spent</div><div className="kpi__value num">{taka(spent)}</div><div className="kpi__sub">{income > 0 ? `${Math.round(spent / income * 100)}% of income` : "this cycle"}</div></div>
          <div className="kpi"><div className="kpi__label"><Icon name="piggy-bank" /> Net saved</div><div className="kpi__value num">{taka(saved)}</div><div className="kpi__sub">income − spending</div></div>
          <div className="kpi"><div className="kpi__label"><Icon name="percent" /> Savings rate</div><div className="kpi__value num">{rate}%</div><div className="kpi__sub">of income kept</div></div>
        </div>

        <div className="ob-card sankey-card" style={{ marginBottom: 16 }}>
          <div className="ob-card__title-bar"><h3 className="ob-card__title">Where your money flows</h3><span className="muted" style={{ fontSize: 13 }}>Income → spending → saved</span></div>
          {income <= 0 ? <EmptyState icon="diagram-project" title="No income recorded" hint="Add income in the Transfers tab to see your cash flow." /> : <>
            <Sankey income={income} cats={cats} saved={saved} />
            <div className="legend" style={{ marginTop: 16 }}>
              {cats.map((c) => <div className="legend__item" key={c.categoryId}><span className="cat-dot" style={{ background: colorFor(c.categoryId) }} /><span className="nm">{c.name}</span><span className="vl num">{taka(c.total)}</span></div>)}
              {saved > 0 && <div className="legend__item"><span className="cat-dot" style={{ background: "var(--marketing-green)" }} /><span className="nm">Saved / unspent</span><span className="vl num">{taka(saved)}</span></div>}
            </div>
          </>}
        </div>

        <div className="row row--6040" style={{ marginBottom: 0 }}>
          <div className="ob-card">
            <div className="ob-card__title-bar"><h3 className="ob-card__title">Category trend vs {trends?.previousPeriodName || "last cycle"}</h3></div>
            {mom.length === 0 ? <EmptyState icon="chart-line" title="No comparison yet" hint="Spend across two cycles to see trends." /> :
              mom.map((c) => {
                const up = c.current > c.previous;
                const d = c.previous ? Math.round((c.current - c.previous) / c.previous * 100) : 100;
                return (
                  <div className="mom-row" key={c.categoryId}>
                    <span className="cat-dot" style={{ background: colorFor(c.categoryId) }} />
                    <span className="nm">{c.name}</span>
                    <span className="vl num">{taka(c.current)}</span>
                    <span className={`mom-delta ${up ? "up" : "down"}`}>{up ? "▲" : "▼"} {Math.abs(d)}%</span>
                  </div>
                );
              })}
          </div>
          <div className="ob-card">
            <div className="ob-card__title-bar"><h3 className="ob-card__title">Top subcategories</h3></div>
            {topSubs.length === 0 ? <EmptyState icon="layer-group" title="No spending yet" /> :
              topSubs.map((g) => (
                <div className="topsub" key={`${g.catId}|${g.sub}`}>
                  <span className="nm">{catName(g.catId)} · {g.sub || "—"}</span>
                  <span className="bar"><div className="prog"><div className="prog__fill" style={{ width: `${Math.round(g.amt / subMax * 100)}%`, background: colorFor(g.catId) }} /></div></span>
                  <span className="vl num">{taka(g.amt)}</span>
                </div>
              ))}
          </div>
        </div>
      </div>
      {showReport && <ReportDialog onClose={() => setShowReport(false)} />}
    </>
  );
}

/** Cash-flow Sankey: a single Income source bar fans out to category bands + a "saved" band, proportional to income. */
function Sankey({ income, cats, saved }: { income: number; cats: { categoryId: string; name: string; total: number }[]; saved: number }) {
  const items = [
    ...cats.map((c) => ({ label: c.name, color: colorFor(c.categoryId), amt: c.total })),
    ...(saved > 0 ? [{ label: "Saved / unspent", color: "var(--marketing-green)", amt: saved }] : []),
  ];
  const W = 900, H = 300, TOP = 22, BARW = 14, LX = 24, RX = 720, LBLX = 740, MID = (LX + BARW + RX) / 2;
  let y = TOP;
  const ribbons: string[] = [];
  const nodes: React.ReactNode[] = [];
  const labels: React.ReactNode[] = [];
  items.forEach((it, i) => {
    const h = it.amt / income * H, y0 = y, y1 = y + h; y = y1;
    ribbons.push(`M${LX + BARW} ${y0.toFixed(1)} C${MID} ${y0.toFixed(1)} ${MID} ${y0.toFixed(1)} ${RX} ${y0.toFixed(1)} L${RX} ${y1.toFixed(1)} C${MID} ${y1.toFixed(1)} ${MID} ${y1.toFixed(1)} ${LX + BARW} ${y1.toFixed(1)} Z`);
    nodes.push(<rect key={`n${i}`} x={RX} y={+y0.toFixed(1)} width={BARW} height={+Math.max(1, h).toFixed(1)} rx={2} style={{ fill: it.color }} />);
    if (h >= 14) { const cy = (y0 + y1) / 2; labels.push(<text key={`l${i}`} x={LBLX} y={+(cy + 4).toFixed(1)} style={{ fontFamily: "var(--font-family-ui)", fontSize: 12, fill: "var(--standard-0)" }}>{it.label} <tspan style={{ fill: "var(--standard-600)" }}>{taka(it.amt)}</tspan></text>); }
  });
  return (
    <svg viewBox={`0 0 ${W} ${H + TOP + 8}`} xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Cash flow from income to spending categories and savings">
      {items.map((it, i) => <path key={`r${i}`} d={ribbons[i]} style={{ fill: it.color, opacity: 0.45 }} />)}
      <rect x={LX} y={TOP} width={BARW} height={H} rx={2} style={{ fill: "var(--blue-0)" }} />
      <text x={LX} y={TOP - 7} style={{ fontFamily: "var(--font-family-ui)", fontSize: 12, fontWeight: 600, fill: "var(--standard-0)" }}>Income {taka(income)}</text>
      {nodes}{labels}
    </svg>
  );
}
