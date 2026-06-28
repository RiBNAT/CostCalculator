"use client";
import { useState } from "react";
import { Modal } from "./Modal";
import { Icon } from "./ui";

type RangeKind = "month" | "year" | "custom";
const SECTIONS: { key: string; title: string; desc: string; on: boolean }[] = [
  { key: "kpis", title: "Summary KPIs", desc: "Income, spent, net saved, savings rate", on: true },
  { key: "income", title: "Income & spending", desc: "Totals and cash-flow overview", on: true },
  { key: "categories", title: "Category breakdown", desc: "Spending by category with chart", on: true },
  { key: "savings", title: "Savings", desc: "Deposits per savings account", on: true },
  { key: "period", title: "Period breakdown", desc: "Income, spent & saved per cycle", on: true },
  { key: "lends", title: "Lends", desc: "Given, taken & settled", on: false },
];

const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function ReportDialog({ onClose }: { onClose: () => void }) {
  const now = new Date();
  const [step, setStep] = useState<1 | 2>(1);
  const [kind, setKind] = useState<RangeKind>("month");
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [from, setFrom] = useState(`${now.getFullYear()}-01-01`);
  const [to, setTo] = useState(`${now.getFullYear()}-12-31`);
  const [secs, setSecs] = useState<Record<string, boolean>>(Object.fromEntries(SECTIONS.map((s) => [s.key, s.on])));

  const years = [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2];

  const resolveRange = () => {
    if (kind === "month") return { f: `${year}-${pad(month + 1)}-01`, t: `${year}-${pad(month + 1)}-${pad(lastDay(year, month))}` };
    if (kind === "year") return { f: `${year}-01-01`, t: `${year}-12-31` };
    return { f: from, t: to };
  };

  const download = () => {
    const { f, t } = resolveRange();
    const keys = SECTIONS.filter((s) => secs[s.key]).map((s) => s.key).join(",");
    window.open(`/statement?from=${f}&to=${t}&sections=${keys}`, "_blank", "noopener");
    onClose();
  };

  const footer = step === 1 ? (
    <>
      <button className="ob-btn ob-btn--ghost" onClick={onClose}>Cancel</button>
      <button className="ob-btn ob-btn--primary" onClick={() => setStep(2)}>Next <Icon name="arrow-right" /></button>
    </>
  ) : (
    <>
      <button className="ob-btn ob-btn--secondary" onClick={() => setStep(1)}><Icon name="arrow-left" /> Back</button>
      <button className="ob-btn ob-btn--primary" onClick={download}><Icon name="download" /> Download</button>
    </>
  );

  return (
    <Modal title="Download report" onClose={onClose} footer={footer} width={560}>
      <div className="wiz-tabs">
        <div className={`wiz-tab${step >= 1 ? " active" : ""}`} onClick={() => setStep(1)}><span className="wiz-no">1</span> Time range</div>
        <div className={`wiz-tab${step >= 2 ? " active" : ""}`} onClick={() => setStep(2)}><span className="wiz-no">2</span> Sections</div>
      </div>

      {step === 1 ? (
        <>
          <div className="seg">
            {(["month", "year", "custom"] as RangeKind[]).map((r) => (
              <button key={r} type="button" className={`seg-btn${kind === r ? " active" : ""}`} onClick={() => setKind(r)}>
                {r === "month" ? "Month" : r === "year" ? "Year" : "Date range"}
              </button>
            ))}
          </div>
          {kind === "month" && (
            <div className="rng-grid">
              <div className="ff"><label>Month</label><select className="ob-input" value={month} onChange={(e) => setMonth(+e.target.value)}>{MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}</select></div>
              <div className="ff"><label>Year</label><select className="ob-input" value={year} onChange={(e) => setYear(+e.target.value)}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select></div>
            </div>
          )}
          {kind === "year" && (
            <div className="ff"><label>Year</label><select className="ob-input" value={year} onChange={(e) => setYear(+e.target.value)}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select></div>
          )}
          {kind === "custom" && (
            <div className="rng-grid">
              <div className="ff"><label>From</label><input type="date" className="ob-input" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              <div className="ff"><label>To</label><input type="date" className="ob-input" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="rep-hint">Choose what to include in the PDF.</p>
          {SECTIONS.map((s) => (
            <label className="rep-opt" key={s.key}>
              <input type="checkbox" checked={!!secs[s.key]} onChange={(e) => setSecs((p) => ({ ...p, [s.key]: e.target.checked }))} />
              <div><span className="rt">{s.title}</span><small>{s.desc}</small></div>
            </label>
          ))}
        </>
      )}
    </Modal>
  );
}
