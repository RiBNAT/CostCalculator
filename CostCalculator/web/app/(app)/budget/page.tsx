"use client";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { usePeriods } from "@/lib/period";
import { useToast } from "@/lib/toast";
import { useConfirm } from "@/lib/confirm";
import { taka, evalAmountExpr, paisaToInput } from "@/lib/money";
import { colorFor, fmtRange } from "@/lib/format";
import type { BudgetItem, BudgetReport } from "@/lib/types";
import { Icon, Spinner, EmptyState } from "@/components/ui";

type View = "period" | "rollover" | "history";
const key = (catId: string, sub: string) => `${catId}|${sub}`;

export default function BudgetPage() {
  const { selected, periods } = usePeriods();
  const pid = selected?.id;
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();

  const [view, setView] = useState<View>("period");
  const [edit, setEdit] = useState(false);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [rollover, setRollover] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data: categories = [] } = useQuery({ queryKey: ["categories"], queryFn: api.listCategories });
  const { data: budget, isLoading: bLoading } = useQuery({ queryKey: ["budget", pid], queryFn: () => api.getBudget(pid!), enabled: !!pid });
  const { data: summary, isLoading: sLoading } = useQuery({ queryKey: ["summary", pid], queryFn: () => api.periodSummary(pid!), enabled: !!pid });
  const { data: trends } = useQuery({ queryKey: ["trends", pid], queryFn: () => api.periodTrends(pid!), enabled: !!pid && view === "history" });

  const report: BudgetReport | undefined = summary?.budget;
  const expenseCats = useMemo(() => categories.filter((c) => c.kind === "expense" && c.active), [categories]);
  const open = selected?.status === "open";

  // Sync rollover flag from the loaded budget.
  useEffect(() => { if (budget) setRollover(!!budget.rollover); }, [budget]);

  const refresh = () => { qc.invalidateQueries({ queryKey: ["budget", pid] }); qc.invalidateQueries({ queryKey: ["summary", pid] }); };

  // ----- allocations (paisa) from saved items, or from live inputs while editing -----
  const savedSub = (catId: string, sub: string) => budget?.items?.find((i) => i.categoryId === catId && i.subcategory === sub)?.amount ?? 0;
  const editedSub = (catId: string, sub: string) => {
    const raw = inputs[key(catId, sub)];
    if (raw === undefined) return savedSub(catId, sub);
    const v = evalAmountExpr(raw);
    return isNaN(v) ? 0 : v;
  };
  const subAlloc = (catId: string, sub: string) => (edit ? editedSub(catId, sub) : savedSub(catId, sub));
  const catAlloc = (catId: string) => (categories.find((c) => c.id === catId)?.subcategories || []).reduce((s, sc) => s + subAlloc(catId, sc.name), 0);

  // ----- actuals from the report (authoritative) -----
  const reportCat = (catId: string) => report?.categories?.find((c) => c.categoryId === catId);
  const reportLine = (catId: string, sub: string) => report?.lines?.find((l) => l.categoryId === catId && l.subcategory === sub);
  const catSpent = (catId: string) => reportCat(catId)?.actual ?? summary?.categoryTotals?.find((c) => c.categoryId === catId)?.total ?? 0;
  const subSpent = (catId: string, sub: string) => reportLine(catId, sub)?.actual ?? 0;
  // effective budget includes rollover folded in by the backend; rollover portion = effective − allocated
  const catEffective = (catId: string) => reportCat(catId)?.budget ?? catAlloc(catId);
  const catRollover = (catId: string) => Math.max(0, (reportCat(catId)?.budget ?? 0) - savedSub2(catId));
  function savedSub2(catId: string) { return (categories.find((c) => c.id === catId)?.subcategories || []).reduce((s, sc) => s + savedSub(catId, sc.name), 0); }

  const allocTotal = useMemo(() => expenseCats.reduce((s, c) => s + catAlloc(c.id), 0), [expenseCats, inputs, budget, edit]);
  const spentTotal = (summary?.categoryTotals || []).reduce((s, c) => s + c.total, 0);
  const effectiveTotal = report?.totals?.budget ?? allocTotal;
  const rolloverTotal = expenseCats.reduce((s, c) => s + catRollover(c.id), 0);
  const dirty = edit && (Object.keys(inputs).length > 0 || rollover !== !!budget?.rollover);

  // Guard against losing unsaved edits on hard navigation / reload.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const startEdit = () => {
    const init: Record<string, string> = {};
    (budget?.items || []).forEach((i) => { if (i.amount > 0) init[key(i.categoryId, i.subcategory)] = paisaToInput(i.amount); });
    setInputs(init); setEdit(true); setView("period");
  };
  const cancelEdit = async () => {
    if (dirty && !(await confirm({ title: "Discard budget changes?", message: "Your unsaved edits will be lost.", danger: true, confirmLabel: "Discard" }))) return;
    setInputs({}); setEdit(false); setRollover(!!budget?.rollover);
  };

  const save = useMutation({
    mutationFn: () => {
      const items: BudgetItem[] = [];
      expenseCats.forEach((c) => (c.subcategories || []).forEach((sc) => {
        const amt = editedSub(c.id, sc.name);
        if (amt > 0) items.push({ categoryId: c.id, subcategory: sc.name, amount: amt });
      }));
      return api.putBudget(pid!, items, rollover);
    },
    onSuccess: () => { setEdit(false); setInputs({}); refresh(); toast("Budget updated"); },
    onError: (e: any) => toast(e?.message || "Could not save budget"),
  });

  const copyPrev = useMutation({
    mutationFn: () => api.copyPreviousBudget(pid!),
    onSuccess: (prevBudget) => {
      const snapshot = budget?.items || [];
      refresh();
      toast("Copied previous allocation", { label: "Undo", onClick: () => { api.putBudget(pid!, snapshot, !!budget?.rollover).then(refresh); toast("Reverted"); } });
    },
    onError: (e: any) => toast(e?.message || "No previous budget to copy"),
  });

  const toggleRollover = (next: boolean) => {
    setRollover(next);
    if (!edit) api.putBudget(pid!, budget?.items || [], next).then(() => { refresh(); toast(next ? "Rollover on — unspent budget carries over" : "Rollover off"); });
  };
  const toggleExpand = (catId: string) => setExpanded((s) => { const n = new Set(s); n.has(catId) ? n.delete(catId) : n.add(catId); return n; });

  const switchView = async (v: View) => {
    if (edit && dirty && !(await confirm({ title: "Discard budget changes?", message: "Switching tabs will lose your unsaved edits.", danger: true, confirmLabel: "Discard" }))) return;
    if (edit) { setEdit(false); setInputs({}); setRollover(!!budget?.rollover); }
    setView(v);
  };

  if (!selected) return <Header view={view} switchView={switchView} actions={null} summary=""><div className="page"><EmptyState icon="calendar-plus" title="No period selected" /></div></Header>;

  const loading = bLoading || sLoading;
  const summaryText = `Budgeted ${taka(effectiveTotal)} · Spent ${taka(spentTotal)} · Left ${taka(effectiveTotal - spentTotal)}`;

  const actions = !open ? <span className="ob-badge ob-badge--neutral ob-badge--sm">Closed — read-only</span> : edit ? (
    <>
      <button className="ob-btn ob-btn--secondary" onClick={cancelEdit}>Cancel</button>
      <button className="ob-btn ob-btn--primary" onClick={() => save.mutate()} disabled={save.isPending}><Icon name="check" /> Save budget</button>
    </>
  ) : (
    <>
      {selected.previousPeriodId && <button className="ob-btn ob-btn--secondary" onClick={() => copyPrev.mutate()} disabled={copyPrev.isPending}><Icon name="copy" /> Copy previous</button>}
      <button className="ob-btn ob-btn--primary" onClick={startEdit}><Icon name="pen" /> Edit budget</button>
    </>
  );

  const showRoll = view === "rollover";

  return (
    <Header view={view} switchView={switchView} actions={actions} summary={loading ? "" : summaryText} rollover={rollover} onRollover={open && !edit ? toggleRollover : undefined}>
      <div className="page">
        {loading ? <Spinner /> :
          view === "history" ? <HistoryTable trends={trends} periods={periods} /> :
          edit ? (
            <div className="tscroll"><table className="ob-table">
              <thead><tr><th>Category / subcategory</th><th className="num">Budget</th><th className="num">Spent</th><th className="num">Remaining</th></tr></thead>
              <tbody>
                {expenseCats.map((c) => (
                  <RowsForEdit key={c.id} c={c} alloc={catAlloc(c.id)} spent={catSpent(c.id)}
                    inputs={inputs} setInputs={setInputs} subSpent={subSpent} />
                ))}
              </tbody>
              <tfoot><tr><td>Total</td><td className="num"><b>{taka(allocTotal)}</b></td><td className="num">{taka(spentTotal)}</td><td className="num">{taka(allocTotal - spentTotal)}</td></tr></tfoot>
            </table></div>
          ) : (
            (() => {
              const visible = expenseCats.filter((c) => catAlloc(c.id) > 0 || catSpent(c.id) > 0);
              if (visible.length === 0) return <EmptyState icon="chart-pie" title="No budget set" hint={open ? "Allocate amounts per subcategory to track spending against a plan." : "This period has no budget."} action={open ? <button className="ob-btn ob-btn--primary" onClick={startEdit}><Icon name="pen" /> Set a budget</button> : undefined} />;
              return (
                <div className="tscroll"><table className="ob-table">
                  <thead><tr><th>Category</th>{showRoll && <th className="num">Rollover</th>}<th className="num">Budgeted</th><th className="num">Spent</th><th className="num">Remaining</th><th style={{ width: 200 }}>Progress</th><th>Status</th></tr></thead>
                  <tbody>
                    {visible.map((c) => {
                      const eff = catEffective(c.id), spent = catSpent(c.id), rem = eff - spent, over = rem < 0;
                      const pct = Math.min(100, Math.round(spent / Math.max(1, eff) * 100));
                      const fill = over ? "prog__fill--over" : pct < 85 ? "prog__fill--good" : "prog__fill";
                      const status = over ? <span className="ob-badge ob-badge--red ob-badge--sm"><Icon name="triangle-exclamation" /> Over</span> : rem === 0 ? <span className="ob-badge ob-badge--neutral ob-badge--sm">On budget</span> : <span className="ob-badge ob-badge--green ob-badge--sm">Under</span>;
                      const isOpen = expanded.has(c.id);
                      const roll = catRollover(c.id);
                      const subs = (c.subcategories || []).filter((sc) => savedSub(c.id, sc.name) > 0 || subSpent(c.id, sc.name) > 0);
                      return (
                        <FragmentRow key={c.id}>
                          <tr>
                            <td onClick={() => toggleExpand(c.id)} style={{ cursor: "pointer" }}><Icon name={`chevron-${isOpen ? "down" : "right"}`} className="cat-caret" /><span className="cat-dot" style={{ background: colorFor(c.id) }} />{c.name}</td>
                            {showRoll && <td className="num">{roll > 0 ? <span className="ob-badge ob-badge--green ob-badge--sm"><Icon name="rotate" /> {taka(roll)}</span> : <span className="muted">—</span>}</td>}
                            <td className="num">{taka(eff)}</td>
                            <td className="num">{taka(spent)}</td>
                            <td className={`num${over ? " neg" : ""}`}>{over ? `−${taka(-rem)}` : taka(rem)}</td>
                            <td><div className="prog"><div className={`prog__fill ${fill}`} style={{ width: `${pct}%` }} /></div></td>
                            <td>{status}</td>
                          </tr>
                          {isOpen && (subs.length ? subs.map((sc) => {
                            const sb = savedSub(c.id, sc.name), ss = subSpent(c.id, sc.name), sr = sb - ss, so = sr < 0;
                            const sp = sb ? Math.min(100, Math.round(ss / sb * 100)) : (ss > 0 ? 100 : 0);
                            return (
                              <tr className="subrow" key={sc.name}>
                                <td style={{ paddingLeft: 34 }}><span className="cat-dot" style={{ background: colorFor(c.id), opacity: 0.45 }} />{sc.name}</td>
                                {showRoll && <td />}
                                <td className="num">{sb ? taka(sb) : <span className="muted">—</span>}</td>
                                <td className="num">{taka(ss)}</td>
                                <td className={`num${so ? " neg" : ""}`}>{(sb || ss) ? (so ? `−${taka(-sr)}` : taka(sr)) : ""}</td>
                                <td><div className="prog prog--mini"><div className="prog__fill" style={{ width: `${sp}%`, background: so ? "var(--danger-0)" : colorFor(c.id) }} /></div></td>
                                <td />
                              </tr>
                            );
                          }) : <tr className="subrow"><td colSpan={showRoll ? 7 : 6} style={{ paddingLeft: 34 }} className="muted">No budget or spending in subcategories yet.</td></tr>)}
                        </FragmentRow>
                      );
                    })}
                  </tbody>
                  <tfoot><tr><td>Total</td>{showRoll && <td className="num">{taka(rolloverTotal)}</td>}<td className="num">{taka(effectiveTotal)}</td><td className="num">{taka(spentTotal)}</td><td className="num">{taka(effectiveTotal - spentTotal)}</td><td><div className="prog"><div className="prog__fill" style={{ width: `${Math.min(100, Math.round(spentTotal / Math.max(1, effectiveTotal) * 100))}%` }} /></div></td><td /></tr></tfoot>
                </table></div>
              );
            })()
          )}
      </div>
    </Header>
  );
}

