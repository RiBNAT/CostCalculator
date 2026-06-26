"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { usePeriods } from "@/lib/period";
import { useToast } from "@/lib/toast";
import { useConfirm } from "@/lib/confirm";
import { fmtRange, fmtDate, isoDate, lookup } from "@/lib/format";
import type { PaymentWindow, Reminder, WindowState, WindowStatus } from "@/lib/types";
import { Icon, Spinner, EmptyState } from "@/components/ui";
import { Select, Opt } from "@/components/Select";
import { Modal } from "@/components/Modal";
import { DateField, Field } from "@/components/fields";

// GET /payment-windows flattens the window fields with a nested `status`; /summary nests under `window`. Normalize both.
type WindowRow = { window: PaymentWindow; status: WindowStatus };
const normWindow = (w: any): WindowRow => ("window" in w ? w : { window: w, status: w.status });

const STATE_BADGE: Record<WindowState, { cls: string; icon?: string; label: string }> = {
  upcoming: { cls: "neutral", icon: "clock", label: "Upcoming" },
  active: { cls: "green", icon: "circle-dot", label: "Active" },
  expired: { cls: "red", icon: "triangle-exclamation", label: "Expired" },
  paid: { cls: "green", icon: "check", label: "Paid" },
};

export default function PlannerPage() {
  const { selected } = usePeriods();
  const pid = selected?.id;
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [addWindow, setAddWindow] = useState(false);
  const [addReminder, setAddReminder] = useState(false);

  const { data: categories = [] } = useQuery({ queryKey: ["categories"], queryFn: api.listCategories });
  const { data: windows, isLoading: wLoading } = useQuery({ queryKey: ["windows", pid], queryFn: () => api.listWindows(pid!), enabled: !!pid });
  const { data: reminders, isLoading: rLoading } = useQuery({ queryKey: ["reminders"], queryFn: api.listReminders });
  const open = selected?.status === "open";

  const refreshW = () => qc.invalidateQueries({ queryKey: ["windows", pid] });
  const refreshR = () => qc.invalidateQueries({ queryKey: ["reminders"] });

  const delWindow = useMutation({ mutationFn: (id: string) => api.deleteWindow(id), onSuccess: () => { refreshW(); toast("Window removed"); } });
  const delReminder = useMutation({ mutationFn: (id: string) => api.deleteReminder(id), onSuccess: () => { refreshR(); toast("Reminder removed"); } });
  const toggleReminder = useMutation({
    mutationFn: (r: Reminder) => api.updateReminder(r.id, { date: isoDate(r.date), task: r.task, done: !r.done }),
    onSuccess: refreshR,
  });

  const header = (
    <div className="breadcrumb-bar">
      <nav className="breadcrumb"><Icon name="folder" solid={false} /><span className="crumb-link">Dashboard</span><Icon name="chevron-right" /><span className="crumb-cur">Planner</span></nav>
      <div className="bc-actions">{open && <>
        <button className="ob-btn ob-btn--secondary" onClick={() => setAddReminder(true)}><Icon name="bell" /> Add reminder</button>
        <button className="ob-btn ob-btn--primary" onClick={() => setAddWindow(true)}><Icon name="plus" /> Payment window</button>
      </>}</div>
    </div>
  );

  if (!selected) return <>{header}<div className="page"><EmptyState icon="calendar-plus" title="No period selected" /></div></>;

  const wins: WindowRow[] = (windows || []).map(normWindow);
  const rems = [...(reminders || [])].sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  return (
    <>
      {header}
      <div className="page">
        <div className="set-grid">
          <div>
            <h3 className="section-h">Payment windows</h3>
            {wLoading ? <Spinner /> : wins.length === 0 ? <EmptyState icon="calendar-week" title="No payment windows" hint={open ? "Track bills due within a date range." : "This period is closed."} /> :
              wins.map((w) => <WindowItem key={w.window.id} w={w} categories={categories} open={open} onDelete={async () => { if (await confirm({ title: `Delete "${w.window.name}"?`, danger: true })) delWindow.mutate(w.window.id); }} />)}
          </div>
          <div>
            <h3 className="section-h">Reminders</h3>
            {rLoading ? <Spinner /> : rems.length === 0 ? <EmptyState icon="bell" title="No reminders" hint={open ? "Add a quick to-do with a due date." : "This period is closed."} /> :
              rems.map((r) => (
                <div className={`plan-item${r.done ? " paid" : ""}`} key={r.id}>
                  <button className={`ob-toggle${r.done ? " on" : ""}`} role="switch" aria-checked={r.done} aria-label={`Mark "${r.task}" ${r.done ? "not done" : "done"}`} disabled={!open} onClick={() => toggleReminder.mutate(r)} style={{ flexShrink: 0 }} />
                  <div className="pmeta">
                    <div className="pname" style={{ textDecoration: r.done ? "line-through" : "none" }}>{r.task}</div>
                    <div className="muted" style={{ fontSize: 12 }}>Due {fmtDate(r.date)}</div>
                  </div>
                  {open && <button className="rowact" title="Delete" onClick={async () => { if (await confirm({ title: "Delete this reminder?", danger: true })) delReminder.mutate(r.id); }}><Icon name="trash-can" solid={false} /></button>}
                </div>
              ))}
          </div>
        </div>
      </div>

      {addWindow && pid && <WindowDialog pid={pid} period={selected} categories={categories} onClose={() => setAddWindow(false)} onSaved={refreshW} />}
      {addReminder && <ReminderDialog onClose={() => setAddReminder(false)} onSaved={refreshR} />}
    </>
  );
}

