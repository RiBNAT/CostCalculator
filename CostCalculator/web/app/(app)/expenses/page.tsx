"use client";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { usePeriods } from "@/lib/period";
import { useToast } from "@/lib/toast";
import { useConfirm } from "@/lib/confirm";
import { taka, paisaToInput } from "@/lib/money";
import { accountIcon, colorFor, fmtDate, isoDate, lookup } from "@/lib/format";
import type { Expense } from "@/lib/types";
import { Icon, Spinner, EmptyState, Dropdown } from "@/components/ui";
import { Select, Opt } from "@/components/Select";
import { Modal } from "@/components/Modal";
import { AmountInput, DateField, Field } from "@/components/fields";

export default function ExpensesPage() {
  const { selected } = usePeriods();
  const pid = selected?.id;
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [filter, setFilter] = useState({ q: "", categoryId: "", accountId: "" });
  const [editing, setEditing] = useState<Expense | "new" | null>(null);

  const { data: categories = [] } = useQuery({ queryKey: ["categories"], queryFn: api.listCategories });
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: api.listAccounts });
  const { data: recurring = [] } = useQuery({ queryKey: ["recurring"], queryFn: api.listRecurring });
  const { data: expenses, isLoading } = useQuery({
    queryKey: ["expenses", pid, filter],
    queryFn: () => api.listExpenses(pid!, { q: filter.q || undefined, categoryId: filter.categoryId || undefined, accountId: filter.accountId || undefined }),
    enabled: !!pid,
  });

  const refresh = () => { qc.invalidateQueries({ queryKey: ["expenses", pid] }); qc.invalidateQueries({ queryKey: ["summary", pid] }); };
  const del = useMutation({ mutationFn: (id: string) => api.deleteExpense(pid!, id), onSuccess: () => { refresh(); toast("Expense removed"); } });
  const quickAdd = useMutation({
    mutationFn: (r: { categoryId: string; subcategory: string; accountId: string; amount: number }) =>
      api.createExpense(pid!, { date: isoDate(new Date().toISOString()), categoryId: r.categoryId, subcategory: r.subcategory, accountId: r.accountId, amountExpr: paisaToInput(r.amount) }),
    onSuccess: () => { refresh(); toast("Added from template"); },
  });

  const expenseCats = categories.filter((c) => c.kind === "expense" && c.active);
  const catFilterOpts: Opt[] = [{ value: "", label: "All categories" }, ...expenseCats.map((c) => ({ value: c.id, label: c.name, dot: colorFor(c.id) }))];
  const acctFilterOpts: Opt[] = [{ value: "", label: "All accounts" }, ...accounts.filter((a) => a.kind !== "virtual").map((a) => ({ value: a.id, label: a.name }))];

  const rows = expenses || [];
  const total = useMemo(() => rows.reduce((s, e) => s + e.amount, 0), [rows]);
  const open = selected?.status === "open";

  const exportCsv = async () => {
    if (!pid) return;
    const blob = await api.exportCsv(pid);
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `${selected?.name || "expenses"}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="breadcrumb-bar">
        <nav className="breadcrumb"><Icon name="folder" solid={false} /><span className="crumb-link">Dashboard</span><Icon name="chevron-right" /><span className="crumb-cur">Expenses</span></nav>
        <div className="bc-actions">
          {recurring.length > 0 && open && (
            <Dropdown align="right" width={260} trigger={(o, t) => <button className="ob-btn ob-btn--ghost" onClick={t} aria-expanded={o}><Icon name="repeat" /> Recurring</button>}>
              {(close) => (<>
                <div className="ob-pop__head">Quick add</div>
                {recurring.map((r) => (
                  <button key={r.id} className="ob-menu__item" onClick={() => { quickAdd.mutate(r); close(); }}>
                    <Icon name="bolt" /><span>{r.label}</span><small>{taka(r.amount)}</small>
                  </button>
                ))}
              </>)}
            </Dropdown>
          )}
          <button className="ob-btn ob-btn--secondary" onClick={exportCsv}><Icon name="arrow-up-from-bracket" /> Export CSV</button>
          {open && <button className="ob-btn ob-btn--primary" onClick={() => setEditing("new")}><Icon name="plus" /> Add expense</button>}
        </div>
      </div>

      <div className="secondary-bar">
        <div className="field field--search"><Icon name="magnifying-glass" solid={false} /><input placeholder="Search remarks…" value={filter.q} onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))} /></div>
        <div style={{ width: 190 }}><Select pill value={filter.categoryId} onChange={(v) => setFilter((f) => ({ ...f, categoryId: v }))} options={catFilterOpts} ariaLabel="Filter by category" /></div>
        <div style={{ width: 170 }}><Select pill value={filter.accountId} onChange={(v) => setFilter((f) => ({ ...f, accountId: v }))} options={acctFilterOpts} ariaLabel="Filter by account" /></div>
        <span style={{ marginLeft: "auto" }} className="muted num">{rows.length} expenses · {taka(total)}</span>
      </div>

      <div className="page">
        {!selected ? <EmptyState icon="calendar-plus" title="No period selected" /> :
          isLoading ? <Spinner /> :
          rows.length === 0 ? <EmptyState icon="receipt" title="No expenses match" hint={open ? "Add your first expense for this cycle." : "This period is closed."} action={open ? <button className="ob-btn ob-btn--primary" onClick={() => setEditing("new")}><Icon name="plus" /> Add expense</button> : undefined} /> :
          <div className="tscroll"><table className="ob-table">
            <thead><tr><th>Date</th><th>Category</th><th>Subcategory</th><th>Account</th><th>Remarks</th><th className="num">Amount</th><th /></tr></thead>
            <tbody>
              {rows.map((e) => {
                const cat = lookup(categories, e.categoryId); const ac = lookup(accounts, e.accountId);
                return (
                  <tr key={e.id}>
                    <td className="num">{fmtDate(e.date)}</td>
                    <td><span className="cat-dot" style={{ background: colorFor(e.categoryId) }} />{cat?.name || "—"}</td>
                    <td>{e.subcategory || "—"}</td>
                    <td><span className="acct"><Icon name={accountIcon(ac?.kind)} />{ac?.name || "—"}</span></td>
                    <td className="muted">{e.remarks || ""}</td>
                    <td className="num">{taka(e.amount)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {open && <>
                        <button className="rowact" title="Edit" onClick={() => setEditing(e)}><Icon name="pen" /></button>
                        <button className="rowact" title="Delete" onClick={async () => { if (await confirm({ title: "Delete this expense?", message: "This can't be undone.", danger: true })) del.mutate(e.id); }}><Icon name="trash-can" solid={false} /></button>
                      </>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>}
      </div>

      {editing && pid && (
        <ExpenseDialog periodId={pid} period={selected!} expense={editing === "new" ? null : editing}
          categories={expenseCats} accounts={accounts.filter((a) => a.active && a.kind !== "virtual")}
          onClose={() => setEditing(null)} onSaved={refresh} />
      )}
    </>
  );
}

function ExpenseDialog({ periodId, period, expense, categories, accounts, onClose, onSaved }: {
  periodId: string; period: any; expense: Expense | null; categories: any[]; accounts: any[]; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const editing = !!expense;
  const [date, setDate] = useState(expense ? isoDate(expense.date) : isoDate(new Date().toISOString()));
  const [categoryId, setCategoryId] = useState(expense?.categoryId || categories[0]?.id || "");
  const [subcategory, setSubcategory] = useState(expense?.subcategory || "");
  const [accountId, setAccountId] = useState(expense?.accountId || accounts[0]?.id || "");
  const [amount, setAmount] = useState(expense ? paisaToInput(expense.amount) : "");
  const [remarks, setRemarks] = useState(expense?.remarks || "");
  const [err, setErr] = useState(false);

  const cat = categories.find((c) => c.id === categoryId);
  const subOpts: Opt[] = (cat?.subcategories || []).filter((s: any) => s.active).map((s: any) => ({ value: s.name, label: s.name }));
  useEffect(() => {
    if (!subOpts.some((o) => o.value === subcategory)) setSubcategory(subOpts[0]?.value || "");
  }, [categoryId]); // eslint-disable-line

  const save = useMutation({
    mutationFn: (body: any) => editing ? api.updateExpense(periodId, expense!.id, body) : api.createExpense(periodId, body),
    onSuccess: () => { onSaved(); },
  });

  const submit = async (another: boolean) => {
    const { evalAmountExpr } = await import("@/lib/money");
    if (isNaN(evalAmountExpr(amount)) || evalAmountExpr(amount) <= 0) { setErr(true); return; }
    const body = { date, categoryId, subcategory, accountId, amountExpr: amount, remarks };
    await save.mutateAsync(body);
    toast(editing ? "Expense updated" : "Expense added");
    if (another && !editing) { setAmount(""); setRemarks(""); }
    else onClose();
  };

  const catOpts: Opt[] = categories.map((c) => ({ value: c.id, label: c.name, dot: colorFor(c.id) }));
  const acctOpts: Opt[] = accounts.map((a) => ({ value: a.id, label: a.name, icon: accountIcon(a.kind) }));

  return (
    <Modal title={editing ? "Edit expense" : "Add expense"} onClose={onClose}
      footer={<>
        {!editing && <button className="ob-btn ob-btn--text" style={{ marginRight: "auto" }} onClick={() => submit(true)}><Icon name="plus" /> Save &amp; add another</button>}
        <button className="ob-btn ob-btn--secondary" onClick={onClose}>Cancel</button>
        <button className="ob-btn ob-btn--primary" onClick={() => submit(false)} disabled={save.isPending}><Icon name="check" /> {editing ? "Save" : "Save expense"}</button>
      </>}>
      <div className="ob-form">
        <div className="grid2">
          <Field label="Date"><DateField value={date} onChange={setDate} min={isoDate(period.startDate)} max={isoDate(period.endDate)} /></Field>
          <Field label="Account"><Select value={accountId} onChange={setAccountId} options={acctOpts} ariaLabel="Account" /></Field>
        </div>
        <Field label="Category"><Select value={categoryId} onChange={(v) => { setCategoryId(v); setSubcategory(""); }} options={catOpts} ariaLabel="Category" /></Field>
        <Field label="Subcategory"><Select value={subcategory} onChange={setSubcategory} options={subOpts} placeholder="—" ariaLabel="Subcategory" /></Field>
        <Field label="Amount" hint="type a sum like 360+20+330"><AmountInput value={amount} onChange={(v) => { setAmount(v); setErr(false); }} invalid={err} /></Field>
        <Field label="Remarks"><input className="ob-input" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="optional" /></Field>
      </div>
    </Modal>
  );
}
