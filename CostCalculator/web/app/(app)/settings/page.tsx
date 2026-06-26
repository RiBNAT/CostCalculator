"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { usePeriods } from "@/lib/period";
import { useToast } from "@/lib/toast";
import { useConfirm } from "@/lib/confirm";
import { taka, paisaToInput, evalAmountExpr } from "@/lib/money";
import { accountIcon, fmtRange, isoDate } from "@/lib/format";
import type { Account, AccountKind, Category, CategoryKind, Period, RecurringExpense } from "@/lib/types";
import { Icon, Spinner, EmptyState } from "@/components/ui";
import { Select, Opt } from "@/components/Select";
import { Modal } from "@/components/Modal";
import { AmountInput, DateField, Field } from "@/components/fields";

type Tab = "profile" | "categories" | "accounts" | "periods" | "recurring";

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("profile");
  const tabs: { id: Tab; label: string }[] = [
    { id: "profile", label: "Profile" }, { id: "categories", label: "Categories" },
    { id: "accounts", label: "Accounts" }, { id: "periods", label: "Periods" }, { id: "recurring", label: "Recurring" },
  ];
  return (
    <>
      <div className="breadcrumb-bar">
        <nav className="breadcrumb"><Icon name="folder" solid={false} /><span className="crumb-link">Dashboard</span><Icon name="chevron-right" /><span className="crumb-cur">Settings</span></nav>
      </div>
      <div className="secondary-bar">
        <div className="subtabs" role="tablist">
          {tabs.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} className={`subtab${tab === t.id ? " active" : ""}`} onClick={() => setTab(t.id)}>{t.label}</button>)}
        </div>
      </div>
      <div className="page">
        {tab === "profile" && <ProfileTab />}
        {tab === "categories" && <CategoriesTab />}
        {tab === "accounts" && <AccountsTab />}
        {tab === "periods" && <PeriodsTab />}
        {tab === "recurring" && <RecurringTab />}
      </div>
    </>
  );
}

/* ----------------------------- Profile ----------------------------- */
function ProfileTab() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(user?.name || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [emailModal, setEmailModal] = useState(false);
  const [pwdModal, setPwdModal] = useState(false);

  const saveProfile = useMutation({
    mutationFn: () => api.updateProfile({ name: name.trim(), phone: phone.trim() }),
    onSuccess: async () => { await refresh(); toast("Profile saved"); },
    onError: (e: any) => toast(e?.message || "Could not save profile"),
  });
  const initials = (user?.name || "?").split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="set-grid">
      <div className="ob-card">
        <div className="ob-card__title-bar"><h3 className="ob-card__title">Profile</h3></div>
        <div className="set-profile" style={{ marginBottom: 16 }}><span className="av">{initials}</span><div><div className="lbl">{user?.name}</div><div className="sub">{user?.email}</div></div></div>
        <div className="ob-form">
          <Field label="Full name"><input className="ob-input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Phone"><input className="ob-input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="optional" /></Field>
          <div><button className="ob-btn ob-btn--primary" onClick={() => saveProfile.mutate()} disabled={saveProfile.isPending || !name.trim()}><Icon name="check" /> Save profile</button></div>
        </div>
      </div>
      <div className="ob-card">
        <div className="ob-card__title-bar"><h3 className="ob-card__title">Security</h3></div>
        <div className="set-row"><div><div className="lbl">Email</div><div className="sub">{user?.email}</div></div><button className="ob-btn ob-btn--secondary" onClick={() => setEmailModal(true)}>Change</button></div>
        <div className="set-row"><div><div className="lbl">Password</div><div className="sub">Use a strong, unique password</div></div><button className="ob-btn ob-btn--secondary" onClick={() => setPwdModal(true)}>Change</button></div>
      </div>
      {emailModal && <EmailModal onClose={() => setEmailModal(false)} onSaved={refresh} />}
      {pwdModal && <PasswordModal onClose={() => setPwdModal(false)} />}
    </div>
  );
}

function EmailModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const save = useMutation({
    mutationFn: () => api.updateEmail({ email: email.trim(), password }),
    onSuccess: async () => { await onSaved(); onClose(); toast("Email updated"); },
    onError: (e: any) => toast(e?.message || "Could not update email"),
  });
  return (
    <Modal title="Change email" width={440} onClose={onClose}
      footer={<><button className="ob-btn ob-btn--secondary" onClick={onClose}>Cancel</button><button className="ob-btn ob-btn--primary" onClick={() => save.mutate()} disabled={save.isPending || !email.trim() || !password}><Icon name="check" /> Update email</button></>}>
      <div className="ob-form">
        <Field label="New email"><input className="ob-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></Field>
        <Field label="Current password" hint="to confirm it's you"><input className="ob-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function PasswordModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const save = useMutation({
    mutationFn: () => api.updatePassword({ currentPassword: current, newPassword: next }),
    onSuccess: () => { onClose(); toast("Password changed"); },
    onError: (e: any) => toast(e?.message || "Could not change password"),
  });
  const tooShort = next.length > 0 && next.length < 8;
  return (
    <Modal title="Change password" width={440} onClose={onClose}
      footer={<><button className="ob-btn ob-btn--secondary" onClick={onClose}>Cancel</button><button className="ob-btn ob-btn--primary" onClick={() => save.mutate()} disabled={save.isPending || !current || next.length < 8}><Icon name="check" /> Change password</button></>}>
      <div className="ob-form">
        <Field label="Current password"><input className="ob-input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
        <Field label="New password" hint="at least 8 characters"><input className={`ob-input${tooShort ? " err" : ""}`} type="password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

/* ----------------------------- Categories ----------------------------- */
const KIND_LABEL: Record<CategoryKind, string> = { expense: "Spending", savings: "Savings", pay: "Income" };

function CategoriesTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);
  const { data: categories = [], isLoading } = useQuery({ queryKey: ["categories"], queryFn: api.listCategories });
  const refresh = () => qc.invalidateQueries({ queryKey: ["categories"] });

  // Always send the full object — the backend replaces name/kind/subcategories on update.
  const update = useMutation({
    mutationFn: (c: Category) => api.updateCategory(c.id, { name: c.name, kind: c.kind, subcategories: c.subcategories, active: c.active }),
    onSuccess: refresh, onError: (e: any) => toast(e?.message || "Could not update category"),
  });

  if (isLoading) return <Spinner />;
  const kinds: CategoryKind[] = ["expense", "savings", "pay"];

  const addSub = (c: Category, name: string) => {
    const n = name.trim(); if (!n || c.subcategories.some((s) => s.name.toLowerCase() === n.toLowerCase())) return;
    update.mutate({ ...c, subcategories: [...c.subcategories, { name: n, active: true }] });
  };
  const removeSub = (c: Category, name: string) => update.mutate({ ...c, subcategories: c.subcategories.filter((s) => s.name !== name) });

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}><button className="ob-btn ob-btn--primary" onClick={() => setAdding(true)}><Icon name="plus" /> New category</button></div>
      {kinds.map((k) => {
        const list = categories.filter((c) => c.kind === k);
        if (!list.length) return null;
        return (
          <div className="ob-card" key={k} style={{ marginBottom: 16 }}>
            <div className="ob-card__title-bar"><h3 className="ob-card__title">{KIND_LABEL[k]}</h3></div>
            {list.map((c) => (
              <div className="ms-cat" key={c.id}>
                <div className="ms-cat__name">
                  <span style={{ opacity: c.active ? 1 : 0.5 }}>{c.name}</span>
                  {!c.active && <span className="ob-badge ob-badge--neutral ob-badge--sm" style={{ marginLeft: 8 }}>Inactive</span>}
                  <button className={`ob-toggle${c.active ? " on" : ""}`} role="switch" aria-checked={c.active} aria-label={`${c.active ? "Deactivate" : "Activate"} ${c.name}`} style={{ marginLeft: "auto" }} onClick={() => update.mutate({ ...c, active: !c.active })} />
                  <button className="rowact" title="Delete" style={{ marginLeft: 8 }} onClick={async () => { if (await confirm({ title: `Deactivate "${c.name}"?`, message: "It stays on past expenses but won't appear in new ones.", danger: true, confirmLabel: "Deactivate" })) update.mutate({ ...c, active: false }); }}><Icon name="trash-can" solid={false} /></button>
                </div>
                <SubChips category={c} onAdd={addSub} onRemove={removeSub} />
              </div>
            ))}
          </div>
        );
      })}
      {adding && <CategoryModal onClose={() => setAdding(false)} onSaved={refresh} />}
    </>
  );
}

