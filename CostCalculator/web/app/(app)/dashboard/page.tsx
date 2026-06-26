"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { usePeriods } from "@/lib/period";
import { taka } from "@/lib/money";
import { accountIcon, colorFor, fmtDate, lookup } from "@/lib/format";
import { Icon, Spinner, EmptyState } from "@/components/ui";

function daysLeftInclusive(endISO: string): number {
  const e = new Date(endISO); e.setHours(0, 0, 0, 0);
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.max(0, Math.ceil((e.getTime() - t.getTime()) / 86400000) + 1);
}

export default function DashboardPage() {
  const { selected, loading } = usePeriods();
  const pid = selected?.id;
  const { data: summary } = useQuery({ queryKey: ["summary", pid], queryFn: () => api.periodSummary(pid!), enabled: !!pid });
  const { data: trends } = useQuery({ queryKey: ["trends", pid], queryFn: () => api.periodTrends(pid!), enabled: !!pid });
  const { data: categories } = useQuery({ queryKey: ["categories"], queryFn: api.listCategories });
  const { data: accounts } = useQuery({ queryKey: ["accounts"], queryFn: api.listAccounts });
  const { data: expenses } = useQuery({ queryKey: ["expenses", pid], queryFn: () => api.listExpenses(pid!), enabled: !!pid });

  const header = (
    <div className="breadcrumb-bar">
      <nav className="breadcrumb"><Icon name="folder" solid={false} /><span className="crumb-cur">Dashboard</span></nav>
      <div className="bc-actions">
        <Link href="/expenses" className="ob-btn ob-btn--primary"><Icon name="plus" /> Add expense</Link>
      </div>
    </div>
  );

  if (loading) return <>{header}<div className="page"><Spinner /></div></>;
  if (!selected) return <>{header}<div className="page"><EmptyState icon="calendar-plus" title="No period yet" hint="Create your first salary cycle to start tracking." action={<Link href="/settings" className="ob-btn ob-btn--primary">Create a period</Link>} /></div></>;
  if (!summary) return <>{header}<div className="page"><Spinner /></div></>;

  const spent = summary.categoryTotals.reduce((s, c) => s + c.total, 0);
  const budgetTotal = summary.budget?.totals?.budget ?? 0;
  const remaining = budgetTotal > 0 ? budgetTotal - spent : 0;
  const dleft = daysLeftInclusive(selected.endDate);
  const safe = remaining > 0 && dleft > 0 ? Math.round(remaining / dleft) : 0;
  const savingsTotal = (summary.savings || []).reduce((s, a) => s + a.current, 0);
  const receivable = summary.lendTotals?.given ?? 0;
  const payable = summary.lendTotals?.taken ?? 0;
  const netWorth = summary.inHand + savingsTotal + receivable - payable;

  const cats = summary.categoryTotals.filter((c) => c.total > 0).sort((a, b) => b.total - a.total);
  const catSum = cats.reduce((s, c) => s + c.total, 0) || 1;
  let acc = 0;
  const stops = cats.map((c) => { const a = acc / catSum * 100; acc += c.total; const b = acc / catSum * 100; return `${colorFor(c.categoryId)} ${a.toFixed(2)}% ${b.toFixed(2)}%`; }).join(",");

  const recent = [...(expenses || [])].sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 5);
  const series = (trends?.series || []).slice(-12);
  const maxNW = Math.max(1, ...series.map((s) => s.netWorth));

  return (
    <>
      {header}
      <div className="page">
        <div className="kpi-grid">
          <div className="kpi"><div className="kpi__label"><Icon name="wallet" /> In hand</div><div className="kpi__value num">{taka(summary.inHand)}</div><div className="kpi__sub">across {summary.accounts.filter((a) => a.account.kind !== "virtual").length} accounts</div></div>
          <div className="kpi"><div className="kpi__label"><Icon name="receipt" /> Spent this period</div><div className="kpi__value num">{taka(spent)}</div><div className="kpi__sub">{budgetTotal > 0 ? `of ${taka(budgetTotal)} budget` : "no budget set"}</div></div>
          <div className="kpi"><div className="kpi__label"><Icon name="gauge-high" /> Safe to spend / day</div><div className="kpi__value num">{taka(safe)}</div><div className="kpi__sub">{dleft} days left in cycle</div></div>
          <div className="kpi"><div className="kpi__label"><Icon name="chart-line" /> Net worth</div><div className="kpi__value num">{taka(netWorth)}</div><div className="kpi__sub">assets − owed + receivable</div></div>
        </div>

        <div className="row row--6040">
          <div className="ob-card">
            <div className="ob-card__title-bar"><h3 className="ob-card__title">Where the money went</h3><Link href="/insights" className="ob-btn ob-btn--ghost"><Icon name="chart-simple" /> Insights</Link></div>
            {cats.length === 0 ? <EmptyState icon="receipt" title="No spending yet" hint="Add an expense to see the breakdown." /> : (
              <div className="donut-wrap">
                <div className="donut" style={{ background: `conic-gradient(${stops})` }}>
                  <div className="donut__center"><div><div className="amt num">{taka(catSum)}</div><div className="lab">total spent</div></div></div>
                </div>
                <div className="legend">
                  {cats.slice(0, 8).map((c) => (
                    <div className="legend__item" key={c.categoryId}><span className="cat-dot" style={{ background: colorFor(c.categoryId) }} /><span className="nm">{c.name}</span><span className="vl num">{taka(c.total)}</span></div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="ob-card">
            <div className="ob-card__title-bar"><h3 className="ob-card__title">Safe to spend</h3></div>
            <div className="runway-num num">{taka(safe)}<span style={{ fontSize: 15, color: "var(--standard-600)" }}> /day</span></div>
            <div className="runway-row"><span>Remaining {taka(Math.max(0, remaining))}</span><span>÷ {dleft} days</span></div>
            <div className="prog" style={{ margin: "18px 0 8px" }}><div className="prog__fill" style={{ width: `${budgetTotal > 0 ? Math.min(100, Math.round(spent / budgetTotal * 100)) : 0}%` }} /></div>
            <div className="runway-row"><span>{budgetTotal > 0 ? `${Math.min(100, Math.round(spent / budgetTotal * 100))}% of budget used` : "Set a budget to track this"}</span></div>
          </div>
        </div>

        <div className="row row--6040" style={{ marginBottom: 0 }}>
          <div className="ob-card" style={{ padding: 0 }}>
            <div className="ob-card__title-bar" style={{ padding: "16px 20px 0" }}><h3 className="ob-card__title">Recent expenses</h3><Link href="/expenses" className="ob-btn ob-btn--text">View all</Link></div>
            {recent.length === 0 ? <EmptyState icon="receipt" title="Nothing yet" /> : (
              <table className="ob-table">
                <thead><tr><th>Date</th><th>Category</th><th>Account</th><th className="num">Amount</th></tr></thead>
                <tbody>
                  {recent.map((e) => {
                    const cat = lookup(categories, e.categoryId);
                    const ac = lookup(accounts, e.accountId);
                    return (
                      <tr key={e.id}>
                        <td className="num">{fmtDate(e.date)}</td>
                        <td><span className="cat-dot" style={{ background: colorFor(e.categoryId) }} />{cat?.name || "—"}{e.subcategory ? ` · ${e.subcategory}` : ""}</td>
                        <td><span className="acct"><Icon name={accountIcon(ac?.kind)} />{ac?.name || "—"}</span></td>
                        <td className="num">{taka(e.amount)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          <div className="ob-card">
            <div className="ob-card__title-bar"><h3 className="ob-card__title">Net worth · last {series.length || 0} cycles</h3></div>
            {series.length === 0 ? <EmptyState icon="chart-column" title="Not enough history yet" /> : (
              <>
                <div className="trend">
                  {series.map((s, i) => <div key={s.periodId} className={`trend__bar${i === series.length - 1 ? " is-last" : ""}`} style={{ height: `${Math.max(4, Math.round(s.netWorth / maxNW * 100))}%` }} title={`${s.periodName}: ${taka(s.netWorth)}`} />)}
                </div>
                <div className="trend__labels">{series.map((s) => <span key={s.periodId}>{fmtDate(s.startDate)}</span>)}</div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