// Fragment wrapper that renders a category row + its subrows (keeps the table body valid).
function FragmentRow({ children }: { children: React.ReactNode }) { return <>{children}</>; }

function RowsForEdit({ c, alloc, spent, inputs, setInputs, subSpent }: {
  c: any; alloc: number; spent: number; inputs: Record<string, string>; setInputs: (f: (s: Record<string, string>) => Record<string, string>) => void; subSpent: (catId: string, sub: string) => number;
}) {
  return (
    <>
      <tr>
        <td><span className="cat-dot" style={{ background: colorFor(c.id) }} /><b>{c.name}</b></td>
        <td className="num"><b>{taka(alloc)}</b></td>
        <td className="num muted">{taka(spent)}</td>
        <td className="num">{taka(alloc - spent)}</td>
      </tr>
      {(c.subcategories || []).filter((sc: any) => sc.active).map((sc: any) => (
        <tr className="subrow" key={sc.name}>
          <td style={{ paddingLeft: 34 }}>{sc.name}</td>
          <td className="num"><input className="ob-input budinput" inputMode="decimal" aria-label={`${c.name} ${sc.name} budget`}
            value={inputs[key(c.id, sc.name)] ?? ""} placeholder="0"
            onChange={(e) => setInputs((s) => ({ ...s, [key(c.id, sc.name)]: e.target.value }))} /></td>
          <td className="num muted">{taka(subSpent(c.id, sc.name))}</td>
          <td />
        </tr>
      ))}
    </>
  );
}