function WindowItem({ w, categories, open, onDelete }: { w: WindowRow; categories: any[]; open: boolean; onDelete: () => void }) {
  const b = STATE_BADGE[w.status.state] || STATE_BADGE.upcoming;
  const cat = w.window.categoryId ? lookup(categories, w.window.categoryId) : undefined;
  const meta = [fmtRange(w.window.startDate, w.window.endDate), cat?.name, w.window.subcategory].filter(Boolean).join(" · ");
  return (
    <div className={`plan-item${w.status.state === "paid" ? " paid" : ""}`}>
      <span className="picon"><Icon name="calendar-days" /></span>
      <div className="pmeta">
        <div className="pname">{w.window.name}</div>
        <div className="muted" style={{ fontSize: 12 }}>{meta}{w.status.state === "active" && w.status.days >= 0 ? ` · ${w.status.days}d left` : ""}</div>
      </div>
      <span className={`ob-badge ob-badge--${b.cls} ob-badge--sm`}>{b.icon && <Icon name={b.icon} />} {b.label}</span>
      {open && <button className="rowact" title="Delete" onClick={onDelete} style={{ marginLeft: 6 }}><Icon name="trash-can" solid={false} /></button>}
    </div>
  );
}

function WindowDialog({ pid, period, categories, onClose, onSaved }: { pid: string; period: any; categories: any[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [startDate, setStartDate] = useState(isoDate(period.startDate));
  const [endDate, setEndDate] = useState(isoDate(period.endDate));
  const [err, setErr] = useState(false);

  const expenseCats = categories.filter((c) => c.kind === "expense" && c.active);
  const cat = expenseCats.find((c) => c.id === categoryId);
  const catOpts: Opt[] = [{ value: "", label: "— none —" }, ...expenseCats.map((c) => ({ value: c.id, label: c.name }))];
  const subOpts: Opt[] = [{ value: "", label: "— none —" }, ...((cat?.subcategories || []).filter((s: any) => s.active).map((s: any) => ({ value: s.name, label: s.name })))];

  const save = useMutation({
    mutationFn: () => api.createWindow({ periodId: pid, name: name.trim(), categoryId: categoryId || "", subcategory: subcategory || "", startDate, endDate }),
    onSuccess: () => { onSaved(); onClose(); toast("Payment window added"); },
    onError: (e: any) => toast(e?.message || "Could not save window"),
  });
  const submit = () => { if (!name.trim()) { setErr(true); return; } save.mutate(); };

  return (
    <Modal title="Payment window" onClose={onClose}
      footer={<>
        <button className="ob-btn ob-btn--secondary" onClick={onClose}>Cancel</button>
        <button className="ob-btn ob-btn--primary" onClick={submit} disabled={save.isPending}><Icon name="check" /> Add window</button>
      </>}>
      <div className="ob-form">
        <Field label="Name"><input className={`ob-input${err ? " err" : ""}`} value={name} onChange={(e) => { setName(e.target.value); setErr(false); }} placeholder="e.g. Electricity bill" /></Field>
        <div className="grid2">
          <Field label="Category"><Select value={categoryId} onChange={(v) => { setCategoryId(v); setSubcategory(""); }} options={catOpts} ariaLabel="Category" /></Field>
          <Field label="Subcategory"><Select value={subcategory} onChange={setSubcategory} options={subOpts} ariaLabel="Subcategory" /></Field>
        </div>
        <div className="grid2">
          <Field label="Start"><DateField value={startDate} onChange={setStartDate} /></Field>
          <Field label="End"><DateField value={endDate} onChange={setEndDate} /></Field>
        </div>
      </div>
    </Modal>
  );
}

function ReminderDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [task, setTask] = useState("");
  const [date, setDate] = useState(isoDate(new Date().toISOString()));
  const [err, setErr] = useState(false);

  const save = useMutation({
    mutationFn: () => api.createReminder({ task: task.trim(), date }),
    onSuccess: () => { onSaved(); onClose(); toast("Reminder added"); },
    onError: (e: any) => toast(e?.message || "Could not save reminder"),
  });
  const submit = () => { if (!task.trim()) { setErr(true); return; } save.mutate(); };

  return (
    <Modal title="Add reminder" width={440} onClose={onClose}
      footer={<>
        <button className="ob-btn ob-btn--secondary" onClick={onClose}>Cancel</button>
        <button className="ob-btn ob-btn--primary" onClick={submit} disabled={save.isPending}><Icon name="check" /> Add reminder</button>
      </>}>
      <div className="ob-form">
        <Field label="Task"><input className={`ob-input${err ? " err" : ""}`} value={task} onChange={(e) => { setTask(e.target.value); setErr(false); }} placeholder="e.g. Pay internet bill" /></Field>
        <Field label="Due date"><DateField value={date} onChange={setDate} /></Field>
      </div>
    </Modal>
  );
}