function SubChips({ category, onAdd, onRemove }: { category: Category; onAdd: (c: Category, n: string) => void; onRemove: (c: Category, n: string) => void }) {
  const [val, setVal] = useState("");
  return (
    <div className="ms-chips">
      {category.subcategories.map((s) => (
        <span className="ms-chip" key={s.name} style={{ opacity: s.active ? 1 : 0.5 }}>{s.name}<button className="ms-chip__x" aria-label={`Remove ${s.name}`} onClick={() => onRemove(category, s.name)}><Icon name="xmark" /></button></span>
      ))}
      <span className="ms-add">
        <input className="ms-add__in" value={val} placeholder="add…" onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { onAdd(category, val); setVal(""); } }} />
        <button className="ms-add__btn" aria-label="Add subcategory" onClick={() => { onAdd(category, val); setVal(""); }}><Icon name="plus" /></button>
      </span>
    </div>
  );
}

function CategoryModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<CategoryKind>("expense");
  const [err, setErr] = useState(false);
  const save = useMutation({
    mutationFn: () => api.createCategory({ name: name.trim(), kind, subcategories: [] }),
    onSuccess: () => { onSaved(); onClose(); toast("Category created"); },
    onError: (e: any) => toast(e?.message || "Could not create category"),
  });
  const opts: Opt[] = [{ value: "expense", label: "Spending" }, { value: "savings", label: "Savings" }, { value: "pay", label: "Income" }];
  return (
    <Modal title="New category" width={440} onClose={onClose}
      footer={<><button className="ob-btn ob-btn--secondary" onClick={onClose}>Cancel</button><button className="ob-btn ob-btn--primary" onClick={() => { if (!name.trim()) { setErr(true); return; } save.mutate(); }} disabled={save.isPending}><Icon name="check" /> Create</button></>}>
      <div className="ob-form">
        <Field label="Name"><input className={`ob-input${err ? " err" : ""}`} value={name} onChange={(e) => { setName(e.target.value); setErr(false); }} placeholder="e.g. Groceries" /></Field>
        <Field label="Kind"><Select value={kind} onChange={(v) => setKind(v as CategoryKind)} options={opts} ariaLabel="Category kind" /></Field>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>Add subcategories from the list after creating.</p>
      </div>
    </Modal>
  );
}

