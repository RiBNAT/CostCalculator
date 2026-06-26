"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { usePeriods } from "@/lib/period";
import { useToast } from "@/lib/toast";
import { taka, paisaToInput, evalAmountExpr, withSign } from "@/lib/money";
import { accountIcon, fmtDate, isoDate } from "@/lib/format";
import type { Account, AccountStatus } from "@/lib/types";
import { Icon, Spinner, EmptyState } from "@/components/ui";
import { Select, Opt } from "@/components/Select";
import { Modal } from "@/components/Modal";
import { AmountInput, DateField, Field } from "@/components/fields";

const HUES = [["--green-bg", "--green-text"], ["--purple-bg", "--purple-text"], ["--orange-bg", "--orange-text"], ["--coral-bg", "--coral-text"]];

export default function SavingsPage() {
  const { selected } = usePeriods();
  const pid = selected?.id;
  const qc = useQueryClient();
  const toast = useToast();
  const [goalEdit, setGoalEdit] = useState<Account | "new" | null>(null);
  const [moving, setMoving] = useState(false);

  const { data: summary, isLoading } = useQuery({ queryKey: ["summary", pid], queryFn: () => api.periodSummary(pid!), enabled: !!pid });
  const { data: history = [] } = useQuery({ queryKey: ["savingsHistory"], queryFn: api.savingsHistory });
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: api.listAccounts });
  const open = selected?.status === "open";

  const refresh = () => { qc.invalidateQueries({ queryKey: ["summary", pid] }); qc.invalidateQueries({ queryKey: ["accounts"] }); qc.invalidateQueries({ queryKey: ["savingsHistory"] }); };

  const header = (
    <div className="breadcrumb-bar">
      <nav className="breadcrumb"><Icon name="folder" solid={false} /><span className="crumb-link">Dashboard</span><Icon name="chevron-right" /><span className="crumb-cur">Savings</span></nav>
      <div className="bc-actions">
        {open && <button className="ob-btn ob-btn--secondary" onClick={() => setMoving(true)}><Icon name="right-left" /> Move to savings</button>}
        <button className="ob-btn ob-btn--primary" onClick={() => setGoalEdit("new")}><Icon name="plus" /> New goal</button>
      </div>
    </div>
  );

  if (!selected) return <>{header}<div className="page"><EmptyState icon="calendar-plus" title="No period selected" /></div></>;
  if (isLoading || !summary) return <>{header}<div className="page"><Spinner /></div></>;

  const savings: AccountStatus[] = summary.savings || [];
  const realAccounts = (summary.accounts || []).filter((a) => a.account.kind !== "virtual");
  const inHandTotal = realAccounts.reduce((s, a) => s + a.current, 0);
  const totalDelta = realAccounts.reduce((s, a) => s + (a.current - a.opening), 0);
  const histMax = Math.max(1, ...history.map((h) => h.total));

  return (
    <>
      {header}
      <div className="page">
        <h3 className="section-h">Savings goals</h3>
        {savings.length === 0 ? <EmptyState icon="piggy-bank" title="No savings accounts yet" hint="Create a goal to start setting money aside." action={<button className="ob-btn ob-btn--primary" onClick={() => setGoalEdit("new")}><Icon name="plus" /> New goal</button>} /> : (
          <div className="goal-grid" style={{ marginBottom: "var(--spacing-24)" }}>
            {savings.map((s, i) => {
              const goal = s.account.goal || 0;
              const pct = goal > 0 ? Math.min(100, Math.round(s.current / goal * 100)) : 0;
              const delta = s.current - s.opening;
              const h = HUES[i % HUES.length];
              return (
                <div className="ob-card" key={s.account.id}>
                  <div className="goal__top">
                    <span className="goal__icon" style={{ background: `var(${h[0]})`, color: `var(${h[1]})` }}><Icon name="piggy-bank" /></span>
                    <div><div className="goal__name">{s.account.name}</div><div className="muted" style={{ fontSize: 12 }}>{withSign(delta)} this period</div></div>
                    {open && <button className="rowact" style={{ marginLeft: "auto" }} title="Edit goal" onClick={() => setGoalEdit(s.account)}><Icon name="pen" /></button>}
                  </div>
                  {goal > 0 ? <>
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}><span className="goal__pct">{pct}%</span><span className="muted num" style={{ fontSize: 12 }}>{taka(goal)} target</span></div>
                    <div className="prog" style={{ marginTop: 10 }}><div className={`prog__fill${pct >= 80 ? " prog__fill--good" : ""}`} style={{ width: `${pct}%` }} /></div>
                    <div className="goal__nums"><span className="num">{taka(s.current)} saved</span><span className="num">{taka(Math.max(0, goal - s.current))} to go</span></div>
                  </> : <>
                    <div className="goal__pct num">{taka(s.current)}</div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>No target set{open ? " — tap the pencil to set one" : ""}</div>
                  </>}
                </div>
              );
            })}
          </div>
        )}

        <h3 className="section-h">Account balances</h3>
        <div className="ob-card" style={{ padding: 0 }}>
          <table className="ob-table">
            <thead><tr><th>Account</th><th>Type</th><th className="num">Balance</th><th className="num">Δ this period</th></tr></thead>
            <tbody>
              {realAccounts.map((a) => {
                const d = a.current - a.opening;
                return (
                  <tr key={a.account.id}>
                    <td><span className="acct"><Icon name={accountIcon(a.account.kind)} /></span> {a.account.name}</td>
                    <td className="muted">{a.account.kind}</td>
                    <td className="num">{taka(a.current)}</td>
                    <td className="num" style={{ color: d < 0 ? "var(--red-text)" : "var(--green-text)" }}>{withSign(d)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr><td colSpan={2}>Total in hand</td><td className="num">{taka(inHandTotal)}</td><td className="num" style={{ color: totalDelta < 0 ? "var(--red-text)" : "var(--green-text)" }}>{withSign(totalDelta)}</td></tr></tfoot>
          </table>
        </div>

        {history.length > 1 && <>
          <h3 className="section-h" style={{ marginTop: "var(--spacing-24)" }}>Savings over time</h3>
          <div className="ob-card">
            <div className="trend">
              {history.map((h, i) => <div key={h.periodId} className={`trend__bar${i === history.length - 1 ? " is-last" : ""}`} style={{ height: `${Math.max(4, Math.round(h.total / histMax * 100))}%` }} title={`${h.periodName}: ${taka(h.total)}`} />)}
            </div>
            <div className="trend__labels">{history.map((h) => <span key={h.periodId}>{fmtDate(h.startDate)}</span>)}</div>
          </div>
        </>}
      </div>

      {goalEdit && <GoalDialog account={goalEdit === "new" ? null : goalEdit} onClose={() => setGoalEdit(null)} onSaved={refresh} />}
      {moving && <MoveToSavingsDialog period={selected} accounts={accounts.filter((a) => a.active && a.kind !== "virtual")} onClose={() => setMoving(false)} onSaved={refresh} pid={pid!} />}
    </>
  );
}

function GoalDialog({ account, onClose, onSaved }: { account: Account | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const editing = !!account;
  const [name, setName] = useState(account?.name || "");
  const [goal, setGoal] = useState(account?.goal ? paisaToInput(account.goal) : "");
  const [err, setErr] = useState<{ name?: boolean; goal?: boolean }>({});

  const save = useMutation({
    mutationFn: async () => {
      const g = evalAmountExpr(goal) || 0;
      // updateAccount requires name+kind (the backend replaces them); send the existing values.
      if (editing) await api.updateAccount(account!.id, { name: account!.name, kind: account!.kind, goal: g });
      else await api.createAccount({ name: name.trim(), kind: "savings", goal: g });
    },
    onSuccess: () => { onSaved(); onClose(); toast(editing ? "Goal updated" : "Goal created"); },
    onError: (e: any) => toast(e?.message || "Could not save goal"),
  });
  const submit = () => {
    const g = evalAmountExpr(goal);
    const e = { name: !editing && !name.trim(), goal: isNaN(g) || g <= 0 };
    if (e.name || e.goal) { setErr(e); return; }
    save.mutate();
  };

  return (
    <Modal title={editing ? `Goal · ${account!.name}` : "New savings goal"} width={440} onClose={onClose}
      footer={<>
        <button className="ob-btn ob-btn--secondary" onClick={onClose}>Cancel</button>
        <button className="ob-btn ob-btn--primary" onClick={submit} disabled={save.isPending}><Icon name="check" /> {editing ? "Save goal" : "Create goal"}</button>
      </>}>
      <div className="ob-form">
        {!editing && <Field label="Goal name" hint="creates a savings account"><input className={`ob-input${err.name ? " err" : ""}`} value={name} onChange={(e) => { setName(e.target.value); setErr((x) => ({ ...x, name: false })); }} placeholder="e.g. Umrah fund" /></Field>}
        <Field label="Target amount"><AmountInput value={goal} onChange={(v) => { setGoal(v); setErr((x) => ({ ...x, goal: false })); }} invalid={err.goal} /></Field>
      </div>
    </Modal>
  );
}

function MoveToSavingsDialog({ period, accounts, pid, onClose, onSaved }: { period: any; accounts: Account[]; pid: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const savingsAccts = accounts.filter((a) => a.kind === "savings");
  const sourceAccts = accounts.filter((a) => a.kind !== "savings");
  const [fromId, setFromId] = useState(sourceAccts[0]?.id || "");
  const [toId, setToId] = useState(savingsAccts[0]?.id || "");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(isoDate(new Date().toISOString()));
  const [note, setNote] = useState("");
  const [err, setErr] = useState(false);

  const save = useMutation({
    mutationFn: (b: any) => api.createTransfer(pid, b),
    onSuccess: () => { onSaved(); onClose(); toast("Moved to savings"); },
    onError: (e: any) => toast(e?.message || "Could not move money"),
  });
  const submit = () => {
    const amt = evalAmountExpr(amount);
    if (isNaN(amt) || amt <= 0) { setErr(true); return; }
    if (fromId === toId) { toast("Pick two different accounts"); return; }
    save.mutate({ date, fromAccountId: fromId, toAccountId: toId, amountExpr: amount, feeExpr: "0", note });
  };
  const srcOpts: Opt[] = sourceAccts.map((a) => ({ value: a.id, label: a.name, icon: accountIcon(a.kind) }));
  const dstOpts: Opt[] = savingsAccts.map((a) => ({ value: a.id, label: a.name, icon: "piggy-bank" }));

  return (
    <Modal title="Move to savings" width={460} onClose={onClose}
      footer={<>
        <button className="ob-btn ob-btn--secondary" onClick={onClose}>Cancel</button>
        <button className="ob-btn ob-btn--primary" onClick={submit} disabled={save.isPending || !savingsAccts.length}><Icon name="piggy-bank" /> Move money</button>
      </>}>
      {savingsAccts.length === 0 ? <p className="muted" style={{ margin: 0 }}>Create a savings goal first to move money into it.</p> : (
        <div className="ob-form">
          <div className="grid2">
            <Field label="From"><Select value={fromId} onChange={setFromId} options={srcOpts} ariaLabel="From account" /></Field>
            <Field label="Into savings"><Select value={toId} onChange={setToId} options={dstOpts} ariaLabel="Savings account" /></Field>
          </div>
          <div className="grid2">
            <Field label="Amount"><AmountInput value={amount} onChange={(v) => { setAmount(v); setErr(false); }} invalid={err} /></Field>
            <Field label="Date"><DateField value={date} onChange={setDate} min={isoDate(period.startDate)} max={isoDate(period.endDate)} /></Field>
          </div>
          <Field label="Note"><input className="ob-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" /></Field>
        </div>
      )}
    </Modal>
  );
}
