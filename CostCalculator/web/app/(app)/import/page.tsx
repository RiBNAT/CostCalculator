"use client";
import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { usePeriods } from "@/lib/period";
import { useToast } from "@/lib/toast";
import type { ImportReport } from "@/lib/types";
import { Icon, Spinner, EmptyState } from "@/components/ui";

export default function ImportPage() {
  const { selected } = usePeriods();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);

  const importMut = useMutation({
    mutationFn: (file: File) => api.importExcel(file),
    onSuccess: (r) => { setReport(r); toast("Import complete"); },
    onError: (e: any) => toast(e?.message || "Import failed"),
  });

  const pick = (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    if (!/\.(xlsx|xlsm)$/i.test(f.name)) { toast("Please choose an .xlsx file"); return; }
    setReport(null);
    importMut.mutate(f);
  };

  const download = async (kind: "template" | "csv") => {
    try {
      const blob = kind === "template" ? await api.downloadTemplate() : await api.exportCsv(selected!.id);
      const url = URL.createObjectURL(blob); const a = document.createElement("a");
      a.href = url; a.download = kind === "template" ? "ribnat-template.xlsx" : `${selected?.name || "period"}.csv`; a.click(); URL.revokeObjectURL(url);
    } catch (e: any) { toast(e?.message || "Download failed"); }
  };

  return (
    <>
      <div className="breadcrumb-bar">
        <nav className="breadcrumb"><Icon name="folder" solid={false} /><span className="crumb-link">Dashboard</span><Icon name="chevron-right" /><span className="crumb-cur">Import / Export</span></nav>
      </div>
      <div className="page">
        <div className="set-grid">
          <div className="ob-card">
            <div className="ob-card__title-bar"><h3 className="ob-card__title">Import from Excel</h3></div>
            <div className="set-row" style={{ borderBottom: "1px solid var(--standard-1100)" }}>
              <div><div className="lbl">Need the format?</div><div className="sub">Download the CostSheet template workbook</div></div>
              <button className="ob-btn ob-btn--secondary" onClick={() => download("template")}><Icon name="download" /> Template</button>
            </div>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files); }}
              onClick={() => fileRef.current?.click()}
              role="button" tabIndex={0} aria-label="Upload an Excel workbook"
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileRef.current?.click(); } }}
              style={{ marginTop: 16, padding: "32px 20px", textAlign: "center", cursor: "pointer", borderRadius: 8, border: `2px dashed ${dragging ? "var(--blue-0)" : "var(--standard-1000)"}`, background: dragging ? "var(--standard-1300)" : "transparent" }}>
              {importMut.isPending ? <Spinner label="Importing…" /> : <>
                <div style={{ fontSize: 28, color: "var(--standard-600)", marginBottom: 8 }}><Icon name="file-arrow-up" /></div>
                <div style={{ fontWeight: 500 }}>Drop your .xlsx here, or click to browse</div>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Expenses, transfers, budget and lends are read per sheet</div>
              </>}
              <input ref={fileRef} type="file" accept=".xlsx,.xlsm" hidden onChange={(e) => pick(e.target.files)} />
            </div>
          </div>

          <div className="ob-card">
            <div className="ob-card__title-bar"><h3 className="ob-card__title">Export</h3></div>
            <div className="set-row">
              <div><div className="lbl">Current period as CSV</div><div className="sub">{selected ? selected.name : "Select a period first"}</div></div>
              <button className="ob-btn ob-btn--secondary" onClick={() => download("csv")} disabled={!selected}><Icon name="arrow-up-from-bracket" /> Export CSV</button>
            </div>
          </div>
        </div>

        {report && (
          <div className="ob-card" style={{ marginTop: 16, padding: 0 }}>
            <div className="ob-card__title-bar" style={{ padding: "16px 20px 0" }}><h3 className="ob-card__title">Import report</h3></div>
            {report.sheets.length === 0 ? <div style={{ padding: 20 }}><EmptyState icon="file-circle-question" title="No sheets recognised" hint="Make sure the workbook matches the template layout." /></div> : (
              <div className="tscroll"><table className="ob-table">
                <thead><tr><th>Sheet</th><th className="num">Expenses</th><th className="num">Transfers</th><th className="num">Budget</th><th className="num">Lends</th><th>Notes</th></tr></thead>
                <tbody>
                  {report.sheets.map((s, i) => (
                    <tr key={i} style={{ opacity: s.skipped ? 0.55 : 1 }}>
                      <td>{s.sheet}{s.skipped && <span className="ob-badge ob-badge--neutral ob-badge--sm" style={{ marginLeft: 8 }}>Skipped</span>}</td>
                      <td className="num">{s.expenses || 0}</td>
                      <td className="num">{s.transfers || 0}</td>
                      <td className="num">{s.budgetItems || 0}</td>
                      <td className="num">{s.lends || 0}</td>
                      <td className="muted">{(s.warnings || []).length ? <span className="neg"><Icon name="triangle-exclamation" /> {s.warnings!.length} warning{s.warnings!.length > 1 ? "s" : ""}</span> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
            {report.sheets.some((s) => (s.warnings || []).length) && (
              <div style={{ padding: "0 20px 16px" }}>
                {report.sheets.filter((s) => (s.warnings || []).length).map((s, i) => (
                  <div key={i} style={{ marginTop: 12 }}>
                    <div className="sidebar-section-title" style={{ marginTop: 0 }}>{s.sheet}</div>
                    <ul style={{ margin: 0, paddingLeft: 18, color: "var(--standard-600)", fontSize: 13 }}>{s.warnings!.map((w, j) => <li key={j}>{w}</li>)}</ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