/* ----------------------------- Accounts ----------------------------- */
function AccountsTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<Account | "new" | null>(null);
  const { data: accounts = [], isLoading } = useQuery({ queryKey: ["accounts"], queryFn: api.listAccounts });
  const refresh = () => qc.invalidateQueries({ queryKey: ["accounts"] });
  const update = useMutation({
    mutationFn: (a: Account) => api.updateAccount(a.id, { name: a.name, kind: a.kind, active: a.active }),
    onSuccess: refresh, onError: (e: any) => toast(e?.message || "Could not update account"),
  });
  if (isLoading) return <Spinner />;
  const real = accounts.filter((a) => a.kind !== "virtual");
  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}><button className="ob-btn ob-btn--primary" onClick={() => setEditing("new")}><Icon name="plus" /> New account</button></div>
      <div className="ob-card" style={{ padding: 0 }}>
        <table className="ob-table">
          <thead><tr><th>Account</th><th>Type</th><th className="num">Goal</th><th>Active</th><th /></tr></thead>
          <tbody>
            {real.map((a) => (
              <tr key={a.id}>
                <td><span className="acct"><Icon name={accountIcon(a.kind)} /></span> {a.name}</td>
                <td className="muted">{a.kind}</td>
                <td className="num">{a.goal ? taka(a.goal) : <span className="muted">—</span>}</td>
                <td><button className={`ob-toggle${a.active ? " on" : ""}`} role="switch" aria-checked={a.active} aria-label={`${a.active ? "Deactivate" : "Activate"} ${a.name}`} onClick={() => update.mutate({ ...a, active: !a.active })} /></td>
                <td><button className="rowact" title="Edit" onClick={() => setEditing(a)}><Icon name="pen" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <AccountModal account={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={refresh} />}
    </>
  );
}

function AccountModal({ account, onClose, onSaved }: { account: Account | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const editing = !!account;
  const [name, setName] = useState(account?.name || "");
  const [kind, setKind] = useState<AccountKind>(account?.kind || "bank");
  const [goal, setGoal] = useState(account?.goal ? paisaToInput(account.goal) : "");
  const [err, setErr] = useState(false);
  const save = useMutation({
    mutationFn: async () => {
      const body: Partial<Account> = { name: name.trim(), kind };
      if (kind === "savings") body.goal = evalAmountExpr(goal) || 0;
      if (editing) await api.updateAccount(account!.id, body);
      else await api.createAccount(body);
    },
    onSuccess: () => { onSaved(); onClose(); toast(editing ? "Account updated" : "Account created"); },
    onError: (e: any) => toast(e?.message || "Could not save account"),
  });
  const opts: Opt[] = [
    { value: "bank", label: "Bank", icon: "building-columns" }, { value: "mobile", label: "Mobile (bKash/Nagad)", icon: "mobile-screen" },
    { value: "cash", label: "Cash", icon: "money-bill-wave" }, { value: "savings", label: "Savings", icon: "piggy-bank" },
  ];
  return (
    <Modal title={editing ? `Edit ${account!.name}` : "New account"} width={440} onClose={onClose}
      footer={<><button className="ob-btn ob-btn--secondary" onClick={onClose}>Cancel</button><button className="ob-btn ob-btn--primary" onClick={() => { if (!name.trim()) { setErr(true); return; } save.mutate(); }} disabled={save.isPending}><Icon name="check" /> {editing ? "Save" : "Create"}</button></>}>
      <div className="ob-form">
        <Field label="Name"><input className={`ob-input${err ? " err" : ""}`} value={name} onChange={(e) => { setName(e.target.value); setErr(false); }} placeholder="e.g. City Bank" /></Field>
        <Field label="Type"><Select value={kind} onChange={(v) => setKind(v as AccountKind)} options={opts} ariaLabel="Account type" /></Field>
        {kind === "savings" && <Field label="Savings goal" hint="optional target"><AmountInput value={goal} onChange={setGoal} /></Field>}
      </div>
    </Modal>
  );
}

/* ----------------------------- Periods ----------------------------- */
function PeriodsTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const { periods, loading } = usePeriods();
  const [adding, setAdding] = useState(false);
  const [openingFor, setOpeningFor] = useState<Period | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["periods"] });

  const close = useMutation({ mutationFn: (id: string) => api.closePeriod(id), onSuccess: () => { refresh(); toast("Period closed — balances carried forward"); }, onError: (e: any) => toast(e?.message || "Could not close period") });
  const reopen = useMutation({ mutationFn: (id: string) => api.reopenPeriod(id), onSuccess: () => { refresh(); toast("Period reopened"); }, onError: (e: any) => toast(e?.message || "Could not reopen — only the latest period can reopen") });

  if (loading) return <Spinner />;
  const sorted = [...periods].sort((a, b) => (b.startDate || "").localeCompare(a.startDate || ""));

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}><button className="ob-btn ob-btn--primary" onClick={() => setAdding(true)}><Icon name="plus" /> New period</button></div>
      {sorted.length === 0 ? <EmptyState icon="calendar-plus" title="No periods yet" hint="Create your first salary cycle." action={<button className="ob-btn ob-btn--primary" onClick={() => setAdding(true)}><Icon name="plus" /> New period</button>} /> : (
        <div className="ob-card" style={{ padding: 0 }}>
          <table className="ob-table">
            <thead><tr><th>Period</th><th>Cycle</th><th>Status</th><th /></tr></thead>
            <tbody>
              {sorted.map((p, i) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td className="num muted">{fmtRange(p.startDate, p.endDate)}</td>
                  <td><span className={`ob-badge ob-badge--sm ob-badge--${p.status === "open" ? "green" : "neutral"}`}>{p.status}</span></td>
                  <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                    <button className="rowact" title="Opening balances" onClick={() => setOpeningFor(p)}><Icon name="scale-balanced" /></button>
                    {p.status === "open"
                      ? <button className="rowact" title="Close period" onClick={async () => { if (await confirm({ title: `Close "${p.name}"?`, message: "Closing snapshots balances into the next period's opening." })) close.mutate(p.id); }}><Icon name="lock" /></button>
                      : i === 0 && <button className="rowact" title="Reopen period" onClick={() => reopen.mutate(p.id)}><Icon name="lock-open" /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding && <PeriodModal onClose={() => setAdding(false)} onSaved={refresh} />}
      {openingFor && <OpeningBalancesModal period={openingFor} onClose={() => setOpeningFor(null)} onSaved={refresh} />}
    </>
  );
}

function PeriodModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [err, setErr] = useState<{ name?: boolean; dates?: boolean }>({});
  const save = useMutation({
    mutationFn: () => api.createPeriod({ name: name.trim(), startDate: start, endDate: end }),
    onSuccess: () => { onSaved(); onClose(); toast("Period created"); },
    onError: (e: any) => toast(e?.message || "Could not create period"),
  });
  const submit = () => {
    const e = { name: !name.trim(), dates: !start || !end || end < start };
    if (e.name || e.dates) { setErr(e); return; }
    save.mutate();
  };
  return (
    <Modal title="New period" width={460} onClose={onClose}
      footer={<><button className="ob-btn ob-btn--secondary" onClick={onClose}>Cancel</button><button className="ob-btn ob-btn--primary" onClick={submit} disabled={save.isPending}><Icon name="check" /> Create period</button></>}>
      <div className="ob-form">
        <Field label="Name"><input className={`ob-input${err.name ? " err" : ""}`} value={name} onChange={(e) => { setName(e.target.value); setErr((x) => ({ ...x, name: false })); }} placeholder="e.g. June 2026" /></Field>
        <div className="grid2">
          <Field label="Start date"><DateField value={start} onChange={(v) => { setStart(v); setErr((x) => ({ ...x, dates: false })); }} /></Field>
          <Field label="End date"><DateField value={end} onChange={(v) => { setEnd(v); setErr((x) => ({ ...x, dates: false })); }} /></Field>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>Opening balances carry over automatically from the previous period.</p>
      </div>
    </Modal>
  );
}

function OpeningBalancesModal({ period, onClose, onSaved }: { period: Period; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: api.listAccounts });
  const balMap = (arr?: { accountId: string; amount: number }[]) => Object.fromEntries((arr || []).map((a) => [a.accountId, a.amount]));
  const [vals, setVals] = useState<Record<string, string>>(() => {
    const b = balMap(period.openingBalances), s = balMap(period.openingSavings);
    const out: Record<string, string> = {};
    Object.entries({ ...b, ...s }).forEach(([k, v]) => { if (v) out[k] = paisaToInput(v as number); });
    return out;
  });
  const real = accounts.filter((a) => a.kind !== "virtual" && a.kind !== "savings");
  const savings = accounts.filter((a) => a.kind === "savings");

  const save = useMutation({
    mutationFn: () => {
      const openingBalances = real.map((a) => ({ accountId: a.id, amount: evalAmountExpr(vals[a.id] || "0") || 0 })).filter((x) => x.amount !== 0);
      const openingSavings = savings.map((a) => ({ accountId: a.id, amount: evalAmountExpr(vals[a.id] || "0") || 0 })).filter((x) => x.amount !== 0);
      return api.updatePeriod(period.id, { openingBalances, openingSavings });
    },
    onSuccess: () => { onSaved(); onClose(); toast("Opening balances saved"); },
    onError: (e: any) => toast(e?.message || "Could not save balances"),
  });

  const row = (a: Account) => (
    <div className="set-row" key={a.id}>
      <div className="lbl"><span className="acct"><Icon name={accountIcon(a.kind)} /></span> {a.name}</div>
      <div style={{ width: 150 }}><input className="ob-input" inputMode="decimal" value={vals[a.id] || ""} placeholder="0" onChange={(e) => setVals((v) => ({ ...v, [a.id]: e.target.value }))} style={{ textAlign: "right" }} /></div>
    </div>
  );

  return (
    <Modal title={`Opening balances · ${period.name}`} width={520} onClose={onClose}
      footer={<><button className="ob-btn ob-btn--secondary" onClick={onClose}>Cancel</button><button className="ob-btn ob-btn--primary" onClick={() => save.mutate()} disabled={save.isPending}><Icon name="check" /> Save balances</button></>}>
      <p className="muted" style={{ marginTop: 0 }}>Set the cash you started this cycle with (taka).</p>
      {real.map(row)}
      {savings.length > 0 && <div className="sidebar-section-title">Savings</div>}
      {savings.map(row)}
    </Modal>
  );
}

