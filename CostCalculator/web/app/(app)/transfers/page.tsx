"use client";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { usePeriods } from "@/lib/period";
import { useToast } from "@/lib/toast";
import { useConfirm } from "@/lib/confirm";
import { taka, paisaToInput, evalAmountExpr } from "@/lib/money";
import { accountIcon, fmtDate, isoDate, lookup } from "@/lib/format";
import type { Account, Transfer } from "@/lib/types";
import { Icon, Spinner, EmptyState } from "@/components/ui";
import { Select, Opt } from "@/components/Select";
import { Modal } from "@/components/Modal";
import { AmountInput, DateField, Field } from "@/components/fields";

/** The auto-seeded virtual account (virtualRole "external", named "Add") — money entering the system = income. */
const isExternal = (a?: Account) => a?.kind === "virtual" && a?.virtualRole === "external";

export default function TransfersPage() {
  const { selected } = usePeriods();
  const pid = selected?.id;
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Transfer | "new" | null>(null);
  const [income, setIncome] = useState<Transfer | "new" | null>(null);

  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: api.listAccounts });
  const { data: transfers, isLoading } = useQuery({ queryKey: ["transfers", pid], queryFn: () => api.listTransfers(pid!), enabled: !!pid });

  const external = accounts.find(isExternal);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["transfers", pid] }); qc.invalidateQueries({ queryKey: ["summary", pid] }); };
  const del = useMutation({ mutationFn: (id: string) => api.deleteTransfer(pid!, id), onSuccess: () => { refresh(); toast("Transfer removed"); } });

  const rows = [...(transfers || [])].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const isIncomeRow = (t: Transfer) => !!external && t.fromAccountId === external.id;
  const incomeTotal = useMemo(() => rows.filter(isIncomeRow).reduce((s, t) => s + t.amount, 0), [rows, external]);
  const moved = useMemo(() => rows.filter((t) => !isIncomeRow(t)).reduce((s, t) => s + t.amount, 0), [rows, external]);
  const fees = useMemo(() => rows.reduce((s, t) => s + (t.fee || 0), 0), [rows]);
  const open = selected?.status === "open";

  const removeRow = async (t: Transfer) => {
    if (await confirm({ title: isIncomeRow(t) ? "Delete this income entry?" : "Delete this transfer?", message: "This can't be undone.", danger: true })) del.mutate(t.id);
  };

  return (
    <>
      <div className="breadcrumb-bar">
        <nav className="breadcrumb"><Icon name="folder" solid={false} /><span className="crumb-link">Dashboard</span><Icon name="chevron-right" /><span className="crumb-cur">Transfers</span></nav>
        <div className="bc-actions">{open && <>
          {external && <button className="ob-btn ob-btn--secondary" onClick={() => setIncome("new")}><Icon name="arrow-right-to-bracket" /> Add income</button>}
          <button className="ob-btn ob-btn--primary" onClick={() => setEditing("new")}><Icon name="right-left" /> New transfer</button>
        </>}</div>
      </div>

      <div className="secondary-bar">
        <span className="muted">Move money between your own accounts — or log income coming in from outside.</span>
        <span style={{ marginLeft: "auto" }} className="muted num">{incomeTotal > 0 ? `${taka(incomeTotal)} income · ` : ""}{taka(moved)} moved{fees > 0 ? ` · ${taka(fees)} fees` : ""}</span>
      </div>

      <div className="page">
        {!selected ? <EmptyState icon="calendar-plus" title="No period selected" /> :
          isLoading ? <Spinner /> :
          rows.length === 0 ? <EmptyState icon="right-left" title="No transfers yet" hint={open ? "Move money between accounts (e.g. bank → cash), or log income." : "This period is closed."} action={open ? <button className="ob-btn ob-btn--primary" onClick={() => setEditing("new")}><Icon name="right-left" /> New transfer</button> : undefined} /> :
          <div className="tscroll"><table className="ob-table">
            <thead><tr><th>Date</th><th>From</th><th /><th>To</th><th className="num">Amount</th><th className="num">Fee / charge</th><th>Note</th><th /></tr></thead>
            <tbody>
              {rows.map((t) => {
                const inc = isIncomeRow(t);
                const f = lookup(accounts, t.fromAccountId), to = lookup(accounts, t.toAccountId);
                return (
                  <tr key={t.id}>
                    <td className="num">{fmtDate(t.date)}</td>
                    <td>{inc ? <span className="ob-badge ob-badge--green ob-badge--sm"><Icon name="arrow-right-to-bracket" /> Income</span> : <span className="acct"><Icon name={accountIcon(f?.kind)} />{f?.name || "—"}</span>}</td>
                    <td style={{ textAlign: "center", color: "var(--standard-600)" }}><Icon name="arrow-right-long" /></td>
                    <td><span className="acct"><Icon name={accountIcon(to?.kind)} />{to?.name || "—"}</span></td>
                    <td className="num">{taka(t.amount)}</td>
                    <td className={`num${t.fee > 0 ? "" : " muted"}`}>{t.fee > 0 ? taka(t.fee) : "—"}</td>
                    <td className="muted">{t.note || ""}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{open && <>
                      <button className="rowact" title="Edit" onClick={() => (inc ? setIncome(t) : setEditing(t))}><Icon name="pen" /></button>
                      <button className="rowact" title="Delete" onClick={() => removeRow(t)}><Icon name="trash-can" solid={false} /></button>
                    </>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>}
      </div>

      {editing && pid && (
        <TransferDialog periodId={pid} period={selected!} transfer={editing === "new" ? null : editing}
          accounts={accounts.filter((a) => a.active && a.kind !== "virtual")} onClose={() => setEditing(null)} onSaved={refresh} />
      )}
      {income && pid && external && (
        <IncomeDialog periodId={pid} period={selected!} transfer={income === "new" ? null : income} external={external}
          accounts={accounts.filter((a) => a.active && a.kind !== "virtual")} onClose={() => setIncome(null)} onSaved={refresh} />
      )}
    </>
  );
}

function TransferDialog({ periodId, period, transfer, accounts, onClose, onSaved }: {
  periodId: string; period: any; transfer: Transfer | null; accounts: Account[]; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const editing = !!transfer;
  const [date, setDate] = useState(transfer ? isoDate(transfer.date) : isoDate(new Date().toISOString()));
  const [fromId, setFromId] = useState(transfer?.fromAccountId || accounts[0]?.id || "");
  const [toId, setToId] = useState(transfer?.toAccountId || accounts[1]?.id || accounts[0]?.id || "");
  const [amount, setAmount] = useState(transfer ? paisaToInput(transfer.amount) : "");
  const [fee, setFee] = useState(transfer && transfer.fee ? paisaToInput(transfer.fee) : "");
  const [note, setNote] = useState(transfer?.note || "");
  const [err, setErr] = useState(false);

  const acctOpts: Opt[] = accounts.map((a) => ({ value: a.id, label: a.name, icon: accountIcon(a.kind) }));
  const save = useMutation({
    mutationFn: (body: any) => editing ? api.updateTransfer(periodId, transfer!.id, body) : api.createTransfer(periodId, body),
    onSuccess: () => { onSaved(); onClose(); toast(editing ? "Transfer updated" : "Transfer recorded"); },
    onError: (e: any) => toast(e?.message || "Could not save transfer"),
  });

  const submit = () => {
    const amt = evalAmountExpr(amount);
    if (isNaN(amt) || amt <= 0) { setErr(true); return; }
    if (fromId === toId) { toast("Pick two different accounts"); return; }
    save.mutate({ date, fromAccountId: fromId, toAccountId: toId, amountExpr: amount, feeExpr: fee || "0", note });
  };

  return (
    <Modal title={editing ? "Edit transfer" : "Transfer money"} onClose={onClose}
      footer={<>
        <button className="ob-btn ob-btn--secondary" onClick={onClose}>Cancel</button>
        <button className="ob-btn ob-btn--primary" onClick={submit} disabled={save.isPending}><Icon name="right-left" /> {editing ? "Save" : "Transfer"}</button>
      </>}>
      <div className="ob-form">
        <div className="grid2">
          <Field label="From account"><Select value={fromId} onChange={setFromId} options={acctOpts} ariaLabel="From account" /></Field>
          <Field label="To account"><Select value={toId} onChange={setToId} options={acctOpts} ariaLabel="To account" /></Field>
        </div>
        <div className="grid2">
          <Field label="Amount"><AmountInput value={amount} onChange={(v) => { setAmount(v); setErr(false); }} invalid={err} /></Field>
          <Field label="Fee / charge"><AmountInput value={fee} onChange={setFee} note="ATM · NPSB · cash-out (off the source)" /></Field>
        </div>
        <div className="grid2">
          <Field label="Date"><DateField value={date} onChange={setDate} min={isoDate(period.startDate)} max={isoDate(period.endDate)} /></Field>
          <Field label="Note"><input className="ob-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" /></Field>
        </div>
      </div>
    </Modal>
  );
}

/** Income = a transfer FROM the virtual external account INTO a real account (increases in-hand). */
function IncomeDialog({ periodId, period, transfer, external, accounts, onClose, onSaved }: {
  periodId: string; period: any; transfer: Transfer | null; external: Account; accounts: Account[]; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const editing = !!transfer;
  const [date, setDate] = useState(transfer ? isoDate(transfer.date) : isoDate(new Date().toISOString()));
  const [toId, setToId] = useState(transfer?.toAccountId || accounts[0]?.id || "");
  const [amount, setAmount] = useState(transfer ? paisaToInput(transfer.amount) : "");
  const [note, setNote] = useState(transfer?.note || "");
  const [err, setErr] = useState(false);

  const acctOpts: Opt[] = accounts.map((a) => ({ value: a.id, label: a.name, icon: accountIcon(a.kind) }));
  const save = useMutation({
    mutationFn: (body: any) => editing ? api.updateTransfer(periodId, transfer!.id, body) : api.createTransfer(periodId, body),
    onSuccess: () => { onSaved(); onClose(); toast(editing ? "Income updated" : "Income added"); },
    onError: (e: any) => toast(e?.message || "Could not save income"),
  });

  const submit = () => {
    const amt = evalAmountExpr(amount);
    if (isNaN(amt) || amt <= 0) { setErr(true); return; }
    save.mutate({ date, fromAccountId: external.id, toAccountId: toId, amountExpr: amount, feeExpr: "0", note });
  };

  return (
    <Modal title={editing ? "Edit income" : "Add income"} width={460} onClose={onClose}
      footer={<>
        <button className="ob-btn ob-btn--secondary" onClick={onClose}>Cancel</button>
        <button className="ob-btn ob-btn--primary" onClick={submit} disabled={save.isPending}><Icon name="arrow-right-to-bracket" /> {editing ? "Save" : "Add income"}</button>
      </>}>
      <div className="ob-form">
        <Field label="Into account" hint="where the money landed"><Select value={toId} onChange={setToId} options={acctOpts} ariaLabel="Into account" /></Field>
        <div className="grid2">
          <Field label="Amount"><AmountInput value={amount} onChange={(v) => { setAmount(v); setErr(false); }} invalid={err} /></Field>
          <Field label="Date"><DateField value={date} onChange={setDate} min={isoDate(period.startDate)} max={isoDate(period.endDate)} /></Field>
        </div>
        <Field label="Source" hint="salary, freelance, gift…"><input className="ob-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. June salary" /></Field>
      </div>
    </Modal>
  );
}