function HistoryTable({ trends, periods }: { trends: any; periods: any[] }) {
  const series = trends?.series || [];
  if (series.length <= 1) return <EmptyState icon="clock-rotate-left" title="No history yet" hint="Close a period to start building a history of budgets vs spend." />;
  const statusOf = (id: string) => periods.find((p) => p.id === id)?.status || "closed";
  return (
    <div className="tscroll"><table className="ob-table">
      <thead><tr><th>Period</th><th className="num">Spent</th><th className="num">Saved</th><th className="num">Net worth</th><th>Status</th></tr></thead>
      <tbody>
        {[...series].reverse().map((s: any) => (
          <tr key={s.periodId}>
            <td>{s.periodName}</td>
            <td className="num">{taka(s.totalSpend)}</td>
            <td className="num pos">{taka(s.totalSaved)}</td>
            <td className="num">{taka(s.netWorth)}</td>
            <td><span className={`ob-badge ob-badge--sm ob-badge--${statusOf(s.periodId) === "open" ? "green" : "neutral"}`}>{statusOf(s.periodId)}</span></td>
          </tr>
        ))}
      </tbody>
    </table></div>
  );
}

function Header({ view, switchView, actions, summary, children, rollover, onRollover }: {
  view: View; switchView: (v: View) => void; actions: React.ReactNode; summary: string; children: React.ReactNode;
  rollover?: boolean; onRollover?: (v: boolean) => void;
}) {
  const tabs: { id: View; label: string }[] = [{ id: "period", label: "This period" }, { id: "rollover", label: "Rollover" }, { id: "history", label: "History" }];
  return (
    <>
      <div className="breadcrumb-bar">
        <nav className="breadcrumb"><Icon name="folder" solid={false} /><span className="crumb-link">Dashboard</span><Icon name="chevron-right" /><span className="crumb-cur">Budget</span></nav>
        <div className="bc-actions">{actions}</div>
      </div>
      <div className="secondary-bar">
        <div className="subtabs" role="tablist">
          {tabs.map((t) => <button key={t.id} role="tab" aria-selected={view === t.id} className={`subtab${view === t.id ? " active" : ""}`} onClick={() => switchView(t.id)}>{t.label}</button>)}
        </div>
        {onRollover && view !== "history" && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: 18 }} className="muted">
            <button className={`ob-toggle${rollover ? " on" : ""}`} role="switch" aria-checked={!!rollover} aria-label="Rollover unspent budget" onClick={() => onRollover(!rollover)} />
            Roll over unspent
          </label>
        )}
        <span style={{ marginLeft: "auto" }} className="muted num">{summary}</span>
      </div>
      {children}
    </>
  );
}