/* ----------------------------- Recurring ----------------------------- */
function RecurringTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);
  const { data: recurring = [], isLoading } = useQuery({ queryKey: ["recurring"], queryFn: api.listRecurring });
  const { data: categories = [] } = useQuery({ queryKey: ["categories"], queryFn: api.listCategories });
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: api.listAccounts });
  const refresh = () => qc.invalidateQueries({ queryKey: ["recurring"] });
  const del = useMutation({ mutationFn: (id: string) => api.deleteRecurring(id), onSuccess: () => { refresh(); toast("Removed"); } });

  if (isLoading) return <Spinner />;
  const catName = (id: string) => categories.find((c) => c.id === id)?.name || "—";
  const acctName = (id: string) => accounts.find((a) => a.id === id)?.name || "—";

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}><button className="ob-btn ob-btn--primary" onClick={() => setAdding(true)}><Icon name="plus" /> New template</button></div>
      {recurring.length === 0 ? <EmptyState icon="repeat" title="No recurring templates" hint="Save frequent expenses for one-tap entry on the Expenses screen." action={<button className="ob-btn ob-btn--primary" onClick={() => setAdding(true)}><Icon name="plus" /> New template</button>} /> : (
        <div className="ob-card" style={{ padding: 0 }}>
          <table className="ob-table">
            <thead><tr><th>Label</th><th>Category</th><th>Account</th><th className="num">Amount</th><th /></tr></thead>
            <tbody>
              {recurring.map((r) => (
                <tr key={r.id}>
                  <td>{r.label}</td>
                  <td className="muted">{catName(r.categoryId)}{r.subcategory ? ` · ${r.subcategory}` : ""}</td>
                  <td className="muted">{acctName(r.accountId)}</td>
                  <td className="num">{taka(r.amount)}</td>
                  <td><button className="rowact" title="Delete" onClick={async () => { if (await confirm({ title: `Delete "${r.label}"?`, danger: true })) del.mutate(r.id); }}><Icon name="trash-can" solid={false} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding && <RecurringModal categories={categories} accounts={accounts} onClose={() => setAdding(false)} onSaved={refresh} />}
    </>
  );
}

function RecurringModal({ categories, accounts, onClose, onSaved }: { categories: Category[]; accounts: Account[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const expenseCats = categories.filter((c) => c.kind === "expense" && c.active);
  const realAccts = accounts.filter((a) => a.active && a.kind !== "virtual");
  const [label, setLabel] = useState("");
  const [categoryId, setCategoryId] = useState(expenseCats[0]?.id || "");
  const [subcategory, setSubcategory] = useState("");
  const [accountId, setAccountId] = useState(realAccts[0]?.id || "");
  const [amount, setAmount] = useState("");
  const [err, setErr] = useState<{ label?: boolean; amount?: boolean }>({});

  const cat = expenseCats.find((c) => c.id === categoryId);
  const subOpts: Opt[] = (cat?.subcategories || []).filter((s) => s.active).map((s) => ({ value: s.name, label: s.name }));
  const catOpts: Opt[] = expenseCats.map((c) => ({ value: c.id, label: c.name }));
  const acctOpts: Opt[] = realAccts.map((a) => ({ value: a.id, label: a.name, icon: accountIcon(a.kind) }));

  const save = useMutation({
    mutationFn: () => api.createRecurring({ label: label.trim(), categoryId, subcategory: subcategory || subOpts[0]?.value || "", accountId, amount: evalAmountExpr(amount) }),
    onSuccess: () => { onSaved(); onClose(); toast("Template saved"); },
    onError: (e: any) => toast(e?.message || "Could not save template"),
  });
  const submit = () => {
    const amt = evalAmountExpr(amount);
    const e = { label: !label.trim(), amount: isNaN(amt) || amt <= 0 };
    if (e.label || e.amount) { setErr(e); return; }
    save.mutate();
  };

  return (
    <Modal title="New recurring template" onClose={onClose}
      footer={<><button className="ob-btn ob-btn--secondary" onClick={onClose}>Cancel</button><button className="ob-btn ob-btn--primary" onClick={submit} disabled={save.isPending}><Icon name="check" /> Save template</button></>}>
      <div className="ob-form">
        <Field label="Label"><input className={`ob-input${err.label ? " err" : ""}`} value={label} onChange={(e) => { setLabel(e.target.value); setErr((x) => ({ ...x, label: false })); }} placeholder="e.g. Morning bazar" /></Field>
        <div className="grid2">
          <Field label="Category"><Select value={categoryId} onChange={(v) => { setCategoryId(v); setSubcategory(""); }} options={catOpts} ariaLabel="Category" /></Field>
          <Field label="Subcategory"><Select value={subcategory} onChange={setSubcategory} options={subOpts} placeholder="—" ariaLabel="Subcategory" /></Field>
        </div>
        <div className="grid2">
          <Field label="Account"><Select value={accountId} onChange={setAccountId} options={acctOpts} ariaLabel="Account" /></Field>
          <Field label="Amount"><AmountInput value={amount} onChange={(v) => { setAmount(v); setErr((x) => ({ ...x, amount: false })); }} invalid={err.amount} /></Field>
        </div>
      </div>
    </Modal>
  );
}
