"use client";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { useConfirm } from "@/lib/confirm";
import { taka, evalAmountExpr } from "@/lib/money";
import { fmtDate, isoDate } from "@/lib/format";
import type { Lend, LendType } from "@/lib/types";
import { Icon, Spinner, EmptyState } from "@/components/ui";
import { Select, Opt } from "@/components/Select";
import { Modal } from "@/components/Modal";
import { AmountInput, DateField, Field } from "@/components/fields";

type View = "all" | "given" | "taken";
const settled = (l: Lend) => (l.settlements || []).reduce((s, x) => s + x.amount, 0);
const outstanding = (l: Lend) => l.amount - settled(l);

export default function LendsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [view, setView] = useState<View>("all");
  const [adding, setAdding] = useState(false);
  const [settling, setSettling] = useState<Lend | "any" | null>(null);

  const { data: lends, isLoading } = useQuery({ queryKey: ["lends"], queryFn: () => api.listLends() });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["lends"] }); qc.invalidateQueries({ queryKey: ["summary"] }); };
  const del = useMutation({ mutationFn: (id: string) => api.deleteLend(id), onSuccess: () => { refresh(); toast("Lend removed"); } });

  const all = lends || [];
  const rows = all.filter((l) => view === "all" || l.type === view);
  const receivable = useMemo(() => all.filter((l) => l.type === "given").reduce((s, l) => s + outstanding(l), 0), [all]);
  const payable = useMemo(() => all.filter((l) => l.type === "taken").reduce((s, l) => s + outstanding(l), 0), [all]);
  const openLends = all.filter((l) => outstanding(l) > 0);

  const removeRow = async (l: Lend) => {
    if (await confirm({ title: `Delete the ${l.type === "given" ? "loan to" : "debt from"} ${l.person}?`, message: "This removes the lend and its settlements.", danger: true })) del.mutate(l.id);
  };

  const tabs: { id: View; label: string }[] = [{ id: "all", label: "All" }, { id: "given", label: "Given" }, { id: "taken", label: "Taken" }];

  return (
    <>
      <div className="breadcrumb-bar">
        <nav className="breadcrumb"><Icon name="folder" solid={false} /><span className="crumb-link">Dashboard</span><Icon name="chevron-right" /><span className="crumb-cur">Lends</span></nav>
        <div className="bc-actions">
          {openLends.length > 0 && <button className="ob-btn ob-btn--secondary" onClick={() => setSettling("any")}><Icon name="hand-holding-dollar" /> Record settlement</button>}
          <button className="ob-btn ob-btn--primary" onClick={() => setAdding(true)}><Icon name="plus" /> New lend</button>
        </div>
      </div>

      <div className="secondary-bar">
        <div className="subtabs" role="tablist">
          {tabs.map((t) => <button key={t.id} role="tab" aria-selected={view === t.id} className={`subtab${view === t.id ? " active" : ""}`} onClick={() => setView(t.id)}>{t.label}</button>)}
        </div>
        <span style={{ marginLeft: "auto" }} className="muted num">Receivable {taka(receivable)} · Payable {taka(payable)}</span>
      </div>

      <div className="page">
        {isLoading ? <Spinner /> :
          rows.length === 0 ? <EmptyState icon="handshake" title="No lends in this view" hint="Track money you've lent out or borrowed." action={<button className="ob-btn ob-btn--primary" onClick={() => setAdding(true)}><Icon name="plus" /> New lend</button>} /> :
          <div className="tscroll"><table className="ob-table">
            <thead><tr><th>Person</th><th>Type</th><th className="num">Principal</th><th className="num">Settled</th><th className="num">Outstanding</th><th>Since</th><th>Status</th><th /></tr></thead>
            <tbody>
              {rows.map((l) => {
                const out = outstanding(l), s = settled(l);
                const status = out <= 0 ? <span className="ob-badge ob-badge--green ob-badge--sm"><Icon name="check" /> Settled</span> : s > 0 ? <span className="ob-badge ob-badge--orange ob-badge--sm">Partial</span> : <span className="ob-badge ob-badge--red ob-badge--sm">Open</span>;
                return (
                  <tr key={l.id}>
                    <td><span className="cat-dot" style={{ background: l.type === "given" ? "var(--blue-0)" : "var(--marketing-purple)" }} />{l.person}</td>
                    <td>{l.type === "given" ? <span className="ob-badge ob-badge--neutral ob-badge--sm">Given</span> : <span className="ob-badge ob-badge--purple ob-badge--sm">Taken</span>}</td>
                    <td className="num">{taka(l.amount)}</td>
                    <td className="num">{taka(s)}</td>
                    <td className="num">{taka(out)}</td>
                    <td className="num muted">{fmtDate(l.date)}</td>
                    <td>{status}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {out > 0 && <button className="rowact" title="Settle" onClick={() => setSettling(l)}>Settle</button>}
                      <button className="rowact" title="Delete" onClick={() => removeRow(l)}><Icon name="trash-can" solid={false} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>}
      </div>

      {adding && <LendDialog onClose={() => setAdding(false)} onSaved={refresh} />}
      {settling && <SettleDialog lend={settling === "any" ? null : settling} openLends={openLends} onClose={() => setSettling(null)} onSaved={refresh} />}
    </>
  );
}

function LendDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [type, setType] = useState<LendType>("given");
  const [person, setPerson] = useState("");
  const [date, setDate] = useState(isoDate(new Date().toISOString()));
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<{ person?: boolean; amount?: boolean }>({});

  const save = useMutation({
    mutationFn: (b: any) => api.createLend(b),
    onSuccess: () => { onSaved(); onClose(); toast("Lend recorded"); },
    onError: (e: any) => toast(e?.message || "Could not save lend"),
  });
  const submit = () => {
    const amt = evalAmountExpr(amount);
    const e = { person: !person.trim(), amount: isNaN(amt) || amt <= 0 };
    if (e.person || e.amount) { setErr(e); return; }
    save.mutate({ type, person: person.trim(), date, amountExpr: amount, notes });
  };
  const typeOpts: Opt[] = [{ value: "given", label: "Given (you lent out)" }, { value: "taken", label: "Taken (you borrowed)" }];

  return (
    <Modal title="New lend" onClose={onClose}
      footer={<>
        <button className="ob-btn ob-btn--secondary" onClick={onClose}>Cancel</button>
        <button className="ob-btn ob-btn--primary" onClick={submit} disabled={save.isPending}><Icon name="check" /> Save lend</button>
      </>}>
      <div className="ob-form">
        <Field label="Person"><input className={`ob-input${err.person ? " err" : ""}`} value={person} onChange={(e) => { setPerson(e.target.value); setErr((x) => ({ ...x, person: false })); }} placeholder="Name" /></Field>
        <div className="grid2">
          <Field label="Type"><Select value={type} onChange={(v) => setType(v as LendType)} options={typeOpts} ariaLabel="Lend type" /></Field>
          <Field label="Date"><DateField value={date} onChange={setDate} /></Field>
        </div>
        <Field label="Amount"><AmountInput value={amount} onChange={(v) => { setAmount(v); setErr((x) => ({ ...x, amount: false })); }} invalid={err.amount} /></Field>
        <Field label="Notes"><input className="ob-input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="optional" /></Field>
      </div>
    </Modal>
  );
}

function SettleDialog({ lend, openLends, onClose, onSaved }: { lend: Lend | null; openLends: Lend[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [lendId, setLendId] = useState(lend?.id || openLends[0]?.id || "");
  const target = openLends.find((l) => l.id === lendId) || lend;
  const [date, setDate] = useState(isoDate(new Date().toISOString()));
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState(false);

  const save = useMutation({
    mutationFn: (b: any) => api.settleLend(lendId, b),
    onSuccess: () => { onSaved(); onClose(); toast("Settlement recorded"); },
    onError: (e: any) => toast(e?.message || "Could not record settlement"),
  });
  const submit = () => {
    const amt = evalAmountExpr(amount);
    if (!lendId || isNaN(amt) || amt <= 0) { setErr(true); return; }
    save.mutate({ date, amountExpr: amount, note });
  };
  const opts: Opt[] = openLends.map((l) => ({ value: l.id, label: `${l.person} · ${taka(outstanding(l))} ${l.type === "given" ? "in" : "out"}` }));

  return (
    <Modal title="Record settlement" onClose={onClose}
      footer={<>
        <button className="ob-btn ob-btn--secondary" onClick={onClose}>Cancel</button>
        <button className="ob-btn ob-btn--primary" onClick={submit} disabled={save.isPending}><Icon name="check" /> Record settlement</button>
      </>}>
      <div className="ob-form">
        {lend ? <Field label="Lend"><div className="ob-input" style={{ display: "flex", alignItems: "center" }}>{lend.person} · {taka(outstanding(lend))} outstanding</div></Field>
          : <Field label="Lend"><Select value={lendId} onChange={setLendId} options={opts} ariaLabel="Lend to settle" /></Field>}
        <div className="grid2">
          <Field label="Amount" hint={target ? `up to ${taka(outstanding(target))}` : undefined}><AmountInput value={amount} onChange={(v) => { setAmount(v); setErr(false); }} invalid={err} /></Field>
          <Field label="Date"><DateField value={date} onChange={setDate} /></Field>
        </div>
        <Field label="Note"><input className="ob-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" /></Field>
      </div>
    </Modal>
  );
}
